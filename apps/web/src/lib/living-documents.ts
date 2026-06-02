// D4: LivingDocument lib -- create, revise, archive, list.
// Discussion is a separate, deferred communication type. It must remain
// distinct from Bulletins, Publications, and LivingDocuments.
import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";

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
 * Future: accept archivedByAccountId, archiveProposalId, archiveReason (Governance RFC).
 */
export async function archiveLivingDocument(prisma: PrismaClient, documentId: string): Promise<void> {
  await prisma.livingDocument.updateMany({
    where: { id: documentId, archivedAt: null },
    data: { archivedAt: new Date() },
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
