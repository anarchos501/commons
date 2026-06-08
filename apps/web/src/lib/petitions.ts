import { type PrismaClient, Prisma } from "../generated/prisma/client";
import { isGovernanceCategory } from "./governance-categories";
import { isProposalFamily, categoryForFamily, deriveCompetitionKey } from "./governance-proposal-families";
import { snapshotGovernanceParams } from "./governance-resolver";
import type { ProjectVoterScope } from "./participation";
import { getActiveParticipantCount, getActiveVoterCount } from "./participation";
import {
  getActiveNodeVoterCount,
  requireActiveNodeHost,
  requireActiveNodeUser,
  resolveNodeGovernanceParams,
} from "./node-governance";

export type PetitionStatus = "open" | "approved" | "rejected" | "withdrawn" | "superseded" | "blocked";

export type OpenPetitionResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "invalid_family" | "category_mismatch" | "creator_not_eligible" | "petition_already_open" };

export type EvaluateResult =
  | { outcome: "approved" | "rejected" | "blocked" }
  | { outcome: "pending" };

// ── Approved petition payload ─────────────────────────────────────────────────

type ApprovedPetitionPayload = {
  id: string;
  groupId: string;     // always non-null: coalesced from groupId ?? scopeId in requireApprovedPetition
  scopeType: string;
  scopeId: string;
  subjectId: string;
  subjectType: string;
  category: string;
  createdByMembershipId: string | null;
  createdByProjectMembershipId: string | null;
  governanceSnapshot: unknown;
};

/**
 * Loads a petition and asserts it is approved with the expected proposal family.
 * All execution handlers must call this before executing category-specific side effects.
 */
export async function requireApprovedPetition(
  prisma: PrismaClient,
  petitionId: string,
  expectedFamily: string,
): Promise<ApprovedPetitionPayload> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: {
      id: true,
      groupId: true,
      scopeType: true,
      scopeId: true,
      subjectId: true,
      subjectType: true,
      category: true,
      status: true,
      createdByMembershipId: true,
      createdByProjectMembershipId: true,
      governanceSnapshot: true,
    },
  });

  if (!petition) throw new Error(`Petition ${petitionId} not found.`);
  if (petition.status !== "approved") {
    throw new Error(
      `Petition ${petitionId} is not approved (status: ${petition.status}). ` +
      `Execution handlers must only be called after approval.`,
    );
  }
  if (petition.subjectType !== expectedFamily) {
    throw new Error(
      `Petition ${petitionId} has subjectType "${petition.subjectType}", expected "${expectedFamily}".`,
    );
  }

  // Coalesce groupId → scopeId so approval handlers always get a non-null groupId.
  // All existing handlers are group-scoped; for project-scoped petitions this would
  // return the projectId, but no approval handlers target project-scoped content yet.
  return {
    ...petition,
    groupId: petition.groupId ?? petition.scopeId,
  } as ApprovedPetitionPayload;
}

// ── openPetition ──────────────────────────────────────────────────────────────

