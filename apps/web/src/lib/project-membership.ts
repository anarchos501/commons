import type { PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";

const QUIET_THRESHOLD_DAYS = 90;
const DORMANT_THRESHOLD_DAYS = 365;
const SEEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Records a Project Presence Event for a logged-in project member.
 *
 * Reactivation (Quiet/Dormant → Active) is never rate-limited.
 * Routine lastSeenAt refreshes are rate-limited to once per hour.
 *
 * RFC-004 principle applies: reactivation restores participation only.
 * Responsibility assignments are not restored by presence recording.
 */
export async function recordProjectPresence(
  prisma: PrismaClient,
  accountId: string,
  projectId: string,
): Promise<void> {
  const membership = await prisma.projectMembership.findUnique({
    where: { accountId_projectId: { accountId, projectId } },
    select: { id: true, status: true, participationStatus: true, lastSeenAt: true },
  });

  if (!membership || membership.status !== "active") return;

  if (membership.participationStatus !== "active") {
    await prisma.projectMembership.update({
      where: { accountId_projectId: { accountId, projectId } },
      data: { participationStatus: "active", lastSeenAt: new Date() },
    });
    await logAction(prisma, {
      actorAccountId: accountId,
      action: "project_participation.reactivated",
      targetType: "project_membership",
      targetId: membership.id,
      metadata: { projectId, previousStatus: membership.participationStatus },
    });
    await syncProjectStatus(prisma, projectId);
    return;
  }

  if (membership.lastSeenAt && Date.now() - membership.lastSeenAt.getTime() < SEEN_REFRESH_INTERVAL_MS) {
    return;
  }

  await prisma.projectMembership.update({
    where: { accountId_projectId: { accountId, projectId } },
    data: { lastSeenAt: new Date() },
  });
}

/**
 * Evaluates absence-based participation transitions for all members in a project.
 * Also updates Project.status based on the resulting member state.
 */
export async function applyProjectParticipationTransitions(
  prisma: PrismaClient,
  projectId: string,
): Promise<void> {
  const quietCutoff = daysAgo(QUIET_THRESHOLD_DAYS);
  const dormantCutoff = daysAgo(DORMANT_THRESHOLD_DAYS);

  // Active → Quiet
  const toQuiet = await prisma.projectMembership.findMany({
    where: {
      projectId,
      status: "active",
      participationStatus: "active",
      OR: [
        { lastSeenAt: { lt: quietCutoff } },
        { lastSeenAt: null, joinedAt: { lt: quietCutoff } },
      ],
    },
    select: { id: true, accountId: true },
  });

  if (toQuiet.length > 0) {
    await prisma.projectMembership.updateMany({
      where: { id: { in: toQuiet.map((m) => m.id) } },
      data: { participationStatus: "quiet" },
    });
    for (const m of toQuiet) {
      await logAction(prisma, {
        action: "project_participation.quieted",
        targetType: "project_membership",
        targetId: m.id,
        metadata: { projectId, thresholdDays: QUIET_THRESHOLD_DAYS },
      });
    }
  }

  // Quiet → Dormant
  const toDormant = await prisma.projectMembership.findMany({
    where: {
      projectId,
      status: "active",
      participationStatus: "quiet",
      OR: [
        { lastSeenAt: { lt: dormantCutoff } },
        { lastSeenAt: null, joinedAt: { lt: dormantCutoff } },
      ],
    },
    select: { id: true, accountId: true },
  });

  if (toDormant.length > 0) {
    await prisma.projectMembership.updateMany({
      where: { id: { in: toDormant.map((m) => m.id) } },
      data: { participationStatus: "dormant" },
    });
    for (const m of toDormant) {
      await logAction(prisma, {
        action: "project_participation.dormanted",
        targetType: "project_membership",
        targetId: m.id,
        metadata: { projectId, thresholdDays: DORMANT_THRESHOLD_DAYS },
      });
    }
  }

  await syncProjectStatus(prisma, projectId);
}

/**
 * Derives and writes Project.status from current membership state.
 * Called after any membership participation transition.
 */
async function syncProjectStatus(prisma: PrismaClient, projectId: string): Promise<void> {
  const [activeCount, quietCount, hostingCount] = await Promise.all([
    prisma.projectMembership.count({ where: { projectId, status: "active", participationStatus: "active" } }),
    prisma.projectMembership.count({ where: { projectId, status: "active", participationStatus: { in: ["active", "quiet"] } } }),
    prisma.projectHosting.count({ where: { projectId } }),
  ]);

  // completed and closed are terminal — never auto-overwritten by participation transitions
  const current = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!current || current.status === "completed" || current.status === "closed") return;

  let newStatus: "active" | "quiet" | "dormant" | "closed";
  if (activeCount > 0) {
    newStatus = "active";
  } else if (quietCount > 0) {
    newStatus = "quiet";
  } else if (hostingCount > 0) {
    newStatus = "dormant";
  } else {
    newStatus = "closed";
  }

  if (newStatus !== current.status) {
    await prisma.project.update({ where: { id: projectId }, data: { status: newStatus } });
  }
}

