import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { createPrismaClient } from "../../../../../lib/prisma";
import { joinOpenGroup, applyForGroupMembership } from "../../../../../lib/group-membership";
import { routeSupportRequest } from "../../../../../lib/capability-routing";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const session = await getSession();

  if (!session.accountId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const prisma = createPrismaClient();
  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, membershipPolicy: true },
    });

    if (!group) {
      return NextResponse.redirect(new URL("/groups", request.url));
    }

    if (group.membershipPolicy === "open") {
      // Open group: immediate join
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
    } else {
      // Non-open group: create a pending application
      const result = await applyForGroupMembership(prisma, session.accountId, groupId);
      if (result.ok) {
        return NextResponse.redirect(
          new URL(`/groups?applied=${groupId}`, request.url),
        );
      } else {
        // Already applied or already a member — redirect to groups page
        return NextResponse.redirect(new URL("/groups", request.url));
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