export async function openPetition(
  prisma: PrismaClient,
  {
    groupId,
    category,
    subjectType,
    subjectId,
    createdByMembershipId,
    createdByProjectMembershipId,
    voterScope,
    scopeType: requestedScopeType,
    scopeId: requestedScopeId,
    systemInitiated = false,
  }: {
    groupId: string;                       // governing group (sets both groupId and scopeId for group-scoped petitions)
    category: string;
    subjectType: string;
    subjectId: string;
    createdByMembershipId?: string | null; // group-member creator (most petitions)
    createdByProjectMembershipId?: string | null; // project-member creator (project-internal petitions)
    voterScope?: ProjectVoterScope | null;
    scopeType?: "group" | "project" | "responsibility";
    scopeId?: string;
    systemInitiated?: boolean;
  },
): Promise<OpenPetitionResult> {
  if (!isProposalFamily(subjectType)) return { ok: false, reason: "invalid_family" };

  const expectedCategory = categoryForFamily(subjectType);
  if (category !== expectedCategory) return { ok: false, reason: "category_mismatch" };
  if (!isGovernanceCategory(category)) return { ok: false, reason: "category_mismatch" };

  // Validate creator eligibility by scope
  if (createdByMembershipId) {
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
  } else if (createdByProjectMembershipId) {
    const creatorMembership = await prisma.projectMembership.findUnique({
      where: { id: createdByProjectMembershipId },
      select: { projectId: true, status: true, participationStatus: true },
    });
    const projectScopeId = requestedScopeType === "project" ? requestedScopeId : voterScope?.scopeId;
    if (
      !creatorMembership ||
      !projectScopeId ||
      creatorMembership.projectId !== projectScopeId ||
      creatorMembership.status !== "active" ||
      creatorMembership.participationStatus !== "active"
    ) {
      return { ok: false, reason: "creator_not_eligible" };
    }
  } else if (!systemInitiated) {
    return { ok: false, reason: "creator_not_eligible" };
  }

  const scopeType = requestedScopeType ?? (voterScope?.type === "project" || voterScope?.type === "project_frozen" ? "project" : "group");
  const scopeId = requestedScopeId ?? (scopeType === "project" ? voterScope?.scopeId : groupId);
  if (!scopeId) return { ok: false, reason: "creator_not_eligible" };

  const snapshot = await snapshotGovernanceParams(prisma, groupId, category);
  const competitionScopeId = scopeType === "project" ? scopeId : groupId;
  const competitionKey = deriveCompetitionKey(subjectType, subjectId, competitionScopeId);

  const opensAt = new Date();
  const closesAt = new Date(opensAt.getTime() + snapshot.petitionDuration * 24 * 60 * 60 * 1000);

  try {
    const petition = await prisma.petition.create({
      data: {
        groupId,
        scopeType,
        scopeId,
        category,
        subjectType,
        subjectId,
        competitionKey,
        status: "open",
        governanceSnapshot: snapshot as object,
        voterScope: voterScope ?? (scopeType === "project" ? { type: "project", scopeId } : Prisma.JsonNull),
        opensAt,
        closesAt,
        createdByMembershipId: createdByMembershipId ?? null,
        createdByProjectMembershipId: createdByProjectMembershipId ?? null,
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

export async function openSystemGroupPetition(
  prisma: PrismaClient,
  input: {
    groupId: string;
    category: string;
    subjectType: string;
    subjectId: string;
  },
): Promise<OpenPetitionResult> {
  return openPetition(prisma, { ...input, systemInitiated: true });
}

export async function openNodePetition(
  prisma: PrismaClient,
  {
    nodeId,
    category,
    subjectType,
    subjectId,
    createdByAccountId = null,
    competitionSubjectId,
  }: {
    nodeId: string;
    category: string;
    subjectType: string;
    subjectId: string;
    createdByAccountId?: string | null;
    competitionSubjectId?: string;
  },
): Promise<OpenPetitionResult> {
  if (!isProposalFamily(subjectType)) return { ok: false, reason: "invalid_family" };
  if (categoryForFamily(subjectType) !== category || !isGovernanceCategory(category)) {
    return { ok: false, reason: "category_mismatch" };
  }
  if (createdByAccountId) await requireActiveNodeHost(prisma, nodeId, createdByAccountId);
  const snapshot = await resolveNodeGovernanceParams(prisma, nodeId, category);
  const effectiveSnapshot =
    subjectType === "node_steward_no_confidence"
      ? {
          ...snapshot,
          threshold: Math.max(snapshot.threshold, snapshot.noConfidenceThreshold ?? snapshot.threshold),
        }
      : snapshot;
  const opensAt = new Date();
  const closesAt = new Date(opensAt.getTime() + effectiveSnapshot.petitionDuration * 24 * 60 * 60 * 1000);
  const competitionKey = deriveCompetitionKey(
    subjectType,
    competitionSubjectId ?? subjectId,
    nodeId,
  );
  try {
    const petition = await prisma.petition.create({
      data: {
        groupId: null,
        scopeType: "node",
        scopeId: nodeId,
        category,
        subjectType,
        subjectId,
        competitionKey,
        status: "open",
        governanceSnapshot: effectiveSnapshot as object,
        voterScope: Prisma.JsonNull,
        opensAt,
        closesAt,
        createdByAccountId,
      },
    });
    return { ok: true, petitionId: petition.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "petition_already_open" };
    }
    throw error;
  }
}

// ── addPetitionSupport ────────────────────────────────────────────────────────

export type AddSupportResult =
  | { ok: true }
  | { ok: false; reason: "petition_not_open" | "not_eligible" | "not_eligible_in_scope" | "invalid_membership" };

export async function addPetitionSupport(
  prisma: PrismaClient,
  {
    petitionId,
    membershipId,          // group membership (group-scoped petitions)
    projectMembershipId,   // project membership (project-scoped petitions — Phase 5)
  }: {
    petitionId: string;
    membershipId?: string | null;
    projectMembershipId?: string | null;
  },
): Promise<AddSupportResult> {
  // Exactly one membership type must be provided
  if ((!membershipId && !projectMembershipId) || (membershipId && projectMembershipId)) {
    return { ok: false, reason: "invalid_membership" };
  }

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { groupId: true, scopeType: true, scopeId: true, status: true, closesAt: true, voterScope: true },
  });

  if (!petition || petition.status !== "open" || new Date() >= petition.closesAt) {
    return { ok: false, reason: "petition_not_open" };
  }

  if (membershipId) {
    if (petition.scopeType === "project") return { ok: false, reason: "not_eligible" };
    // Group-scoped support: validate GroupMembership
    const membership = await prisma.groupMembership.findUnique({
      where: { id: membershipId },
      select: { groupId: true, status: true, participationStatus: true, accountId: true },
    });

    const governingGroupId = petition.groupId ?? petition.scopeId;
    if (
      !membership ||
      membership.groupId !== governingGroupId ||
      membership.status !== "active" ||
      membership.participationStatus !== "active"
    ) {
      return { ok: false, reason: "not_eligible" };
    }

    // Additional scope check for project-scoped voter scope
    const scope = petition.voterScope as ProjectVoterScope | null;
    if (scope?.type === "project") {
      const projectMembership = await prisma.projectMembership.findFirst({
        where: {
          projectId: scope.scopeId,
          accountId: membership.accountId,
          status: "active",
          participationStatus: "active",
        },
      });
      if (!projectMembership) return { ok: false, reason: "not_eligible_in_scope" };
    }

    // createMany + skipDuplicates respects partial unique indexes (ON CONFLICT DO NOTHING)
    await prisma.petitionSupport.createMany({
      data: [{ petitionId, membershipId }],
      skipDuplicates: true,
    });
  } else if (projectMembershipId) {
    // Project-scoped support: validate ProjectMembership
    const pm = await prisma.projectMembership.findUnique({
      where: { id: projectMembershipId },
      select: { projectId: true, status: true, participationStatus: true },
    });

    const scope = petition.voterScope as ProjectVoterScope | null;
    const projectScopeId =
      petition.scopeType === "project"
        ? petition.scopeId
        : scope?.type === "project" || scope?.type === "project_frozen"
          ? scope.scopeId
          : null;
    if (
      !pm ||
      !projectScopeId ||
      pm.projectId !== projectScopeId ||
      pm.status !== "active" ||
      (scope?.type === "project_frozen"
        ? !scope.membershipIds.includes(projectMembershipId)
        : pm.participationStatus !== "active")
    ) {
      return { ok: false, reason: "not_eligible" };
    }

    await prisma.petitionSupport.createMany({
      data: [{ petitionId, projectMembershipId }],
      skipDuplicates: true,
    });
  }

  return { ok: true };
}

export async function addNodePetitionSupport(
  prisma: PrismaClient,
  {
    petitionId,
    accountId,
  }: {
    petitionId: string;
    accountId: string;
  },
): Promise<AddSupportResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { scopeType: true, scopeId: true, status: true, closesAt: true },
  });
  if (!petition || petition.status !== "open" || new Date() >= petition.closesAt) {
    return { ok: false, reason: "petition_not_open" };
  }
  if (petition.scopeType !== "node") return { ok: false, reason: "not_eligible" };
  try {
    await requireActiveNodeUser(prisma, petition.scopeId, accountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  await prisma.nodePetitionSupport.createMany({
    data: [{ petitionId, nodeId: petition.scopeId, accountId }],
    skipDuplicates: true,
  });
  return { ok: true };
}

// ── withdrawPetitionSupport ───────────────────────────────────────────────────

export type WithdrawSupportResult =
  | { ok: true }
  | { ok: false; reason: "petition_not_open" };

export async function withdrawPetitionSupport(
  prisma: PrismaClient,
  {
    petitionId,
    membershipId,
    projectMembershipId,
  }: {
    petitionId: string;
    membershipId?: string | null;
    projectMembershipId?: string | null;
  },
): Promise<WithdrawSupportResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, closesAt: true },
  });

  if (!petition || petition.status !== "open" || new Date() >= petition.closesAt) {
    return { ok: false, reason: "petition_not_open" };
  }

  if (membershipId) {
    await prisma.petitionSupport.deleteMany({ where: { petitionId, membershipId } });
  } else if (projectMembershipId) {
    await prisma.petitionSupport.deleteMany({ where: { petitionId, projectMembershipId } });
  }

  return { ok: true };
}

