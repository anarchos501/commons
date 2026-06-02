import type { PrismaClient } from "../generated/prisma/client";

/**
 * Asserts that a Coordination Space (identified by spaceType + spaceId) belongs to
 * the given groupId.
 *
 * - group space: spaceId must equal groupId directly.
 * - project space: project must be hosted by the group (via primary groupId or ProjectHosting).
 * - responsibility space: responsibility must belong to the group.
 *
 * Throws with a descriptive message if ownership is not established.
 * Used by communication governance wrappers and approval handlers to prevent
 * cross-group content mutation.
 */
export async function assertSpaceBelongsToGroup(
  prisma: PrismaClient,
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
    // Accept if the project's primary groupId matches, or if the group hosts the project
    const project = await prisma.project.findUnique({
      where: { id: spaceId },
      select: { groupId: true },
    });
    if (project?.groupId === groupId) return;

    const hosting = await prisma.projectHosting.findFirst({
      where: { projectId: spaceId, groupId },
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

  throw new Error(`Unknown spaceType "${spaceType}".`);
}
