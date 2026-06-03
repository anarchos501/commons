import type { PrismaClient } from "../generated/prisma/client";

export type SidebarData = {
  displayName: string;
  groupMemberships: Array<{ groupId: string; groupName: string }>;
  projectMemberships: Array<{ projectId: string; projectName: string; groupId: string }>;
  responsibilityAssignments: Array<{ type: string; groupId: string }>;
  unreadRouteCount: number;
};

export async function getSidebarData(prisma: PrismaClient, accountId: string): Promise<SidebarData> {
  const now = new Date();

  const [account, groupMemberships, projectMemberships, activeAssignments, unreadRouteCount] = await Promise.all([
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
        project: { select: { name: true, groupId: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.responsibilityAssignment.findMany({
      where: {
        membership: { accountId, status: "active" },
        endedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        responsibility: { select: { type: true, groupId: true } },
      },
    }),
    prisma.requestRoute.count({
      where: { contributorAccountId: accountId, status: "notified" },
    }),
  ]);

  return {
    displayName: account.displayName,
    groupMemberships: groupMemberships.map((m) => ({ groupId: m.groupId, groupName: m.group.name })),
    projectMemberships: projectMemberships.map((m) => ({
      projectId: m.projectId,
      projectName: m.project.name,
      groupId: m.project.groupId,
    })),
    responsibilityAssignments: activeAssignments.map((a) => ({
      type: a.responsibility.type,
      groupId: a.responsibility.groupId,
    })),
    unreadRouteCount,
  };
}
