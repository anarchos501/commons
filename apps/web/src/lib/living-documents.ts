// D4: LivingDocument lib -- create, revise, archive, list.
// Discussion is a separate, temporary communication type. It must remain
// distinct from Bulletins, Publications, and LivingDocuments.
import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";
import { openPetition, requireApprovedPetition } from "./petitions";
import { assertSpaceBelongsToGroup } from "./governance-ownership";

/**
 * Creates a LivingDocument and seeds its first revision in a single transaction.
 * This is the lib-level guarantee: callers who use this function will always
 * have revision history starting at version 1. The schema does not enforce this.
 *
 * spaceId is not validated -- D3 uses a polymorphic pattern with no FK enforcement.
 */
export async function createLivingDocument(
  prisma: PrismaClient,
  opts: {
    spaceType: CoordinationSpaceType;
    spaceId: string;
    authorId: string;
    title: string;
    body: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.livingDocument.create({
      data: {
        spaceType: opts.spaceType,
        spaceId: opts.spaceId,
        title: opts.title,
        currentBody: opts.body,
      },
    });

    const revision = await tx.livingDocumentRevision.create({
      data: {
        livingDocumentId: document.id,
        authorId: opts.authorId,
        body: opts.body,
      },
    });

    return { document, revision };
  });
}

/**
 * Creates a new revision and updates currentBody atomically.
 * This is the lib-level guarantee that currentBody stays aligned with the
 * latest revision when callers use this function.
 * Throws if the document is archived.
 */
export async function reviseLivingDocument(
  prisma: PrismaClient,
  opts: {
    livingDocumentId: string;
    authorId: string;
    body: string;
  },
) {
  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: opts.livingDocumentId },
    select: { archivedAt: true },
  });

  if (document.archivedAt !== null) {
    throw new Error("Cannot revise an archived living document.");
  }

  return prisma.$transaction(async (tx) => {
    const revision = await tx.livingDocumentRevision.create({
      data: {
        livingDocumentId: opts.livingDocumentId,
        authorId: opts.authorId,
        body: opts.body,
      },
    });

    await tx.livingDocument.update({
      where: { id: opts.livingDocumentId },
      data: { currentBody: opts.body, lastRevisedAt: new Date() },
    });

    return revision;
  });
}

/**
 * Archives a LivingDocument. Preserves the first archivedAt -- if already
 * archived, returns without modifying the record.
 * Direct path — valid for seed, admin, and internal use.
 * Community-facing path uses openLivingDocumentArchivalPetition + onLivingDocumentArchivalPetitionApproved.
 */
export async function archiveLivingDocument(prisma: PrismaClient, documentId: string): Promise<void> {
  await prisma.livingDocument.updateMany({
    where: { id: documentId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

// --- RFC-006: Governance wrappers ---

/**
 * Creates a LivingDocumentRevision as a draft awaiting community approval.
 * Does NOT update currentBody. Use onRevisionPetitionApproved to promote on approval.
 * Direct path (reviseLivingDocument) still updates currentBody immediately — valid for seed/admin.
 */
export async function draftLivingDocumentRevision(
  prisma: PrismaClient,
  opts: { livingDocumentId: string; authorId: string; body: string },
) {
  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: opts.livingDocumentId },
    select: { archivedAt: true },
  });
  if (document.archivedAt !== null) {
    throw new Error("Cannot draft a revision for an archived living document.");
  }
  return prisma.livingDocumentRevision.create({
    data: { livingDocumentId: opts.livingDocumentId, authorId: opts.authorId, body: opts.body },
  });
}

/**
 * Opens a governance petition for a living document revision.
 * The revision must already exist (created via draftLivingDocumentRevision).
 * Fix 3: verifies the document's space belongs to groupId.
 */
export async function openRevisionPetition(
  prisma: PrismaClient,
  opts: { livingDocumentId: string; revisionId: string; createdByMembershipId: string; groupId: string },
) {
  // Verify the revision belongs to the stated document (prevents petition claiming
  // one document while targeting a revision that belongs to a different document).
  const revision = await prisma.livingDocumentRevision.findUniqueOrThrow({
    where: { id: opts.revisionId },
    select: { livingDocumentId: true },
  });
  if (revision.livingDocumentId !== opts.livingDocumentId) {
    throw new Error(
      `Revision "${opts.revisionId}" belongs to document "${revision.livingDocumentId}", not "${opts.livingDocumentId}".`,
    );
  }

  // Fix 3: verify the document belongs to the stated group before opening a petition
  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: opts.livingDocumentId },
    select: { spaceType: true, spaceId: true },
  });
  await assertSpaceBelongsToGroup(prisma, document.spaceType, document.spaceId, opts.groupId);

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "living_document",
    subjectType: "living_document_revision",
    subjectId: opts.revisionId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

