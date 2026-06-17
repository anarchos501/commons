import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { OfferingEntityType } from "../generated/prisma/enums";
import { openPetition } from "./petitions";

export type TrustedProviderInfo = {
  id: string;
  membershipId: string;
  categoryId: string;
  groupId: string;
  grantedAt: Date;
  revokedAt: Date | null;
  offeringEntityType: OfferingEntityType;
  offeringEntityId: string;
  offeringEntityName: string | null;
  memberDisplayName: string | null;
};

export type ProposeTrustedProviderStatusInput = {
  requestingMembershipId: string;
  targetMembershipId: string;
  groupId: string;
  categoryIds: string[];
};

export type ProposeTrustedProviderStatusResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "not_eligible" | "target_not_eligible" | "empty_categories" | "mixed_entities" | "invalid_categories" | "petition_error" };

export async function proposeTrustedProviderStatus(
  prisma: PrismaClient,
  input: ProposeTrustedProviderStatusInput,
): Promise<ProposeTrustedProviderStatusResult> {
  if (!input.categoryIds.length) {
    return { ok: false, reason: "empty_categories" };
  }

  // Verify requesting member is active+active in the group
  const requestingMembership = await prisma.groupMembership.findUnique({
    where: { id: input.requestingMembershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !requestingMembership ||
    requestingMembership.groupId !== input.groupId ||
    requestingMembership.status !== "active" ||
    requestingMembership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  // Verify target member is active in the group
  const targetMembership = await prisma.groupMembership.findUnique({
    where: { id: input.targetMembershipId },
    select: { groupId: true, status: true, accountId: true },
  });
  if (!targetMembership || targetMembership.groupId !== input.groupId || targetMembership.status !== "active") {
    return { ok: false, reason: "target_not_eligible" };
  }

  // Load and validate all categories
  const categories = await prisma.contributionCategory.findMany({
    where: { id: { in: input.categoryIds }, groupId: input.groupId, status: "active" },
  });
  if (categories.length !== input.categoryIds.length) {
    return { ok: false, reason: "invalid_categories" };
  }

  // All categories must belong to the same offering entity (prevents mixed-governance bundles)
  const entityKey = `${categories[0].offeringEntityType}:${categories[0].offeringEntityId}`;
  const allSameEntity = categories.every(
    (c) => `${c.offeringEntityType}:${c.offeringEntityId}` === entityKey,
  );
  if (!allSameEntity) {
    return { ok: false, reason: "mixed_entities" };
  }

  const { offeringEntityType, offeringEntityId } = categories[0];

  // Requesting member must be a member of the offering entity
  const eligibilityResult = await checkOfferingEntityMembership(
    prisma,
    input.requestingMembershipId,
    requestingMembership.accountId,
    offeringEntityType,
    offeringEntityId,
  );
  if (!eligibilityResult) {
    return { ok: false, reason: "not_eligible" };
  }

  // Voter scope follows offering entity type
  const voterScope =
    offeringEntityType === "project"
      ? { type: "project" as const, scopeId: offeringEntityId }
      : null;

  // Create staging application
  const application = await prisma.trustedProviderApplication.create({
    data: {
      membershipId: input.targetMembershipId,
      groupId: input.groupId,
      categoryIds: input.categoryIds,
    },
  });

  const result = await openPetition(prisma, {
    groupId: input.groupId,
    category: "trusted_provider",
    subjectType: "trusted_provider_proposal",
    subjectId: application.id,
    createdByMembershipId: input.requestingMembershipId,
    voterScope,
  });

  if (!result.ok) return { ok: false, reason: "petition_error" };
  return { ok: true, petitionId: result.petitionId };
}

export async function grantTrustedProviderStatusFromPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectId: true, status: true, subjectType: true },
  });
  if (!petition || petition.status !== "approved" || petition.subjectType !== "trusted_provider_proposal") {
    return;
  }

  const application = await prisma.trustedProviderApplication.findUnique({
    where: { id: petition.subjectId },
  });
  if (!application) return;

  const categoryIds = application.categoryIds as string[];

  for (const categoryId of categoryIds) {
    await prisma.trustedProviderStatus.upsert({
      where: { membershipId_categoryId: { membershipId: application.membershipId, categoryId } },
      update: { status: "active", revokedAt: null },
      create: {
        membershipId: application.membershipId,
        categoryId,
        groupId: application.groupId,
        status: "active",
      },
    });
  }
}

export type ProposeRevocationInput = {
  requestingMembershipId: string;
  targetMembershipId: string;
  groupId: string;
  statusIds: string[];
};

export type ProposeRevocationResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "not_eligible" | "empty_statuses" | "invalid_statuses" | "mixed_entities" | "petition_error" };

