import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { createPrismaClient } from "../../../../../lib/prisma";
import { joinOpenGroup } from "../../../../../lib/group-membership";
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
  } finally {
    await prisma.$disconnect();
  }

  return NextResponse.redirect(new URL(`/groups/${groupId}`, request.url));
}
