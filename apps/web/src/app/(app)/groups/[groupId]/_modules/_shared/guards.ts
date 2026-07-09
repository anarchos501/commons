import { resolveWriteAuthority } from "../../../../../../lib/continuity";
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
  // Continuity write-authority gate (register F-9): every group-module
  // server action passes through this guard, so a group whose lease has
  // lapsed (or that is unverified after a restart) is read-only here too.
  const authority = membership ? await resolveWriteAuthority(prisma, { entityType: "group", entityId: groupId }) : "writable";
  await prisma.$disconnect();
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Active group membership required.");
  }
  if (authority !== "writable") {
    throw new Error("This collective is in continuity failover and is temporarily read-only.");
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
  // Continuity gate (register F-9, Phase 6 sweep finding): the status-only
  // guard is deliberately more permissive about WHO may act — never about
  // WHETHER the group is writable.
  const authority = membership ? await resolveWriteAuthority(prisma, { entityType: "group", entityId: groupId }) : "writable";
  await prisma.$disconnect();
  if (!membership || membership.status !== "active") throw new Error("Group membership required.");
  if (authority !== "writable") {
    throw new Error("This collective is in continuity failover and is temporarily read-only.");
  }
  return membership;
}
