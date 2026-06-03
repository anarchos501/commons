import type { PrismaClient } from "../generated/prisma/client";
import { openPetition, evaluateEmergencyPetition, requireApprovedPetition } from "./petitions";
import { resolveGovernanceParams } from "./governance-resolver";

/**
 * Returns true if an active EmergencyPeriod exists for the group.
 * Derived check — never stored. Consistent with the pattern established by
 * getResponsibilityCoverage() which is also always computed on demand.
 */
export async function isEmergencyActive(prisma: PrismaClient, groupId: string): Promise<boolean> {
  const now = new Date();
  const period = await prisma.emergencyPeriod.findFirst({
    where: {
      groupId,
      startedAt: { lte: now },
      expiresAt: { gt: now },
      endedAt: null,
    },
  });
  return period !== null;
}

/**
 * Opens an emergency declaration petition.
 * Emergency petitions may activate immediately upon reaching threshold —
 * callers should invoke evaluateEmergencyPetition after each support signal.
 */
export async function openEmergencyPetition(
  prisma: PrismaClient,
  { groupId, createdByMembershipId }: { groupId: string; createdByMembershipId: string },
) {
  return openPetition(prisma, {
    groupId,
    category: "emergency",
    subjectType: "emergency_declaration",
    subjectId: groupId,
    createdByMembershipId,
  });
}

/**
 * Called after an emergency petition is approved (including early activation).
 * Creates an EmergencyPeriod using expiresAt = petition.governanceSnapshot.duration.
 *
 * Constitutional Invariant: uses the frozen snapshot value — does NOT re-call the
 * live resolver. Whatever duration was resolved at petition open time governs the period.
 *
 * Fix 2: verifies petition is approved and of the correct family before executing.
 */
export async function onEmergencyPetitionApproved(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "emergency_declaration");

  const snapshot = petition.governanceSnapshot as { duration: number };
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + snapshot.duration * 24 * 60 * 60 * 1000);

  await prisma.emergencyPeriod.create({
    data: { groupId: petition.groupId, petitionId, startedAt, expiresAt },
  });
}

/**
 * Convenience: signal support for an emergency petition, then immediately
 * attempt early activation if threshold is crossed.
 * Returns the evaluation result; callers should call onEmergencyPetitionApproved
 * if outcome is "approved".
 */
export async function signalAndEvaluateEmergency(
  prisma: PrismaClient,
  { petitionId, membershipId }: { petitionId: string; membershipId: string },
) {
  const { addPetitionSupport } = await import("./petitions");
  const supportResult = await addPetitionSupport(prisma, { petitionId, membershipId });
  if (!supportResult.ok) return { support: supportResult, eval: null };
  const evalResult = await evaluateEmergencyPetition(prisma, petitionId);
  return { support: supportResult, eval: evalResult };
}

/**
 * Creates a new emergency period directly (no petition) — used for temporary
 * stewardship when an existing emergency period is wanted but no petition was opened.
 * Duration is resolved once at call time via the governance resolver.
 */
export async function createEmergencyPeriodDirect(
  prisma: PrismaClient,
  { groupId }: { groupId: string },
): Promise<void> {
  // Resolve duration once at creation time — matches the snapshot-invariant principle
  const { duration = 30 } = await resolveGovernanceParams(prisma, groupId, "emergency");
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + duration * 24 * 60 * 60 * 1000);
  await prisma.emergencyPeriod.create({ data: { groupId, startedAt, expiresAt } });
}
