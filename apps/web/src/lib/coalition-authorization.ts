import type { PrismaClient } from "../generated/prisma/client";

export async function requireCoalitionParticipant(
  prisma: PrismaClient,
  accountId: string,
  coalitionId: string,
): Promise<{ accountId: string }> {
  const membership = await prisma.groupMembership.findFirst({
    where: {
      accountId,
      status: "active",
      participationStatus: "active",
      group: {
        coalitionMemberships: {
          some: {
            coalitionId,
            endedAt: null,
            coalition: { status: "active" },
          },
        },
      },
    },
    select: { accountId: true },
  });
  if (!membership) {
    throw new Error("Active membership in a coalition member group is required.");
  }
  return { accountId: membership.accountId };
}

export async function requireCoalitionAccess(
  prisma: PrismaClient,
  accountId: string,
  coalitionId: string,
): Promise<void> {
  if (!(await canAccessCoalition(prisma, accountId, coalitionId))) {
    throw new Error("Active membership in a coalition member group is required.");
  }
}

export async function canAccessCoalition(
  prisma: PrismaClient,
  accountId: string,
  coalitionId: string,
): Promise<boolean> {
  const count = await prisma.groupMembership.count({
    where: {
      accountId,
      status: "active",
      group: {
        coalitionMemberships: {
          some: {
            coalitionId,
            endedAt: null,
            coalition: { status: "active" },
          },
        },
      },
    },
  });
  return count > 0;
}
