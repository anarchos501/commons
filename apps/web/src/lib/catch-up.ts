import type { PrismaClient } from "../generated/prisma/client";

// Catch-up-on-return: a passive "while you were away" digest of what changed across your spaces since
// you last visited each. Reuses GroupMembership.lastSeenAt (per-group; the home reads it WITHOUT
// resetting it, so this is side-effect-free and stays "sticky" until you next open the source group).
//
// Two privacy/perf invariants the rest of the file is built around:
//  • Null watermark → no catch-up. A member who never opened a group's page has lastSeenAt = null;
//    you were never "away" from a space you've never visited, so it never contributes. (We simply
//    skip null-watermark memberships — never COALESCE to joinedAt/epoch, which would dump a group's
//    entire history on a brand-new member.)
//  • The digest inherits each item's audience scoping. Concerns are reviewer-only, so a "N new
//    concerns" line only appears for a viewer who holds an active reviewer seat in that group — both
//    in the heavy digest AND in the cheap presence proxy (else the module's mere presence would leak
//    that something concern-y changed).

export type CatchUpGroupDigest = {
  groupId: string;
  groupName: string;
  sinceIso: string;
  resolvedPetitions: number;
  newPosts: number; // bulletins + publications + living-document revisions
  routedToYou: number; // support requests routed to you for action
  newMembers: number;
  newConcerns: number | null; // null = not entitled to see concerns here (line omitted)
  total: number; // sum of the visible counts (excludes a null concern line)
};

type Membership = { groupId: string; groupName: string; lastSeenAt: Date };

// The viewer's active memberships that have a non-null watermark, with the group name.
async function watermarkedMemberships(prisma: PrismaClient, accountId: string): Promise<Membership[]> {
  const rows = await prisma.groupMembership.findMany({
    where: { accountId, status: "active", lastSeenAt: { not: null } },
    select: { groupId: true, lastSeenAt: true, group: { select: { name: true } } },
  });
  return rows
    .filter((r): r is typeof r & { lastSeenAt: Date } => r.lastSeenAt !== null)
    .map((r) => ({ groupId: r.groupId, groupName: r.group.name, lastSeenAt: r.lastSeenAt }));
}

// The group ids in which the viewer holds an active, unexpired reviewer seat — the entitlement gate
// for any concern-derived signal.
async function reviewerGroupIds(prisma: PrismaClient, accountId: string): Promise<Set<string>> {
  const rows = await prisma.responsibilityAssignment.findMany({
    where: {
      endedAt: null,
      expiresAt: { gt: new Date() },
      membership: { accountId, status: "active" },
      responsibility: { type: "reviewer" },
    },
    select: { responsibility: { select: { groupId: true } } },
  });
  return new Set(rows.map((r) => r.responsibility.groupId));
}

/**
 * Cheap presence proxy: "is there probably a catch-up digest for this viewer?" A fixed handful of
 * count queries (one per activity type), each a single round-trip whose WHERE is an OR over the
 * viewer's groups with that group's own lastSeenAt threshold — bounded regardless of how many groups
 * the viewer is in (never a per-group fan-out). Short-circuits on the first hit. Concern activity is
 * only consulted for groups where the viewer is a reviewer.
 */