export async function withdrawNodePetitionSupport(
  prisma: PrismaClient,
  { petitionId, accountId }: { petitionId: string; accountId: string },
): Promise<WithdrawSupportResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { scopeType: true, status: true, closesAt: true },
  });
  if (
    !petition ||
    petition.scopeType !== "node" ||
    petition.status !== "open" ||
    new Date() >= petition.closesAt
  ) {
    return { ok: false, reason: "petition_not_open" };
  }
  await prisma.nodePetitionSupport.deleteMany({ where: { petitionId, accountId } });
  return { ok: true };
}

// ── evaluatePetition ──────────────────────────────────────────────────────────

export async function evaluatePetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: {
      id: true,
      groupId: true,
      scopeType: true,
      scopeId: true,
      status: true,
      closesAt: true,
      competitionKey: true,
      governanceSnapshot: true,
      voterScope: true,
    },
  });

  if (!petition || petition.status !== "open") return { outcome: "pending" };
  if (new Date() < petition.closesAt) return { outcome: "pending" };

  const snapshot = petition.governanceSnapshot as { threshold: number };
  const eligible =
    petition.scopeType === "node"
      ? await getActiveNodeVoterCount(prisma, petition.scopeId)
      : await getActiveVoterCount(prisma, petition);

  if (eligible === 0) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "blocked", resolvedAt: new Date() } });
    return { outcome: "blocked" };
  }

  // Use scopeId for competing petition resolution; fall back to groupId for legacy records
  const resolutionScopeId = petition.scopeId;

  if (petition.competitionKey) {
    return resolveCompetingPetitions(prisma, petition.competitionKey, resolutionScopeId, eligible, snapshot.threshold);
  }

  return resolveSinglePetition(prisma, petitionId, eligible, snapshot.threshold);
}

