import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";
import { openPetition, requireApprovedPetition } from "./petitions";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { proposeContentCreation } from "./content-creation-drafts";
import { assertProjectWritable } from "./project-membership";

/**
 * Creates a Bulletin in the given Coordination Space.
 * spaceId is not validated -- D3 uses a polymorphic pattern with no FK enforcement.
 */
export async function createBulletin(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    authorId: string;
    title: string;
    body: string;
  },
) {
  return prisma.bulletin.create({ data: opts });
}

/**
 * Archives a Bulletin. Preserves the first archivedAt -- if already archived,
 * returns without modifying the record.
 * Direct path — valid for seed, admin, and internal use.
 * Community-facing path uses openBulletinArchivalPetition + onBulletinArchivalPetitionApproved.
 */
export async function archiveBulletin(prisma: PrismaClient, bulletinId: string): Promise<void> {
  await prisma.bulletin.updateMany({
    where: { id: bulletinId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

// --- RFC-006: Governance wrappers ---

/**
 * Opens a governance petition to archive a Bulletin.
 * Fix 3: verifies the bulletin's space belongs to groupId.
 */
export async function openBulletinArchivalPetition(
  prisma: PrismaClient,
  opts: { bulletinId: string; createdByMembershipId: string; groupId: string },
) {
  // Fix 3: verify the bulletin belongs to the stated group before opening a petition
  const bulletin = await prisma.bulletin.findUniqueOrThrow({
    where: { id: opts.bulletinId },
    select: { spaceType: true, spaceId: true },
  });
  await assertSpaceBelongsToGroup(prisma, bulletin.spaceType, bulletin.spaceId, opts.groupId);

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "archival",
    subjectType: "bulletin_archive",
    subjectId: opts.bulletinId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

export async function openProjectBulletinArchivalPetition(
  prisma: PrismaClient,
  opts: { bulletinId: string; createdByProjectMembershipId: string; projectId: string },
) {
  const bulletin = await prisma.bulletin.findUniqueOrThrow({
    where: { id: opts.bulletinId },
    select: { spaceType: true, spaceId: true },
  });
  if (bulletin.spaceType !== "project" || bulletin.spaceId !== opts.projectId) {
    throw new Error(`Bulletin "${opts.bulletinId}" does not belong to project "${opts.projectId}".`);
  }
  await assertProjectWritable(prisma, opts.projectId);

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: opts.projectId },
    select: { foundingGroupId: true },
  });

  return openPetition(prisma, {
    groupId: project.foundingGroupId,
    scopeType: "project",
    scopeId: opts.projectId,
    category: "archival",
    subjectType: "bulletin_archive",
    subjectId: opts.bulletinId,
    createdByProjectMembershipId: opts.createdByProjectMembershipId,
  });
}

/**
 * Called after a Bulletin archival petition is approved.
 * Sets archivedAt and provenance fields. The petition subjectId is the bulletinId.
 * Fix 3: re-verifies target ownership against petition.groupId before mutating.
 */
export async function onBulletinArchivalPetitionApproved(prisma: Prisma.TransactionClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "bulletin_archive");

  const accountId = petition.createdByMembershipId
    ? (await prisma.groupMembership.findUnique({ where: { id: petition.createdByMembershipId }, select: { accountId: true } }))?.accountId ?? null
    : petition.createdByProjectMembershipId
      ? (await prisma.projectMembership.findUnique({ where: { id: petition.createdByProjectMembershipId }, select: { accountId: true } }))?.accountId ?? null
      : null;

  const bulletin = await prisma.bulletin.findUniqueOrThrow({
    where: { id: petition.subjectId },
    select: { spaceType: true, spaceId: true },
  });
  if (petition.scopeType === "project") {
    if (bulletin.spaceType !== "project" || bulletin.spaceId !== petition.scopeId) {
      throw new Error(`Bulletin target does not belong to project petition scope "${petition.scopeId}".`);
    }
  } else {
    await assertSpaceBelongsToGroup(prisma, bulletin.spaceType, bulletin.spaceId, petition.groupId);
  }

  await prisma.bulletin.updateMany({
    where: { id: petition.subjectId, archivedAt: null },
    data: {
      archivedAt: new Date(),
      archivedByAccountId: accountId,
      archiveProposalId: petitionId,
      archiveReason: "approved_by_community_petition",
    },
  });
}

/**
 * Lists Bulletins in a Coordination Space, ordered by publishedAt desc.
 * Excludes archived by default.
 */
export async function listBulletins(
  prisma: PrismaClient,
  spaceType: CoordinationSpaceType,
  spaceId: string,
  opts: { includeArchived?: boolean } = {},
) {
  return prisma.bulletin.findMany({
    where: {
      spaceType,
      spaceId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { publishedAt: "desc" },
  });
}

export async function proposeBulletinCreation(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    groupId: string;
    createdByMembershipId?: string;
    createdByProjectMembershipId?: string;
    actingResponsibilityId?: string;
    title: string;
    body: string;
  },
) {
  return proposeContentCreation(prisma, { ...opts, contentType: "bulletin" });
}
