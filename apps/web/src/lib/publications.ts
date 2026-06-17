// D4: Publication lib -- create, add entries, archive, list.
// A Publication remains the same Publication throughout its lifetime.
// Adding entries never creates a new Publication -- only new PublicationEntry records.
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";
import { openPetition, requireApprovedPetition } from "./petitions";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { proposeContentCreation } from "./content-creation-drafts";
import { assertProjectWritable } from "./project-membership";

/**
 * Creates a Publication in the given Coordination Space.
 * spaceId is not validated -- D3 uses a polymorphic pattern with no FK enforcement.
 */
export async function createPublication(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    createdByAccountId: string;
    title: string;
  },
) {
  return prisma.publication.create({ data: opts });
}

/**
 * Appends an entry to a Publication. Throws if the publication is archived --
 * archived collections do not accept new entries.
 */
export async function addPublicationEntry(
  prisma: PrismaClient,
  opts: {
    publicationId: string;
    authorId: string;
    title?: string;
    body: string;
  },
) {
  const publication = await prisma.publication.findUniqueOrThrow({
    where: { id: opts.publicationId },
    select: { archivedAt: true },
  });

  if (publication.archivedAt !== null) {
    throw new Error("Cannot add entries to an archived publication.");
  }

  return prisma.publicationEntry.create({ data: opts });
}

/**
 * Archives a single PublicationEntry. Preserves the first archivedAt.
 * The Publication remains visible.
 * Future: accept archivedByAccountId, archiveProposalId, archiveReason (Governance RFC).
 */