export async function hasCatchUpSince(prisma: PrismaClient, accountId: string): Promise<boolean> {
  const memberships = await watermarkedMemberships(prisma, accountId);
  if (memberships.length === 0) return false;

  const groupOr = memberships.map((m) => ({ groupId: m.groupId, gt: m.lastSeenAt }));
  const spaceOr = memberships.map((m) => ({ spaceId: m.groupId, gt: m.lastSeenAt }));

  // Petitions resolved while away.
  if (await prisma.petition.count({ where: { OR: groupOr.map((g) => ({ groupId: g.groupId, resolvedAt: { gt: g.gt } })) } })) return true;
  // New library posts (bulletins / publications / living docs).
  if (await prisma.bulletin.count({ where: { archivedAt: null, OR: spaceOr.map((g) => ({ spaceType: "group" as const, spaceId: g.spaceId, publishedAt: { gt: g.gt } })) } })) return true;
  if (await prisma.publication.count({ where: { archivedAt: null, OR: spaceOr.map((g) => ({ spaceType: "group" as const, spaceId: g.spaceId, createdAt: { gt: g.gt } })) } })) return true;
  if (await prisma.livingDocument.count({ where: { archivedAt: null, OR: spaceOr.map((g) => ({ spaceType: "group" as const, spaceId: g.spaceId, lastRevisedAt: { gt: g.gt } })) } })) return true;
  // Requests routed to you for action (RequestRoute → SupportRequest.groupId).
  if (await prisma.requestRoute.count({ where: { contributorAccountId: accountId, OR: groupOr.map((g) => ({ supportRequest: { is: { groupId: g.groupId } }, createdAt: { gt: g.gt } })) } })) return true;
  // New members joined.
  if (await prisma.groupMembership.count({ where: { status: "active", OR: groupOr.map((g) => ({ groupId: g.groupId, joinedAt: { gt: g.gt } })) } })) return true;
  // Concerns — only for groups where the viewer is a reviewer (else this signal must not be consulted).
  const reviewer = await reviewerGroupIds(prisma, accountId);
  const reviewerOr = groupOr.filter((g) => reviewer.has(g.groupId));
  if (reviewerOr.length && (await prisma.report.count({ where: { OR: reviewerOr.map((g) => ({ groupId: g.groupId, createdAt: { gt: g.gt } })) } }))) return true;

  return false;
}

/** Per-group digest since a watermark. `canSeeConcerns` is the reviewer-seat entitlement for that group. */
export async function summarizeGroupSinceLastSeen(
  prisma: PrismaClient,
  args: { accountId: string; groupId: string; groupName: string; since: Date; canSeeConcerns: boolean },
): Promise<CatchUpGroupDigest> {
  const { accountId, groupId, groupName, since, canSeeConcerns } = args;
  const [resolvedPetitions, bulletins, publications, livingDocs, routedToYou, newMembers, concerns] = await Promise.all([
    prisma.petition.count({ where: { groupId, resolvedAt: { gt: since } } }),
    prisma.bulletin.count({ where: { spaceType: "group", spaceId: groupId, archivedAt: null, publishedAt: { gt: since } } }),
    prisma.publication.count({ where: { spaceType: "group", spaceId: groupId, archivedAt: null, createdAt: { gt: since } } }),
    prisma.livingDocument.count({ where: { spaceType: "group", spaceId: groupId, archivedAt: null, lastRevisedAt: { gt: since } } }),
    prisma.requestRoute.count({ where: { contributorAccountId: accountId, createdAt: { gt: since }, supportRequest: { is: { groupId } } } }),
    prisma.groupMembership.count({ where: { groupId, status: "active", joinedAt: { gt: since } } }),
    canSeeConcerns ? prisma.report.count({ where: { groupId, createdAt: { gt: since } } }) : Promise.resolve(null),
  ]);
  const newPosts = bulletins + publications + livingDocs;
  const newConcerns = canSeeConcerns ? (concerns as number) : null;
  const total = resolvedPetitions + newPosts + routedToYou + newMembers + (newConcerns ?? 0);
  return { groupId, groupName, sinceIso: since.toISOString(), resolvedPetitions, newPosts, routedToYou, newMembers, newConcerns, total };
}

/**
 * The cross-space "while you were away" digest for the home: one entry per group with ≥1 visible
 * change since that group's lastSeenAt. Groups with a null watermark (never visited) are skipped.
 */
export async function getCatchUpDigest(prisma: PrismaClient, accountId: string): Promise<CatchUpGroupDigest[]> {
  const [memberships, reviewer] = await Promise.all([
    watermarkedMemberships(prisma, accountId),
    reviewerGroupIds(prisma, accountId),
  ]);
  const digests = await Promise.all(
    memberships.map((m) =>
      summarizeGroupSinceLastSeen(prisma, {
        accountId,
        groupId: m.groupId,
        groupName: m.groupName,
        since: m.lastSeenAt,
        canSeeConcerns: reviewer.has(m.groupId),
      }),
    ),
  );
  return digests.filter((d) => d.total > 0);
}
