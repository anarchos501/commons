import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { createPrismaClient } from "../../../../../lib/prisma";
import { joinOpenGroup, applyForGroupMembership } from "../../../../../lib/group-membership";
import { routeSupportRequest } from "../../../../../lib/capability-routing";
import { resolveGroupInviteToken } from "../../../../../lib/group-invites";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const session = await getSession();
  const url = new URL(request.url);

  if (!session.accountId) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`, request.url),
    );
  }

  const inviteToken = url.searchParams.get("invite");

  const prisma = createPrismaClient();
  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, membershipPolicy: true, visibility: true },
    });

    if (!group) {
      return NextResponse.redirect(new URL("/groups", request.url));
    }

    if (group.visibility !== "public") {
      if (!inviteToken) {
        return NextResponse.redirect(new URL("/groups", request.url));
      }
      const resolved = await resolveGroupInviteToken(prisma, inviteToken);
      if (!resolved.ok || resolved.groupId !== groupId) {
        return NextResponse.redirect(
          new URL(`/invite/${encodeURIComponent(inviteToken)}`, request.url),
        );
      }
    }

    if (group.membershipPolicy === "open") {
      // Open group: immediate join. Private groups still require a valid invite above.
      const result = await joinOpenGroup(prisma, session.accountId, groupId);
      session.activeGroupId = result.groupId;
      await session.save();
      const openRequests = await prisma.supportRequest.findMany({
        where: { status: "open", groupId },
        select: { id: true },
      });
      for (const req of openRequests) {
        await routeSupportRequest(prisma, { supportRequestId: req.id });
      }
      return NextResponse.redirect(new URL(`/groups/${groupId}`, request.url));
    }

    // Public request_required group (no invite needed) or private group with valid invite:
    // create a pending application
    const result = await applyForGroupMembership(prisma, session.accountId, groupId);
    if (result.ok) {
      return NextResponse.redirect(new URL(`/groups?applied=${groupId}`, request.url));
    } else {
      // Already applied or already a member
      return NextResponse.redirect(new URL("/groups", request.url));
    }
  } finally {
    await prisma.$disconnect();
  }
}
