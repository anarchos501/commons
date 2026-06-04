import type { PrismaClient } from "../generated/prisma/client";
import type { OfferingEntityType } from "../generated/prisma/enums";
import { openPetition } from "./petitions";
import { hasAbilityNow } from "./responsibility-abilities";

export type { OfferingEntityType };

export type ProposeContributionCategoryInput = {
  membershipId: string;
  groupId: string;
  offeringEntityType: OfferingEntityType;
  offeringEntityId: string;
  name: string;
  description: string;
};

export type ProposeProjectContributionCategoryInput = {
  projectMembershipId: string;
  projectId: string;
  name: string;
  description: string;
};

export type ProposeContributionCategoryResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "not_eligible" | "duplicate_name" | "petition_error" | "ability_required" };

export async function proposeContributionCategory(
  prisma: PrismaClient,
  input: ProposeContributionCategoryInput,
): Promise<ProposeContributionCategoryResult> {
  // Verify proposer is an active group member
  const membership = await prisma.groupMembership.findUnique({
    where: { id: input.membershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !membership ||
    membership.groupId !== input.groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  // Entity-specific eligibility checks
  if (input.offeringEntityType === "project") {
    const projectMembership = await prisma.projectMembership.findFirst({
      where: {
        projectId: input.offeringEntityId,
        accountId: membership.accountId,
        status: "active",
        participationStatus: "active",
      },
    });
    if (!projectMembership) {
      return { ok: false, reason: "not_eligible" };
    }
  } else if (input.offeringEntityType === "responsibility") {
    // Holder must have the create_contribution_categories ability
    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: {
        membershipId: input.membershipId,
        endedAt: null,
        expiresAt: { gt: new Date() },
        responsibility: { id: input.offeringEntityId },
        membership: { status: "active", participationStatus: "active" },
      },
      select: { responsibilityId: true },
    });
    if (!assignment) {
      return { ok: false, reason: "not_eligible" };
    }
    const hasAbility = await hasAbilityNow(prisma, assignment.responsibilityId, "create_contribution_categories");
    if (!hasAbility) {
      return { ok: false, reason: "ability_required" };
    }
  }

  // Guard against duplicate name within the same offering entity
  const existing = await prisma.contributionCategory.findFirst({
    where: {
      offeringEntityType: input.offeringEntityType,
      offeringEntityId: input.offeringEntityId,
      name: input.name,
      status: "active",
    },
  });
  if (existing) {
    return { ok: false, reason: "duplicate_name" };
  }

  // Determine voter scope: project-offered categories use project-scoped voting;
  // group-offered and responsibility-offered categories use group-wide voting (responsibilities
  // are group-accountable delegated abilities).
  const voterScope =
    input.offeringEntityType === "project"
      ? { type: "project" as const, scopeId: input.offeringEntityId }
      : null;

  // Create the staging draft
  const draft = await prisma.contributionCategoryDraft.create({
    data: {
      groupId: input.groupId,
      offeringEntityType: input.offeringEntityType,
      offeringEntityId: input.offeringEntityId,
      name: input.name,
      description: input.description,
      proposedByMembershipId: input.membershipId,
    },
  });

  const result = await openPetition(prisma, {
    groupId: input.groupId,
    category: "contribution_category",
    subjectType: "contribution_category_proposal",
    subjectId: draft.id,
    createdByMembershipId: input.membershipId,
    voterScope,
  });

  if (!result.ok) {
    return { ok: false, reason: "petition_error" };
  }

  return { ok: true, petitionId: result.petitionId };
}

export async function proposeProjectContributionCategory(
  prisma: PrismaClient,
  input: ProposeProjectContributionCategoryInput,
): Promise<ProposeContributionCategoryResult> {
  const projectMembership = await prisma.projectMembership.findUnique({
    where: { id: input.projectMembershipId },
    select: { projectId: true, status: true, participationStatus: true },
  });
  if (
    !projectMembership ||
    projectMembership.projectId !== input.projectId ||
    projectMembership.status !== "active" ||
    projectMembership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { groupId: true },
  });
  if (!project) return { ok: false, reason: "not_eligible" };

  const existing = await prisma.contributionCategory.findFirst({
    where: {
      offeringEntityType: "project",
      offeringEntityId: input.projectId,
      name: input.name,
      status: "active",
    },
  });
  if (existing) return { ok: false, reason: "duplicate_name" };

  const draft = await prisma.contributionCategoryDraft.create({
    data: {
      groupId: project.groupId,
      offeringEntityType: "project",
      offeringEntityId: input.projectId,
      name: input.name,
      description: input.description,
      proposedByProjectMembershipId: input.projectMembershipId,
    },
  });

  const result = await openPetition(prisma, {
    groupId: project.groupId,
    scopeType: "project",
    scopeId: input.projectId,
    category: "contribution_category",
    subjectType: "contribution_category_proposal",
    subjectId: draft.id,
    createdByProjectMembershipId: input.projectMembershipId,
  });

  if (!result.ok) return { ok: false, reason: "petition_error" };
  return { ok: true, petitionId: result.petitionId };
}

