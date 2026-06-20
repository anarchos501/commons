import { createPrismaClient } from "../../../../../../lib/prisma";

// Shared membership guards for group module server actions. Self-contained (own prisma client),
// so they're safe to import from any extracted module's actions file. Behavior is identical to the
// previous inline definitions on the group page.

export async function requireMembership(accountId: string, groupId: string) {
  const prisma = createPrismaClient();
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true, participationStatus: true },
  });
  await prisma.$disconnect();
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Active group membership required.");
  }
  return membership;
}

// Status-only check — for concern submission, which is available to all active-status members.
export async function requireGroupMembershipStatus(accountId: string, groupId: string) {
  const prisma = createPrismaClient();
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true },
  });
  await prisma.$disconnect();
  if (!membership || membership.status !== "active") throw new Error("Group membership required.");
  return membership;
}
