import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { AssignmentEndReason } from "../generated/prisma/enums";
import { openPetition, requireApprovedPetition } from "./petitions";
import { resolveGovernanceParams } from "./governance-resolver";

// An assignment is active when endedAt is null AND expiresAt is in the future.

async function endAssignment(
  prisma: PrismaClient,
  assignmentId: string,
  reason: AssignmentEndReason,
): Promise<void> {
  await prisma.responsibilityAssignment.update({
    where: { id: assignmentId },
    data: { endedAt: new Date(), endReason: reason },
  });
}

/**
 * Post-confirmation primitive: upsert the Responsibility for this group+type,
 * then create a ResponsibilityAssignment. Assumes community confirmation has
 * already occurred. Do not call this as a substitute for the volunteer →
 * confirmation → assignment flow (deferred to governance temperature phase).
 */
export async function createAssignment(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { groupId: true },
  });

  const responsibility = await prisma.responsibility.upsert({
    where: { groupId_type: { groupId: membership.groupId, type } },
    update: {},
    create: { groupId: membership.groupId, type },
  });

  // Skip if an active assignment already exists (idempotent for seed/migration use)
  const existing = await prisma.responsibilityAssignment.findFirst({
    where: { responsibilityId: responsibility.id, membershipId, endedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existing) return;

  const expiresAt = new Date(Date.now() + responsibility.termDays * 24 * 60 * 60 * 1000);

  await prisma.responsibilityAssignment.create({
    data: { responsibilityId: responsibility.id, membershipId, expiresAt },
  });
}

/**
 * Raw record check: assignment exists, endedAt IS NULL, expiresAt > now().
 * Does NOT check membership status or participation status.
 *
 * After a correct participation transition (Quiet/Dormant), assignments are
 * terminated via endAssignmentsForMember — so this function will already
 * return false for those members. Use for historical queries and internal
 * helpers only.
 */
export async function hasUnendedAssignment(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
): Promise<boolean> {
  const assignment = await prisma.responsibilityAssignment.findFirst({
    where: {
      membershipId,
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { type },
    },
  });
  return assignment !== null;
}

/**
 * Full eligibility check: not ended + not expired + membership.status active +
 * membership.participationStatus active.
 *
 * Use for all platform permission gates: reviewer eligibility, administrative
 * closure, dashboard badge, coverage. Defense-in-depth for the lazy-evaluation
 * window before participation transitions have run.
 */
export async function hasActiveEligibleAssignment(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
): Promise<boolean> {
  const assignment = await prisma.responsibilityAssignment.findFirst({
    where: {
      membershipId,
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { type },
      membership: { status: "active", participationStatus: "active" },
    },
  });
  return assignment !== null;
}

export type ResponsibilityHolderMembership = {
  membership: { id: string; accountId: string; groupId: string };
  responsibility: { id: string; groupId: string; type: string; descriptionDocumentId: string | null };
};

/**
 * Derives the caller's group membership and active-holder status for a
 * responsibility from the authenticated accountId — never from
 * client-supplied membershipId/groupId. Throws if the caller is not an
 * active, eligible holder of this responsibility.
 */
export async function requireResponsibilityHolderMembership(
  prisma: PrismaClient,
  accountId: string,
  responsibilityId: string,
): Promise<ResponsibilityHolderMembership> {
  const responsibility = await prisma.responsibility.findUniqueOrThrow({
    where: { id: responsibilityId },
    select: { id: true, groupId: true, type: true, descriptionDocumentId: true },
  });

  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId: responsibility.groupId } },
    select: { id: true, accountId: true, groupId: true, status: true, participationStatus: true },
  });

  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Active group membership required.");
  }

  const isHolder = await hasActiveEligibleAssignment(prisma, membership.id, responsibility.type);
  if (!isHolder) {
    throw new Error("Active responsibility holder status required.");
  }

  return {
    membership: { id: membership.id, accountId: membership.accountId, groupId: membership.groupId },
    responsibility,
  };
}

export async function getResponsibilityPurposeDocument(
  prisma: PrismaClient,
  responsibilityId: string,
  descriptionDocumentId: string | null,
) {
  const descriptionDocument = descriptionDocumentId
    ? await prisma.livingDocument.findFirst({
        where: { id: descriptionDocumentId, spaceType: "responsibility", spaceId: responsibilityId, archivedAt: null },
      })
    : null;

  return (
    descriptionDocument ??
    await prisma.livingDocument.findFirst({
      where: { spaceType: "responsibility", spaceId: responsibilityId, archivedAt: null, title: "Purpose" },
      orderBy: { lastRevisedAt: "desc" },
    })
  );
}

/**
 * Returns the membershipIds of all active holders of a responsibility type
 * in a group. Multi-holder by design — no single-seat logic.
 */
export async function getActiveAssignees(
  prisma: PrismaClient,
  groupId: string,
  type: string,
): Promise<string[]> {
  const assignments = await prisma.responsibilityAssignment.findMany({
    where: {
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { groupId, type },
    },
    select: { membershipId: true },
  });
  return assignments.map((a) => a.membershipId);
}

/**
 * Voluntary resignation. Ends all active assignments for this membership+type
 * with reason "resigned". Members need not go Quiet to stop holding a
 * responsibility.
 */
export async function resignAssignment(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
): Promise<void> {
  const assignments = await prisma.responsibilityAssignment.findMany({
    where: {
      membershipId,
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { type },
    },
    select: { id: true },
  });
  for (const a of assignments) {
    await endAssignment(prisma, a.id, "resigned");
  }
}

/**
 * Ends all active assignments for a membership. Called by participation
 * transitions when a member goes Quiet or Dormant.
 * RFC-004: returning to Active restores participation only. Responsibilities
 * require re-volunteering.
 */