export async function proposeTrustedProviderRevocation(
  prisma: PrismaClient,
  input: ProposeRevocationInput,
): Promise<ProposeRevocationResult> {
  if (!input.statusIds.length) {
    return { ok: false, reason: "empty_statuses" };
  }

  const requestingMembership = await prisma.groupMembership.findUnique({
    where: { id: input.requestingMembershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !requestingMembership ||
    requestingMembership.groupId !== input.groupId ||
    requestingMembership.status !== "active" ||
    requestingMembership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  // Validate all statusIds belong to this group and the target membership
  const statuses = await prisma.trustedProviderStatus.findMany({
    where: { id: { in: input.statusIds }, groupId: input.groupId, membershipId: input.targetMembershipId },
    include: { category: { select: { offeringEntityType: true, offeringEntityId: true } } },
  });
  if (statuses.length !== input.statusIds.length) {
    return { ok: false, reason: "invalid_statuses" };
  }

  // All statuses must reference the same offering entity
  const entityKey = `${statuses[0].category.offeringEntityType}:${statuses[0].category.offeringEntityId}`;
  const allSameEntity = statuses.every(
    (s) => `${s.category.offeringEntityType}:${s.category.offeringEntityId}` === entityKey,
  );
  if (!allSameEntity) {
    return { ok: false, reason: "mixed_entities" };
  }

  const { offeringEntityType, offeringEntityId } = statuses[0].category;

  const eligible = await checkOfferingEntityMembership(
    prisma,
    input.requestingMembershipId,
    requestingMembership.accountId,
    offeringEntityType,
    offeringEntityId,
  );
  if (!eligible) {
    return { ok: false, reason: "not_eligible" };
  }

  const voterScope =
    offeringEntityType === "project"
      ? { type: "project" as const, scopeId: offeringEntityId }
      : null;

  const revocationRequest = await prisma.trustedProviderRevocationRequest.create({
    data: {
      targetMembershipId: input.targetMembershipId,
      groupId: input.groupId,
      statusIds: input.statusIds,
    },
  });

  const result = await openPetition(prisma, {
    groupId: input.groupId,
    category: "trusted_provider",
    subjectType: "trusted_provider_revocation",
    subjectId: revocationRequest.id,
    createdByMembershipId: input.requestingMembershipId,
    voterScope,
  });

  if (!result.ok) return { ok: false, reason: "petition_error" };
  return { ok: true, petitionId: result.petitionId };
}

export async function revokeTrustedProviderStatusFromPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectId: true, status: true, subjectType: true },
  });
  if (!petition || petition.status !== "approved" || petition.subjectType !== "trusted_provider_revocation") {
    return;
  }

  const revocationRequest = await prisma.trustedProviderRevocationRequest.findUnique({
    where: { id: petition.subjectId },
  });
  if (!revocationRequest) return;

  const statusIds = revocationRequest.statusIds as string[];

  // Idempotent: updateMany is safe if already revoked
  await prisma.trustedProviderStatus.updateMany({
    where: { id: { in: statusIds } },
    data: { status: "revoked", revokedAt: new Date() },
  });
}

export async function getTrustedProvidersForCategory(
  prisma: PrismaClient,
  { categoryId, groupId }: { categoryId: string; groupId: string },
): Promise<TrustedProviderInfo[]> {
  const statuses = await prisma.trustedProviderStatus.findMany({
    where: { categoryId, groupId, status: "active" },
    include: {
      category: { select: { offeringEntityType: true, offeringEntityId: true } },
      membership: { select: { account: { select: { displayName: true } } } },
    },
    orderBy: { grantedAt: "asc" },
  });

  // Resolve offering entity name for attribution
  const entityIds = [...new Set(statuses.map((s) => s.category.offeringEntityId))];
  const entityType = statuses[0]?.category.offeringEntityType;
  const nameMap = new Map<string, string>();

  if (entityIds.length > 0 && entityType) {
    if (entityType === "group") {
      const groups = await prisma.group.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } });
      for (const g of groups) nameMap.set(g.id, g.name);
    } else if (entityType === "project") {
      const projects = await prisma.project.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } });
      for (const p of projects) nameMap.set(p.id, p.name);
    } else if (entityType === "responsibility") {
      const responsibilities = await prisma.responsibility.findMany({ where: { id: { in: entityIds } }, select: { id: true, type: true } });
      for (const r of responsibilities) nameMap.set(r.id, r.type);
    }
  }

  return statuses.map((s) => ({
    id: s.id,
    membershipId: s.membershipId,
    categoryId: s.categoryId,
    groupId: s.groupId,
    grantedAt: s.grantedAt,
    revokedAt: s.revokedAt,
    offeringEntityType: s.category.offeringEntityType,
    offeringEntityId: s.category.offeringEntityId,
    offeringEntityName: nameMap.get(s.category.offeringEntityId) ?? null,
    memberDisplayName: s.membership.account.displayName,
  }));
}

/**
 * Formats the "trusted by" attribution label for display.
 * Must be used everywhere TrustedProviderStatus is shown — never just "Trusted Provider".
 */
export function formatTrustedByLabel(offeringEntityType: OfferingEntityType, entityName: string): string {
  switch (offeringEntityType) {
    case "group":
      return `Trusted by ${entityName}`;
    case "project":
      return `Trusted by ${entityName} (Project)`;
    case "responsibility":
      return `Trusted by ${entityName} (Responsibility)`;
  }
}

// Internal helper: checks whether a membership holder is a member of the offering entity.
async function checkOfferingEntityMembership(
  prisma: PrismaClient,
  membershipId: string,
  accountId: string,
  offeringEntityType: OfferingEntityType,
  offeringEntityId: string,
): Promise<boolean> {
  if (offeringEntityType === "group") {
    // Group membership already verified by caller
    return true;
  }
  if (offeringEntityType === "project") {
    const pm = await prisma.projectMembership.findFirst({
      where: { projectId: offeringEntityId, accountId, status: "active", participationStatus: "active" },
    });
    return pm !== null;
  }
  if (offeringEntityType === "responsibility") {
    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: {
        membershipId,
        endedAt: null,
        expiresAt: { gt: new Date() },
        responsibility: { id: offeringEntityId },
        membership: { status: "active", participationStatus: "active" },
      },
    });
    return assignment !== null;
  }
  return false;
}
