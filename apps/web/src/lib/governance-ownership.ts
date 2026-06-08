import type { Prisma, PrismaClient } from "../generated/prisma/client";

/**
 * Asserts that a Coordination Space (identified by spaceType + spaceId) belongs to
 * the given groupId.
 *
 * - group space: spaceId must equal groupId directly.
 * - project space: the group must be an active host of the project (ProjectHosting with
 *   endedAt == null). Project.foundingGroupId is immutable provenance only and confers
 *   no current-hosting authority (RFC-007).
 * - responsibility space: responsibility must belong to the group.
 * - coalition space: the group must be an active member of the coalition.
 *
 * Throws with a descriptive message if ownership is not established.
 * Used by communication governance wrappers and approval handlers to prevent
 * cross-group content mutation.
 */
export async function assertSpaceBelongsToGroup(
  prisma: PrismaClient | Prisma.TransactionClient,
  spaceType: string,
  spaceId: string,
  groupId: string,
): Promise<void> {
  if (spaceType === "group") {
    if (spaceId !== groupId) {
      throw new Error(
        `Content belongs to group space "${spaceId}" but petition is for group "${groupId}".`,
      );
    }
    return;
  }

  if (spaceType === "project") {
    // Current hosting is determined solely by active ProjectHosting rows — founding
    // provenance (Project.foundingGroupId) confers no authorization (RFC-007).
    const hosting = await prisma.projectHosting.findFirst({
      where: { projectId: spaceId, groupId, endedAt: null },
    });
    if (hosting) return;

    throw new Error(
      `Project "${spaceId}" is not hosted by group "${groupId}".`,
    );
  }

  if (spaceType === "responsibility") {
    const responsibility = await prisma.responsibility.findUnique({
      where: { id: spaceId },
      select: { groupId: true },
    });
    if (responsibility?.groupId === groupId) return;

    throw new Error(
      `Responsibility "${spaceId}" does not belong to group "${groupId}".`,
    );
  }

  if (spaceType === "coalition") {
    const membership = await prisma.coalitionMembership.findFirst({
      where: {
        coalitionId: spaceId,
        groupId,
        endedAt: null,
        coalition: { status: "active" },
      },
      select: { id: true },
    });
    if (membership) return;

    throw new Error(
      `Coalition "${spaceId}" does not include group "${groupId}".`,
    );
  }

  throw new Error(`Unknown spaceType "${spaceType}".`);
}
