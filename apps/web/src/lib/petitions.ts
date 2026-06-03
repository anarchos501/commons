import { type PrismaClient, Prisma } from "../generated/prisma/client";
import { isGovernanceCategory } from "./governance-categories";
import { isProposalFamily, categoryForFamily, deriveCompetitionKey } from "./governance-proposal-families";
import { snapshotGovernanceParams } from "./governance-resolver";
import { getActiveParticipantCount, getActiveVoterCount } from "./participation";

export type PetitionStatus = "open" | "approved" | "rejected" | "withdrawn" | "superseded" | "blocked";

export type OpenPetitionResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "invalid_family" | "category_mismatch" | "creator_not_eligible" | "petition_already_open" };

export type EvaluateResult =
  | { outcome: "approved" | "rejected" | "blocked" }
  | { outcome: "pending" };

// --- Fix 2: shared guard for execution handlers ---

type ApprovedPetitionPayload = {
  id: string;
  groupId: string;
  subjectId: string;
  subjectType: string;
  category: string;
  createdByMembershipId: string | null;
  governanceSnapshot: unknown;
};

/**
 * Loads a petition and asserts it is approved with the expected proposal family.
 * All execution handlers must call this before executing category-specific side effects.
 * Throws if the petition is not approved, or if the subjectType does not match expectedFamily.
 */
export async function requireApprovedPetition(
  prisma: PrismaClient,
  petitionId: string,
  expectedFamily: string,
): Promise<ApprovedPetitionPayload> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { id: true, groupId: true, subjectId: true, subjectType: true, category: true, status: true, createdByMembershipId: true, governanceSnapshot: true },
  });

  if (!petition) {
    throw new Error(`Petition ${petitionId} not found.`);
  }
  if (petition.status !== "approved") {
    throw new Error(`Petition ${petitionId} is not approved (status: ${petition.status}). Execution handlers must only be called after approval.`);
  }
  if (petition.subjectType !== expectedFamily) {
    throw new Error(`Petition ${petitionId} has subjectType "${petition.subjectType}", expected "${expectedFamily}".`);
  }

  return petition as ApprovedPetitionPayload;
}

// --- Fix 3: openPetition validates creator membership ---

export async function openPetition(
  prisma: PrismaClient,
  {
    groupId,
    category,
    subjectType,
    subjectId,
    createdByMembershipId,
    voterScope,
  }: {
    groupId: string;
    category: string;
    subjectType: string;
    subjectId: string;
    createdByMembershipId: string;
    // null = group-wide voting (default). { type: "project", scopeId } = project-member voting.
    voterScope?: { type: "project"; scopeId: string } | null;
  },
): Promise<OpenPetitionResult> {
  if (!isProposalFamily(subjectType)) {
    return { ok: false, reason: "invalid_family" };
  }

  const expectedCategory = categoryForFamily(subjectType);
  if (category !== expectedCategory) {
    return { ok: false, reason: "category_mismatch" };
  }

  if (!isGovernanceCategory(category)) {
    return { ok: false, reason: "category_mismatch" };
  }

  // Fix 3: validate the creator membership belongs to this group and is active
  const creatorMembership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !creatorMembership ||
    creatorMembership.groupId !== groupId ||
    creatorMembership.status !== "active" ||
    creatorMembership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "creator_not_eligible" };
  }

  const snapshot = await snapshotGovernanceParams(prisma, groupId, category);
  // Fix 1: groupId is included in the key so petitions in different groups never compete.
  const competitionKey = deriveCompetitionKey(subjectType, subjectId, groupId);

  const opensAt = new Date();
  const closesAt = new Date(opensAt.getTime() + snapshot.petitionDuration * 24 * 60 * 60 * 1000);

  try {
    const petition = await prisma.petition.create({
      data: {
        groupId,
        category,
        subjectType,
        subjectId,
        competitionKey,
        status: "open",
        governanceSnapshot: snapshot as object,
        voterScope: voterScope ?? Prisma.JsonNull,
        opensAt,
        closesAt,
        createdByMembershipId,
      },
    });
    return { ok: true, petitionId: petition.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "petition_already_open" };
    }
    throw err;
  }
}

