import { getSession } from "../../../../../lib/session";
import { createPrismaClient } from "../../../../../lib/prisma";
import { joinOpenGroup, applyForGroupMembership } from "../../../../../lib/group-membership";
import { routeSupportRequest } from "../../../../../lib/capability-routing";
import { resolveGroupInviteToken } from "../../../../../lib/group-invites";

// Redirect with a RELATIVE Location. The browser resolves it against the URL it actually
// requested, so this never inherits the server's bind host (e.g. 0.0.0.0:3000) the way
// `new URL(path, request.url)` did — that bug surfaced as an iOS "download" prompt / ERR_ADDRESS_INVALID.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const session = await getSession();
  const url = new URL(request.url);

  if (!session.accountId) {
    return redirectTo(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }

  const inviteToken = url.searchParams.get("invite");

  const prisma = createPrismaClient();
  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, membershipPolicy: true, visibility: true },
    });

    if (!group) {
      return redirectTo("/groups");
    }

    if (group.visibility !== "public") {
      if (!inviteToken) {
        return redirectTo("/groups");
      }
      const resolved = await resolveGroupInviteToken(prisma, inviteToken);
      if (!resolved.ok || resolved.groupId !== groupId) {
        return redirectTo(`/invite/${encodeURIComponent(inviteToken)}`);
      }
    }

    if (group.membershipPolicy === "open") {
      // Open group: immediate join. Private groups still require a valid invite above.
      const result = await joinOpenGroup(prisma, session.accountId, groupId);

      // Membership is now committed — everything below is best-effort. A failure in a
      // post-join side effect (session persistence, support-request routing) must NOT
      // surface an error page to a user who has already successfully joined; they should
      // always land cleanly on the group page.
      try {
        session.activeGroupId = result.groupId;
        await session.save();
      } catch (error) {
        console.error("join: failed to persist active group in session", error);
      }
      try {
        const openRequests = await prisma.supportRequest.findMany({
          where: { status: "open", groupId },
          select: { id: true },
        });
        for (const req of openRequests) {
          await routeSupportRequest(prisma, { supportRequestId: req.id });
        }
      } catch (error) {
        console.error("join: failed to route open support requests after join", error);
      }
      return redirectTo(`/groups/${groupId}`);
    }

    // Public request_required group (no invite needed) or private group with valid invite:
    // create a pending application
    const result = await applyForGroupMembership(prisma, session.accountId, groupId);
    if (result.ok) {
      return redirectTo(`/groups?applied=${groupId}`);
    } else {
      // Already applied or already a member
      return redirectTo("/groups");
    }
  } finally {
    await prisma.$disconnect();
  }
}