export async function createContributionCategoryFromPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectId: true, status: true, subjectType: true },
  });
  if (!petition || petition.status !== "approved" || petition.subjectType !== "contribution_category_proposal") {
    return;
  }

  const draft = await prisma.contributionCategoryDraft.findUnique({
    where: { id: petition.subjectId },
  });
  if (!draft) return;

  // Idempotent: unique constraint on (offeringEntityType, offeringEntityId, name) prevents duplicates
  await prisma.contributionCategory.upsert({
    where: {
      offeringEntityType_offeringEntityId_name: {
        offeringEntityType: draft.offeringEntityType,
        offeringEntityId: draft.offeringEntityId,
        name: draft.name,
      },
    },
    update: {},
    create: {
      groupId: draft.groupId,
      offeringEntityType: draft.offeringEntityType,
      offeringEntityId: draft.offeringEntityId,
      name: draft.name,
      description: draft.description,
      status: "active",
    },
  });
}

export type ProposeArchivalResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "not_eligible" | "not_found" | "already_archived" | "petition_error" };

export async function proposeContributionCategoryArchival(
  prisma: PrismaClient,
  { membershipId, groupId, categoryId }: { membershipId: string; groupId: string; categoryId: string },
): Promise<ProposeArchivalResult> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  const category = await prisma.contributionCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) return { ok: false, reason: "not_found" };
  if (category.status === "archived") return { ok: false, reason: "already_archived" };

  // Verify proposer is a member of the offering entity
  if (category.offeringEntityType === "project") {
    const projectMembership = await prisma.projectMembership.findFirst({
      where: { projectId: category.offeringEntityId, accountId: membership.accountId, status: "active", participationStatus: "active" },
    });
    if (!projectMembership) return { ok: false, reason: "not_eligible" };
  } else if (category.offeringEntityType === "responsibility") {
    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: {
        membershipId,
        endedAt: null,
        expiresAt: { gt: new Date() },
        responsibility: { id: category.offeringEntityId },
      },
    });
    if (!assignment) return { ok: false, reason: "not_eligible" };
  }

  const voterScope =
    category.offeringEntityType === "project"
      ? { type: "project" as const, scopeId: category.offeringEntityId }
      : null;

  const result = await openPetition(prisma, {
    groupId,
    category: "contribution_category",
    subjectType: "contribution_category_archive",
    subjectId: categoryId,
    createdByMembershipId: membershipId,
    voterScope,
  });

  if (!result.ok) return { ok: false, reason: "petition_error" };
  return { ok: true, petitionId: result.petitionId };
}

export async function archiveContributionCategoryFromPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectId: true, status: true, subjectType: true },
  });
  if (!petition || petition.status !== "approved" || petition.subjectType !== "contribution_category_archive") {
    return;
  }

  // Idempotent
  await prisma.contributionCategory.updateMany({
    where: { id: petition.subjectId, status: "active" },
    data: { status: "archived", archivedAt: new Date() },
  });
}

export type CategoryForScope = {
  id: string;
  name: string;
  description: string;
  offeringEntityType: OfferingEntityType;
  offeringEntityId: string;
  offeringEntityName: string | null;
};

/**
 * Returns active ContributionCategory records visible within the selected scope.
 * Includes the offering entity name for display (attribution label).
 */
export async function getAvailableCategoriesForScope(
  prisma: PrismaClient,
  {
    groupId,
    projectId,
    responsibilityId,
  }: { groupId: string; projectId?: string; responsibilityId?: string },
): Promise<CategoryForScope[]> {
  const categories = await prisma.contributionCategory.findMany({
    where: {
      groupId,
      status: "active",
    },
    orderBy: [{ offeringEntityType: "asc" }, { name: "asc" }],
  });

  // Filter to scope if specified
  const scoped = projectId || responsibilityId
    ? categories.filter((c) => {
        if (projectId && c.offeringEntityType === "project" && c.offeringEntityId === projectId) return true;
        if (responsibilityId && c.offeringEntityType === "responsibility" && c.offeringEntityId === responsibilityId) return true;
        if (c.offeringEntityType === "group" && c.offeringEntityId === groupId) return true;
        return false;
      })
    : categories;

  // Resolve offering entity names for attribution display
  const groupIds = scoped.filter((c) => c.offeringEntityType === "group").map((c) => c.offeringEntityId);
  const projectIds = scoped.filter((c) => c.offeringEntityType === "project").map((c) => c.offeringEntityId);
  const responsibilityIds = scoped.filter((c) => c.offeringEntityType === "responsibility").map((c) => c.offeringEntityId);

  const [groups, projects, responsibilities] = await Promise.all([
    groupIds.length > 0 ? prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [],
    projectIds.length > 0 ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : [],
    responsibilityIds.length > 0 ? prisma.responsibility.findMany({ where: { id: { in: responsibilityIds } }, select: { id: true, type: true } }) : [],
  ]);

  const nameMap = new Map<string, string>();
  for (const g of groups) nameMap.set(g.id, g.name);
  for (const p of projects) nameMap.set(p.id, p.name);
  for (const r of responsibilities) nameMap.set(r.id, r.type);

  return scoped.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    offeringEntityType: c.offeringEntityType,
    offeringEntityId: c.offeringEntityId,
    offeringEntityName: nameMap.get(c.offeringEntityId) ?? null,
  }));
}

/**
 * Returns true if at least one active TrustedProviderStatus exists for the
 * given category within the group. Used to conditionally show the trust
 * preference picker in request creation.
 */
export async function trustedProviderExistsForCategory(
  prisma: PrismaClient,
  { categoryId, groupId }: { categoryId: string; groupId: string },
): Promise<boolean> {
  const count = await prisma.trustedProviderStatus.count({
    where: { categoryId, groupId, status: "active" },
  });
  return count > 0;
}