export async function archivePublicationEntry(prisma: PrismaClient, entryId: string): Promise<void> {
  await prisma.publicationEntry.updateMany({
    where: { id: entryId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

/**
 * Archives an entire Publication. Preserves the first archivedAt.
 * Does NOT cascade to entries -- entries retain their individual archivedAt values.
 * Future: accept archivedByAccountId, archiveProposalId, archiveReason (Governance RFC).
 */
export async function archivePublication(prisma: PrismaClient, publicationId: string): Promise<void> {
  await prisma.publication.updateMany({
    where: { id: publicationId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

/**
 * Lists Publications in a Coordination Space, ordered by createdAt desc.
 * Excludes archived by default.
 */
export async function listPublications(
  prisma: PrismaClient,
  spaceType: CoordinationSpaceType,
  spaceId: string,
  opts: { includeArchived?: boolean } = {},
) {
  return prisma.publication.findMany({
    where: {
      spaceType,
      spaceId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { createdAt: "desc" },
  });
}

// --- RFC-006: Governance wrappers ---

/**
 * Opens a governance petition to archive a Publication.
 * Direct path (archivePublication) remains valid for seed/admin use.
 * Fix 3: verifies the publication's space belongs to groupId.
 */
export async function openPublicationArchivalPetition(
  prisma: PrismaClient,
  opts: { publicationId: string; createdByMembershipId: string; groupId: string },
) {
  // Fix 3: verify the publication belongs to the stated group
  const pub = await prisma.publication.findUniqueOrThrow({
    where: { id: opts.publicationId },
    select: { spaceType: true, spaceId: true },
  });
  await assertSpaceBelongsToGroup(prisma, pub.spaceType, pub.spaceId, opts.groupId);

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "archival",
    subjectType: "publication_archive",
    subjectId: opts.publicationId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

export async function openProjectPublicationArchivalPetition(
  prisma: PrismaClient,
  opts: { publicationId: string; createdByProjectMembershipId: string; projectId: string },
) {
  const pub = await prisma.publication.findUniqueOrThrow({
    where: { id: opts.publicationId },
    select: { spaceType: true, spaceId: true },
  });
  if (pub.spaceType !== "project" || pub.spaceId !== opts.projectId) {
    throw new Error(`Publication "${opts.publicationId}" does not belong to project "${opts.projectId}".`);
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
    subjectType: "publication_archive",
    subjectId: opts.publicationId,
    createdByProjectMembershipId: opts.createdByProjectMembershipId,
  });
}

/** Called after a Publication archival petition is approved. Fix 3: re-verifies ownership. */
export async function onPublicationArchivalPetitionApproved(prisma: Prisma.TransactionClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "publication_archive");
  const accountId = petition.createdByMembershipId
    ? (await prisma.groupMembership.findUnique({ where: { id: petition.createdByMembershipId }, select: { accountId: true } }))?.accountId ?? null
    : petition.createdByProjectMembershipId
      ? (await prisma.projectMembership.findUnique({ where: { id: petition.createdByProjectMembershipId }, select: { accountId: true } }))?.accountId ?? null
      : null;

  // Fix 3: verify the publication still belongs to the petition group
  const pub = await prisma.publication.findUniqueOrThrow({ where: { id: petition.subjectId }, select: { spaceType: true, spaceId: true } });
  if (petition.scopeType === "project") {
    if (pub.spaceType !== "project" || pub.spaceId !== petition.scopeId) {
      throw new Error(`Publication target does not belong to project petition scope "${petition.scopeId}".`);
    }
  } else {
    await assertSpaceBelongsToGroup(prisma, pub.spaceType, pub.spaceId, petition.groupId);
  }

  await prisma.publication.updateMany({
    where: { id: petition.subjectId, archivedAt: null },
    data: { archivedAt: new Date(), archivedByAccountId: accountId, archiveProposalId: petitionId, archiveReason: "approved_by_community_petition" },
  });
}

/**
 * Opens a governance petition to archive a PublicationEntry.
 * Direct path (archivePublicationEntry) remains valid for seed/admin use.
 * Fix 3: verifies the entry's publication space belongs to groupId.
 */
export async function openPublicationEntryArchivalPetition(
  prisma: PrismaClient,
  opts: { entryId: string; createdByMembershipId: string; groupId: string },
) {
  // Fix 3: verify the entry's publication belongs to the stated group
  const entry = await prisma.publicationEntry.findUniqueOrThrow({
    where: { id: opts.entryId },
    select: { publication: { select: { spaceType: true, spaceId: true } } },
  });
  await assertSpaceBelongsToGroup(prisma, entry.publication.spaceType, entry.publication.spaceId, opts.groupId);

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "archival",
    subjectType: "publication_entry_archive",
    subjectId: opts.entryId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

/** Called after a PublicationEntry archival petition is approved. Fix 3: re-verifies ownership. */
export async function onPublicationEntryArchivalPetitionApproved(prisma: Prisma.TransactionClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "publication_entry_archive");
  const accountId = petition.createdByMembershipId ? (await prisma.groupMembership.findUnique({ where: { id: petition.createdByMembershipId }, select: { accountId: true } }))?.accountId ?? null : null;

  // Fix 3: verify the entry's publication still belongs to the petition group
  const entry = await prisma.publicationEntry.findUniqueOrThrow({
    where: { id: petition.subjectId },
    select: { publication: { select: { spaceType: true, spaceId: true } } },
  });
  await assertSpaceBelongsToGroup(prisma, entry.publication.spaceType, entry.publication.spaceId, petition.groupId);

  await prisma.publicationEntry.updateMany({
    where: { id: petition.subjectId, archivedAt: null },
    data: { archivedAt: new Date(), archivedByAccountId: accountId, archiveProposalId: petitionId, archiveReason: "approved_by_community_petition" },
  });
}

export async function proposePublicationCreation(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    groupId: string;
    createdByMembershipId?: string;
    createdByProjectMembershipId?: string;
    actingResponsibilityId?: string;
    title: string;
  },
) {
  return proposeContentCreation(prisma, { ...opts, contentType: "publication" });
}

export async function proposePubEntryCreation(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    publicationId: string;
    groupId: string;
    createdByMembershipId?: string;
    createdByProjectMembershipId?: string;
    actingResponsibilityId?: string;
    title?: string;
    body: string;
  },
) {
  return proposeContentCreation(prisma, { ...opts, contentType: "publication_entry" });
}

/**
 * Fetches a Publication with its entries. This is an explicit ID fetch --
 * it returns the publication regardless of archival status. Entries are
 * filtered by archivedAt: null by default.
 */
export async function getPublicationWithEntries(
  prisma: PrismaClient,
  publicationId: string,
  opts: { includeArchivedEntries?: boolean } = {},
) {
  return prisma.publication.findUniqueOrThrow({
    where: { id: publicationId },
    include: {
      entries: {
        where: opts.includeArchivedEntries ? {} : { archivedAt: null },
        orderBy: { publishedAt: "asc" },
      },
    },
  });
}
