import type { PrismaClient } from "../generated/prisma/client";
import { resolveWriteAuthority } from "./continuity";

// Continuity write-authority gate for coalition writes (register F-9,
// F3.5 Phase 5): a coalition's writes do NOT flow through the petition
// resolver, so every coalition write path calls this — the page actions,
// the mediated-action handler, and the broadcast apply path.
export async function requireCoalitionWritable(
  prisma: PrismaClient,
  coalitionId: string,
): Promise<void> {
  const authority = await resolveWriteAuthority(prisma, { entityType: "coalition", entityId: coalitionId });
  if (authority !== "writable") {
    throw new Error("This coalition is in continuity failover and is temporarily read-only.");
  }
}

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