export async function endAssignmentsForMember(
  prisma: PrismaClient,
  membershipId: string,
  reason: AssignmentEndReason,
): Promise<void> {
  const assignments = await prisma.responsibilityAssignment.findMany({
    where: { membershipId, endedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  for (const a of assignments) {
    await endAssignment(prisma, a.id, reason);
  }
}

/**
 * Ends all assignments in a group whose term has expired. Call at dashboard
 * load alongside applyParticipationTransitions (lazy expiration — no scheduler
 * required for local beta).
 */
export async function expireStaleAssignments(
  prisma: PrismaClient,
  groupId: string,
): Promise<void> {
  const stale = await prisma.responsibilityAssignment.findMany({
    where: {
      endedAt: null,
      expiresAt: { lte: new Date() },
      responsibility: { groupId },
    },
    select: { id: true },
  });
  for (const a of stale) {
    await endAssignment(prisma, a.id, "expired");
  }
}

/**
 * Derived coverage value — never stored. Returns "covered" when at least one
 * active, active-participation member holds the responsibility. Returns
 * "coverage_failure" otherwise.
 */
export async function getResponsibilityCoverage(
  prisma: PrismaClient,
  groupId: string,
  type: string,
): Promise<"covered" | "coverage_failure"> {
  const active = await prisma.responsibilityAssignment.findFirst({
    where: {
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { groupId, type },
      membership: { status: "active", participationStatus: "active" },
    },
  });
  return active ? "covered" : "coverage_failure";
}

/**
 * Emergency coverage declaration. Creates an assignment for an active member
 * ONLY when coverage has already failed. Duration is resolver-driven via
 * emergency.duration (resolved once at declaration time — never re-resolved).
 * Default = 30 days at neutral temperature.
 *
 * Temporary stewardship is treated as an emergency governance mechanism.
 * Its duration follows the same emergency.duration parameter as a declared
 * emergency period, keeping the two mechanisms consistent.
 *
 * Multiple declarations are allowed (no single-seat logic). Refused when
 * coverage is already present to prevent bypassing normal confirmation.
 */
export async function declareTempStewardship(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });

  if (membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Only active members may declare temporary stewardship.");
  }

  const coverage = await getResponsibilityCoverage(prisma, membership.groupId, type);
  if (coverage !== "coverage_failure") {
    throw new Error(
      "Temporary stewardship may only be declared during a coverage failure. " +
        "Use the normal confirmation process when coverage is present.",
    );
  }

  const responsibility = await prisma.responsibility.upsert({
    where: { groupId_type: { groupId: membership.groupId, type } },
    update: {},
    create: { groupId: membership.groupId, type },
  });

  // Resolve duration once at declaration time. Never re-resolves after this point.
  const { duration = 30 } = await resolveGovernanceParams(prisma, membership.groupId, "emergency");
  const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

  await prisma.responsibilityAssignment.create({
    data: { responsibilityId: responsibility.id, membershipId, expiresAt },
  });
}

// --- RFC-006: Governance wrappers ---

/**
 * Opens a community confirmation petition for a volunteer.
 * Responsibilities are multi-holder by design — multiple volunteers may be
 * confirmed simultaneously, so petitions do not compete (competitionKey = null).
 *
 * groupId is derived from the membership record, not supplied by the caller,
 * preventing a petition in one group from approving an assignment in another.
 *
 * subjectId encodes both membershipId and responsibility type as "{membershipId}:{type}"
 * so confirmResponsibilityAssignment can reconstruct both at approval time.
 * Volunteer withdrawal: call withdrawPetitionBySubject with the same encoded subjectId.
 */
export async function volunteerForResponsibility(
  prisma: PrismaClient,
  { membershipId, type }: { membershipId: string; type: string },
) {
  const membership = await prisma.groupMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { groupId: true },
  });

  return openPetition(prisma, {
    groupId: membership.groupId,
    category: "responsibility",
    subjectType: "responsibility_proposal",
    subjectId: `${membershipId}:${type}`,
    createdByMembershipId: membershipId,
  });
}

/**
 * Called after a responsibility petition is approved.
 * Creates the assignment using the petition snapshot's reconfirmationPeriod —
 * does NOT mutate Responsibility.termDays.
 *
 * Verifies petition is approved and of the correct family before executing.
 * For seed/admin/migration use, call createAssignment() directly (the internal primitive).
 */
export async function confirmResponsibilityAssignment(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  // Fix 2: verify petition is approved and of the correct family
  const petition = await requireApprovedPetition(prisma, petitionId, "responsibility_proposal");
  const snapshot = petition.governanceSnapshot as { reconfirmationPeriod: number };

  // subjectId is encoded as "{membershipId}:{type}"
  const colonIdx = petition.subjectId.indexOf(":");
  const membershipId = petition.subjectId.slice(0, colonIdx);
  const type = petition.subjectId.slice(colonIdx + 1);

  const membership = await prisma.groupMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { groupId: true },
  });

  const responsibility = await prisma.responsibility.upsert({
    where: { groupId_type: { groupId: membership.groupId, type } },
    update: {},
    create: { groupId: membership.groupId, type },
  });

  // Skip if an active assignment already exists (idempotent)
  const existing = await prisma.responsibilityAssignment.findFirst({
    where: { responsibilityId: responsibility.id, membershipId, endedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existing) return;

  // expiresAt derived from governance snapshot — not from Responsibility.termDays
  const expiresAt = new Date(Date.now() + snapshot.reconfirmationPeriod * 24 * 60 * 60 * 1000);

  await prisma.responsibilityAssignment.create({
    data: { responsibilityId: responsibility.id, membershipId, expiresAt },
  });
}
