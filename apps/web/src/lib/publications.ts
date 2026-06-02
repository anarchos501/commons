// D4: Publication lib -- create, add entries, archive, list.
// A Publication remains the same Publication throughout its lifetime.
// Adding entries never creates a new Publication -- only new PublicationEntry records.
import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";

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