export async function openProjectRevisionPetition(
  prisma: PrismaClient,
  opts: { livingDocumentId: string; revisionId: string; createdByProjectMembershipId: string; projectId: string },
) {
  const revision = await prisma.livingDocumentRevision.findUniqueOrThrow({
    where: { id: opts.revisionId },
    select: { livingDocumentId: true },
  });
  if (revision.livingDocumentId !== opts.livingDocumentId) {
    throw new Error(
      `Revision "${opts.revisionId}" belongs to document "${revision.livingDocumentId}", not "${opts.livingDocumentId}".`,
    );
  }

  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: opts.livingDocumentId },
    select: { spaceType: true, spaceId: true },
  });
  if (document.spaceType !== "project" || document.spaceId !== opts.projectId) {
    throw new Error(`Living document "${opts.livingDocumentId}" does not belong to project "${opts.projectId}".`);
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: opts.projectId },
    select: { groupId: true },
  });

  return openPetition(prisma, {
    groupId: project.groupId,
    scopeType: "project",
    scopeId: opts.projectId,
    category: "living_document",
    subjectType: "living_document_revision",
    subjectId: opts.revisionId,
    createdByProjectMembershipId: opts.createdByProjectMembershipId,
  });
}

/**
 * Called after a revision petition is approved.
 * Promotes the revision body to LivingDocument.currentBody and sets provenance fields.
 * Does NOT create a new revision — the revision already exists; approval is promotion.
 * Fix 3: re-verifies target ownership against petition.groupId before mutating.
 */
export async function onRevisionPetitionApproved(prisma: PrismaClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "living_document_revision");

  const accountId = petition.createdByMembershipId
    ? (await prisma.groupMembership.findUnique({ where: { id: petition.createdByMembershipId }, select: { accountId: true } }))?.accountId ?? null
    : petition.createdByProjectMembershipId
      ? (await prisma.projectMembership.findUnique({ where: { id: petition.createdByProjectMembershipId }, select: { accountId: true } }))?.accountId ?? null
      : null;

  const revision = await prisma.livingDocumentRevision.findUniqueOrThrow({
    where: { id: petition.subjectId },
    select: { livingDocumentId: true, body: true, livingDocument: { select: { spaceType: true, spaceId: true } } },
  });

  if (petition.scopeType === "project") {
    if (revision.livingDocument.spaceType !== "project" || revision.livingDocument.spaceId !== petition.scopeId) {
      throw new Error(`Revision target does not belong to project petition scope "${petition.scopeId}".`);
    }
  } else {
    await assertSpaceBelongsToGroup(
      prisma,
      revision.livingDocument.spaceType,
      revision.livingDocument.spaceId,
      petition.groupId,
    );
  }

  await prisma.$transaction([
    prisma.livingDocumentRevision.update({
      where: { id: petition.subjectId },
      data: { proposalId: petitionId, approvedAt: new Date(), approvedByAccountId: accountId },
    }),
    prisma.livingDocument.update({
      where: { id: revision.livingDocumentId },
      data: { currentBody: revision.body, lastRevisedAt: new Date() },
    }),
  ]);
}

/**
 * Opens a governance petition to archive a LivingDocument.
 * Fix 3: verifies the document's space belongs to groupId.
 */
export async function openLivingDocumentArchivalPetition(
  prisma: PrismaClient,
  opts: { documentId: string; createdByMembershipId: string; groupId: string },
) {
  // Fix 3: verify the document belongs to the stated group before opening a petition
  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: opts.documentId },
    select: { spaceType: true, spaceId: true },
  });
  await assertSpaceBelongsToGroup(prisma, document.spaceType, document.spaceId, opts.groupId);

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "archival",
    subjectType: "living_document_archive",
    subjectId: opts.documentId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

/**
 * Called after a LivingDocument archival petition is approved.
 * Sets archivedAt and provenance fields. The petition subjectId is the documentId.
 * Fix 3: re-verifies target ownership against petition.groupId before mutating.
 */
export async function onLivingDocumentArchivalPetitionApproved(prisma: PrismaClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "living_document_archive");

  const accountId = petition.createdByMembershipId
    ? (await prisma.groupMembership.findUnique({ where: { id: petition.createdByMembershipId }, select: { accountId: true } }))?.accountId ?? null
    : null;

  const document = await prisma.livingDocument.findUniqueOrThrow({
    where: { id: petition.subjectId },
    select: { spaceType: true, spaceId: true },
  });
  await assertSpaceBelongsToGroup(prisma, document.spaceType, document.spaceId, petition.groupId);

  await prisma.livingDocument.updateMany({
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
 * Lists LivingDocuments in a Coordination Space, ordered by lastRevisedAt desc.
 * Excludes archived by default.
 */
export async function listLivingDocuments(
  prisma: PrismaClient,
  spaceType: CoordinationSpaceType,
  spaceId: string,
  opts: { includeArchived?: boolean } = {},
) {
  return prisma.livingDocument.findMany({
    where: {
      spaceType,
      spaceId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { lastRevisedAt: "desc" },
  });
}

/**
 * Returns the full revision history for a LivingDocument, ordered newest first.
 * This is an explicit ID fetch -- returns history regardless of archival status.
 *
 * Note: ordering by createdAt desc is not perfectly deterministic when two revisions
 * share the same timestamp (e.g. in tests or rapid edits). A future revisionNumber
 * or sequence field would make this ordering stable.
 */
export async function getLivingDocumentHistory(prisma: PrismaClient, documentId: string) {
  return prisma.livingDocumentRevision.findMany({
    where: { livingDocumentId: documentId },
    orderBy: { createdAt: "desc" },
  });
}