/**
 * Sets a project member's membership status to inactive (voluntary leave).
 * Does not affect group membership.
 */
export async function leaveProject(
  prisma: PrismaClient,
  accountId: string,
  projectId: string,
): Promise<void> {
  const membership = await prisma.projectMembership.findUnique({
    where: { accountId_projectId: { accountId, projectId } },
    select: { id: true, status: true },
  });

  if (!membership || membership.status !== "active") return;

  await prisma.projectMembership.update({
    where: { accountId_projectId: { accountId, projectId } },
    data: { status: "inactive" },
  });

  await logAction(prisma, {
    actorAccountId: accountId,
    action: "project_membership.left",
    targetType: "project_membership",
    targetId: membership.id,
    metadata: { projectId },
  });

  await syncProjectStatus(prisma, projectId);
}

/**
 * Guards project-gated actions. Throws if the account does not hold
 * an active ProjectMembership for the project.
 */
export async function requireProjectMembership(
  prisma: PrismaClient,
  accountId: string,
  projectId: string,
): Promise<void> {
  const membership = await prisma.projectMembership.findUnique({
    where: { accountId_projectId: { accountId, projectId } },
    select: { status: true },
  });

  if (!membership || membership.status !== "active") {
    throw new Error("Active project membership required.");
  }
}

/**
 * Called after group-level dormancy transitions.
 * For each member who just became dormant in this group, checks if they are
 * also dormant/inactive in ALL other host groups for each project they belong to.
 * If so, sets their ProjectMembership.status = inactive.
 *
 * This preserves the constitutional rule: a member retains project membership
 * as long as they are non-dormant in at least one host group.
 */
export async function applyGroupDormancyToProjectMemberships(
  prisma: PrismaClient,
  groupId: string,
  dormantAccountIds: string[],
): Promise<void> {
  if (dormantAccountIds.length === 0) return;

  for (const accountId of dormantAccountIds) {
    // Find all projects this account belongs to that are hosted by this group
    const projectMemberships = await prisma.projectMembership.findMany({
      where: {
        accountId,
        status: "active",
        project: { hostings: { some: { groupId } } },
      },
      select: { id: true, projectId: true },
    });

    for (const pm of projectMemberships) {
      // Check if any host group still has this account as active or quiet
      const stillParticipating = await prisma.groupMembership.findFirst({
        where: {
          accountId,
          status: "active",
          participationStatus: { in: ["active", "quiet"] },
          group: { hostedProjects: { some: { projectId: pm.projectId } } },
        },
      });

      if (!stillParticipating) {
        await prisma.projectMembership.update({
          where: { id: pm.id },
          data: { status: "inactive" },
        });
        await logAction(prisma, {
          actorAccountId: accountId,
          action: "project_membership.dormancy_removed",
          targetType: "project_membership",
          targetId: pm.id,
          metadata: { projectId: pm.projectId, triggeringGroupId: groupId },
        });
        await syncProjectStatus(prisma, pm.projectId);
      }
    }
  }
}
