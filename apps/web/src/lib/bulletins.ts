import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";

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
 * Future: accept archivedByAccountId, archiveProposalId, archiveReason (Governance RFC).
 */
export async function archiveBulletin(prisma: PrismaClient, bulletinId: string): Promise<void> {
  await prisma.bulletin.updateMany({
    where: { id: bulletinId, archivedAt: null },
    data: { archivedAt: new Date() },
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