// ── evaluateEmergencyPetition ─────────────────────────────────────────────────

export async function evaluateEmergencyPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateResult> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { id: true, groupId: true, scopeId: true, status: true, category: true, subjectType: true, governanceSnapshot: true },
  });

  if (!petition || petition.status !== "open") return { outcome: "pending" };

  if (petition.category !== "emergency" || petition.subjectType !== "emergency_declaration") {
    throw new Error(
      `evaluateEmergencyPetition must only be called on emergency_declaration petitions. ` +
      `Got category="${petition.category}", subjectType="${petition.subjectType}" for petition ${petitionId}.`,
    );
  }

  const snapshot = petition.governanceSnapshot as { threshold: number };
  // Emergency petitions are always group-scoped; use groupId for participant count
  const governingGroupId = petition.groupId ?? petition.scopeId;
  const eligible = await getActiveParticipantCount(prisma, governingGroupId);

  if (eligible === 0) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "blocked", resolvedAt: new Date() } });
    return { outcome: "blocked" };
  }

  const supportCount = await getPetitionSupportCount(prisma, petitionId);

  if (supportCount / eligible >= snapshot.threshold) {
    await prisma.petition.update({ where: { id: petitionId }, data: { status: "approved", resolvedAt: new Date() } });
    return { outcome: "approved" };
  }

  return { outcome: "pending" };
}

