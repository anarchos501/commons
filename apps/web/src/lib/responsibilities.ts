import type { PrismaClient } from "../generated/prisma/client";
import type { AssignmentEndReason } from "../generated/prisma/enums";

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
 * Emergency coverage declaration. Creates a 30-day assignment for an active
 * member ONLY when coverage has already failed. Multiple declarations are
 * allowed simultaneously (no single-seat logic). Refused when coverage is
 * already present to prevent bypassing normal confirmation.
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

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.responsibilityAssignment.create({
    data: { responsibilityId: responsibility.id, membershipId, expiresAt },
  });
}
