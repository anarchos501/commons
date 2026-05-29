import type { PrismaClient } from "../generated/prisma/client";

export async function requireGroupMembership(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { status: true },
  });

  if (!membership || membership.status !== "active") {
    throw new Error("Active group membership required.");
  }
}

export async function joinOpenGroup(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<{ groupId: string }> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { membershipPolicy: true },
  });

  if (!group) throw new Error("Group not found.");
  if (group.membershipPolicy !== "open") throw new Error("This group is not open to join.");

  await prisma.groupMembership.upsert({
    where: { accountId_groupId: { accountId, groupId } },
    update: { status: "active" },
    create: { accountId, groupId, status: "active" },
  });

  return { groupId };
}
