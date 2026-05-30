import type { PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";

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

  const existingMembership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { status: true },
  });

  if (existingMembership?.status === "revoked") {
    throw new Error("Revoked memberships cannot be reactivated through open join.");
  }

  if (existingMembership?.status === "pending") {
    throw new Error("Pending memberships cannot be activated through open join.");
  }

  if (existingMembership?.status !== "active") {
    const membership = await prisma.groupMembership.upsert({
      where: { accountId_groupId: { accountId, groupId } },
      update: { status: "active" },
      create: { accountId, groupId, status: "active" },
    });

    await logAction(prisma, {
      actorAccountId: accountId,
      groupId,
      action: "membership.joined",
      targetType: "group_membership",
      targetId: membership.id,
    });
  }

  return { groupId };
}

export async function leaveGroup(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.update({
    where: { accountId_groupId: { accountId, groupId } },
    data: { status: "inactive" },
  });

  await logAction(prisma, {
    actorAccountId: accountId,
    groupId,
    action: "membership.left",
    targetType: "group_membership",
    targetId: membership.id,
  });
}