export type AddSupportResult =
  | { ok: true }
  | { ok: false; reason: "petition_not_open" | "not_eligible" | "not_eligible_in_scope" };

// Fix 1: check both status and closesAt on add
export async function addPetitionSupport(
  prisma: PrismaClient,
  { petitionId, membershipId }: { petitionId: string; membershipId: string },
): Promise<AddSupportResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { groupId: true, status: true, closesAt: true, voterScope: true },
  });

  if (!petition || petition.status !== "open" || new Date() >= petition.closesAt) {
    return { ok: false, reason: "petition_not_open" };
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });

  if (
    !membership ||
    membership.groupId !== petition.groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  // Additional scope check for project-scoped petitions
  const scope = petition.voterScope as { type: string; scopeId: string } | null;
  if (scope?.type === "project") {
    const projectMembership = await prisma.projectMembership.findFirst({
      where: {
        projectId: scope.scopeId,
        accountId: membership.accountId,
        status: "active",
        participationStatus: "active",
      },
    });
    if (!projectMembership) {
      return { ok: false, reason: "not_eligible_in_scope" };
    }
  }

  await prisma.petitionSupport.upsert({
    where: { petitionId_membershipId: { petitionId, membershipId } },
    update: {},
    create: { petitionId, membershipId },
  });

  return { ok: true };
}

export type WithdrawSupportResult =
  | { ok: true }
  | { ok: false; reason: "petition_not_open" };

// Fix 1: check both status and closesAt on withdraw
export async function withdrawPetitionSupport(
  prisma: PrismaClient,
  { petitionId, membershipId }: { petitionId: string; membershipId: string },
): Promise<WithdrawSupportResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, closesAt: true },
  });

  if (!petition || petition.status !== "open" || new Date() >= petition.closesAt) {
    return { ok: false, reason: "petition_not_open" };
  }

  await prisma.petitionSupport.deleteMany({ where: { petitionId, membershipId } });
  return { ok: true };
}

// Standard evaluation path — only for non-emergency petitions.
// Requires now >= closesAt. Returns "pending" if called too early.
// Fix 5: competing petitions resolved fully inside an interactive transaction.
export async function evaluatePetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: {
      id: true,
      groupId: true,
      status: true,
      closesAt: true,
      competitionKey: true,
      governanceSnapshot: true,
      voterScope: true,
    },
  });

  if (!petition || petition.status !== "open") {
    return { outcome: "pending" };
  }

  if (new Date() < petition.closesAt) {
    return { outcome: "pending" };
  }

  const snapshot = petition.governanceSnapshot as { threshold: number };
  const eligible = await getActiveVoterCount(prisma, petition);

  if (eligible === 0) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "blocked", resolvedAt: new Date() } });
    return { outcome: "blocked" };
  }

  if (petition.competitionKey) {
    return resolveCompetingPetitions(prisma, petition.competitionKey, petition.groupId, eligible, snapshot.threshold);
  }

  return resolveSinglePetition(prisma, petitionId, eligible, snapshot.threshold);
}

// Emergency evaluation — may be called before closesAt when threshold is crossed.
// Returns "pending" if threshold not yet reached.
// Note: closesAt is intentionally NOT checked here — emergency petitions activate early by design.
export async function evaluateEmergencyPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { id: true, groupId: true, status: true, category: true, subjectType: true, governanceSnapshot: true },
  });

  if (!petition || petition.status !== "open") {
    return { outcome: "pending" };
  }

  // Fix 1: guard against being called on non-emergency petitions.
  // A non-emergency petition with enough support would otherwise be approved before its window closes.
  if (petition.category !== "emergency" || petition.subjectType !== "emergency_declaration") {
    throw new Error(
      `evaluateEmergencyPetition must only be called on emergency_declaration petitions. ` +
        `Got category="${petition.category}", subjectType="${petition.subjectType}" for petition ${petitionId}.`,
    );
  }

  const snapshot = petition.governanceSnapshot as { threshold: number };
  const eligible = await getActiveParticipantCount(prisma, petition.groupId);

  if (eligible === 0) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "blocked", resolvedAt: new Date() } });
    return { outcome: "blocked" };
  }

  const supportCount = await prisma.petitionSupport.count({ where: { petitionId } });

  if (supportCount / eligible >= snapshot.threshold) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "approved", resolvedAt: new Date() } });
    return { outcome: "approved" };
  }

  return { outcome: "pending" };
}