// ── withdrawPetition ──────────────────────────────────────────────────────────

export async function withdrawPetition(
  prisma: PrismaClient,
  petitionId: string,
  byMembershipId: string,
): Promise<{ outcome: "withdrawn" | "not_eligible" }> {
  const result = await prisma.petition.updateMany({
    where: { id: petitionId, createdByMembershipId: { equals: byMembershipId }, status: "open" },
    data: { status: "withdrawn", resolvedAt: new Date() },
  });
  return { outcome: result.count > 0 ? "withdrawn" : "not_eligible" };
}

export async function withdrawPetitionBySubject(
  prisma: PrismaClient,
  { subjectType, subjectId }: { subjectType: string; subjectId: string },
): Promise<void> {
  await prisma.petition.updateMany({
    where: { subjectType, subjectId, status: "open" },
    data: { status: "withdrawn", resolvedAt: new Date() },
  });
}

// ── Lazy archival ─────────────────────────────────────────────────────────────

const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function archiveStalePetitions(prisma: PrismaClient, groupId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_MS);
  await prisma.petition.updateMany({
    where: { groupId, status: { not: "open" }, resolvedAt: { lte: cutoff }, archivedAt: null },
    data: { archivedAt: now },
  });
}

// ── Petition status filter ────────────────────────────────────────────────────

export const PETITION_FILTER_VALUES = ["all", "open", "closed", "approved", "rejected", "archived"] as const;
export type PetitionFilterValue = (typeof PETITION_FILTER_VALUES)[number];

export function petitionFilterWhere(filter: PetitionFilterValue): Prisma.PetitionWhereInput {
  switch (filter) {
    case "all":
      return { archivedAt: null };
    case "open":
      return { status: "open", archivedAt: null };
    case "closed":
      return { status: { not: "open" }, archivedAt: null };
    case "approved":
      return { status: "approved", archivedAt: null };
    case "rejected":
      return { status: "rejected", archivedAt: null };
    case "archived":
      return { archivedAt: { not: null } };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveSinglePetition(
  prisma: PrismaClient,
  petitionId: string,
  eligible: number,
  threshold: number,
): Promise<EvaluateResult> {
  const supportCount = await getPetitionSupportCount(prisma, petitionId);
  const outcome: PetitionStatus = supportCount / eligible >= threshold ? "approved" : "rejected";
  await prisma.petition.update({ where: { id: petitionId }, data: { status: outcome, resolvedAt: new Date() } });
  return { outcome };
}

async function resolveCompetingPetitions(
  prisma: PrismaClient,
  competitionKey: string,
  scopeId: string,           // was groupId; now scope-aware
  eligible: number,
  threshold: number,
): Promise<EvaluateResult> {
  const now = new Date();
  const resolvedAt = now;

  return prisma.$transaction(async (tx) => {
    // If a winner already exists, reject all remaining competitors
    const existingWinner = await tx.petition.findFirst({
      where: { competitionKey, scopeId, status: "approved" },
      select: { id: true },
    });

    const closedPetitions = await tx.petition.findMany({
      where: { competitionKey, scopeId, status: "open", closesAt: { lte: now } },
      select: { id: true, scopeType: true },
    });

    if (closedPetitions.length === 0) return { outcome: "pending" };

    const counts = await Promise.all(
      closedPetitions.map(async (p) => ({
        id: p.id,
        count:
          p.scopeType === "node"
            ? await tx.nodePetitionSupport.count({ where: { petitionId: p.id } })
            : await tx.petitionSupport.count({ where: { petitionId: p.id } }),
      })),
    );

    if (existingWinner) {
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

    await tx.petition.updateMany({
      where: { id: { in: counts.map((c) => c.id) } },
      data: { status: "rejected", resolvedAt },
    });
    return { outcome: "rejected" };
  });
}

async function getPetitionSupportCount(prisma: PrismaClient, petitionId: string): Promise<number> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { scopeType: true },
  });
  if (!petition) return 0;
  return petition.scopeType === "node"
    ? prisma.nodePetitionSupport.count({ where: { petitionId } })
    : prisma.petitionSupport.count({ where: { petitionId } });
}
