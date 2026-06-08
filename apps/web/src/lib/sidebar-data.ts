import type { PrismaClient } from "../generated/prisma/client";

export type SidebarData = {
  displayName: string;
  groupMemberships: Array<{ groupId: string; groupName: string }>;
  projectMemberships: Array<{ projectId: string; projectName: string }>;
  coalitionMemberships: Array<{ coalitionId: string; coalitionName: string }>;
  canAccessNodeGovernance: boolean;
  canManageFeedback: boolean;
  responsibilityAssignments: Array<{ responsibilityId: string; type: string; groupId: string }>;
  unreadRouteCount: number;
};

export async function getSidebarData(prisma: PrismaClient, accountId: string): Promise<SidebarData> {
  const now = new Date();

  const [account, groupMemberships, projectMemberships, coalitionMemberships, activeAssignments, unreadRouteCount, activeHostCount] = await Promise.all([
    prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { displayName: true },
    }),
    prisma.groupMembership.findMany({
      where: { accountId, status: "active" },
      select: { groupId: true, group: { select: { name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.projectMembership.findMany({
      where: { accountId, status: "active" },
      select: {
        projectId: true,
        project: { select: { name: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.coalition.findMany({
      where: {
        status: "active",
        memberships: {
          some: {
            endedAt: null,
            group: { memberships: { some: { accountId, status: "active" } } },
          },
        },
      },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.responsibilityAssignment.findMany({
      where: {
        membership: { accountId, status: "active" },
        endedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        responsibility: { select: { id: true, type: true, groupId: true } },
      },
    }),
    prisma.requestRoute.count({
      where: { contributorAccountId: accountId, status: "notified" },
    }),
    prisma.nodeHost.count({
      where: { accountId, revokedAt: null },
    }),
  ]);

  return {
    displayName: account.displayName,
    groupMemberships: groupMemberships.map((m) => ({ groupId: m.groupId, groupName: m.group.name })),
    projectMemberships: projectMemberships.map((m) => ({
      projectId: m.projectId,
      projectName: m.project.name,
    })),
    coalitionMemberships: coalitionMemberships.map((coalition) => ({
      coalitionId: coalition.id,
      coalitionName: coalition.name,
    })),
    canAccessNodeGovernance: groupMemberships.length > 0 || activeHostCount > 0,
    canManageFeedback: activeHostCount > 0,
    responsibilityAssignments: activeAssignments.map((a) => ({
      responsibilityId: a.responsibility.id,
      type: a.responsibility.type,
      groupId: a.responsibility.groupId,
    })),
    unreadRouteCount,
  };
}