export async function withdrawPetition(
  prisma: PrismaClient,
  petitionId: string,
  byMembershipId: string,
): Promise<void> {
  await prisma.petition.updateMany({
    where: { id: petitionId, createdByMembershipId: { equals: byMembershipId }, status: "open" },
    data: { status: "withdrawn", resolvedAt: new Date() },
  });
}

// Withdraw petition when the subject entity is withdrawn (e.g. volunteer withdraws candidacy).
// Sets status to "withdrawn" without checking createdBy.
export async function withdrawPetitionBySubject(
  prisma: PrismaClient,
  { subjectType, subjectId }: { subjectType: string; subjectId: string },
): Promise<void> {
  await prisma.petition.updateMany({
    where: { subjectType, subjectId, status: "open" },
    data: { status: "withdrawn", resolvedAt: new Date() },
  });
}

async function resolveSinglePetition(
  prisma: PrismaClient,
  petitionId: string,
  eligible: number,
  threshold: number,
): Promise<EvaluateResult> {
  const supportCount = await prisma.petitionSupport.count({ where: { petitionId } });
  const outcome: PetitionStatus = supportCount / eligible >= threshold ? "approved" : "rejected";
  await prisma.petition.update({ where: { id: petitionId }, data: { status: outcome, resolvedAt: new Date() } });
  return { outcome };
}

// Fix 5: fully atomic competing petition resolution.
// Only resolves petitions whose windows have closed. Reads and writes in one interactive transaction.
async function resolveCompetingPetitions(
  prisma: PrismaClient,
  competitionKey: string,
  groupId: string,
  eligible: number,
  threshold: number,
): Promise<EvaluateResult> {
  const now = new Date();
  const resolvedAt = now;

  return prisma.$transaction(async (tx) => {
    // Fix 2: if a winner already exists for this competition key, reject all remaining competitors.
    // Without this check, petition A wins in round 1; petition B (same key) later closes and
    // also meets threshold, producing a second winner.
    // Fix 1 defense-in-depth: scope all queries by both competitionKey and groupId.
    // The key already contains groupId, but the explicit groupId filter ensures
    // correct behavior even if the key format ever changes.
    const existingWinner = await tx.petition.findFirst({
      where: { competitionKey, groupId, status: "approved" },
      select: { id: true },
    });

    // Only consider petitions whose petition window has closed
    const closedPetitions = await tx.petition.findMany({
      where: { competitionKey, groupId, status: "open", closesAt: { lte: now } },
      select: { id: true },
    });

    if (closedPetitions.length === 0) {
      return { outcome: "pending" };
    }

    const counts = await Promise.all(
      closedPetitions.map(async (p) => ({
        id: p.id,
        count: await tx.petitionSupport.count({ where: { petitionId: p.id } }),
      })),
    );

    if (existingWinner) {
      // A winner already exists — late-arriving closed petitions are automatically rejected
      await tx.petition.updateMany({
        where: { id: { in: counts.map((c) => c.id) } },
        data: { status: "rejected", resolvedAt },
      });
      return { outcome: "rejected" };
    }

    const maxCount = Math.max(...counts.map((c) => c.count));
    const winners = counts.filter((c) => c.count === maxCount && c.count / eligible >= threshold);

    if (winners.length === 1) {
      const winnerId = winners[0].id;
      const loserIds = counts.filter((c) => c.id !== winnerId).map((c) => c.id);
      await tx.petition.update({ where: { id: winnerId }, data: { status: "approved", resolvedAt } });
      if (loserIds.length > 0) {
        await tx.petition.updateMany({ where: { id: { in: loserIds } }, data: { status: "rejected", resolvedAt } });
      }
      return { outcome: "approved" };
    }

    // Tie or nobody met threshold — reject only those with closed windows
    await tx.petition.updateMany({
      where: { id: { in: counts.map((c) => c.id) } },
      data: { status: "rejected", resolvedAt },
    });
    return { outcome: "rejected" };
  });
}
