import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";

const QUIET_THRESHOLD_DAYS = 90;
const DORMANT_THRESHOLD_DAYS = 365;
const PENDING_CLOSURE_GRACE_DAYS = 30;
const SEEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Derived hosting condition (RFC-007): a project is "hosted" iff at least one
 * ProjectHosting row is currently active (endedAt IS NULL). This is the sole
 * source of truth for current hosting — Project.foundingGroupId is immutable
 * provenance and confers no ongoing standing once a group is no longer an
 * active host.
 */
async function isProjectHosted(prisma: PrismaClient, projectId: string): Promise<boolean> {
  const activeHostingCount = await prisma.projectHosting.count({ where: { projectId, endedAt: null } });
  return activeHostingCount > 0;
}

export async function assertProjectWritable(prisma: PrismaClient, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, pendingClosureAt: true },
  });
  if (!project) throw new Error(`Project "${projectId}" not found.`);
  if (project.status === "closed") {
    throw new Error("Closed projects are read-only.");
  }
  if (project.pendingClosureAt !== null && !(await isProjectHosted(prisma, projectId))) {
    throw new Error("Projects pending closure only allow successor-host adoption governance.");
  }
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
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, pendingClosureAt: true },
  });
  if (!project || project.status === "closed") return;
  if (project.pendingClosureAt !== null && !(await isProjectHosted(prisma, projectId))) return;

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
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, pendingClosureAt: true },
  });
  // closed is terminal — fully read-only, including participation tracking
  if (!project || project.status === "closed") return;

  // RFC-007 electorate freeze: once a project has no active host, absence-based
  // transitions are suspended here — they would otherwise erode the very
  // electorate the pending-closure adoption decision depends on, purely as a
  // side effect of the hosting crisis rather than anyone's choice. This keeps
  // a live query of "active + active" members faithful to the set that
  // qualified when pendingClosureAt was set. Voluntary leave (leaveProject) is
  // separately blocked via assertProjectWritable, and presence-driven
  // reactivation (recordProjectPresence) separately no-ops — RFC-007 lists
  // "project membership changes" among the active-work changes pending closure
  // disallows (see also the endedAt-filtered checks in
  // applyGroupDormancyToProjectMemberships, which freeze the same way).
  const frozen = project.pendingClosureAt !== null && !(await isProjectHosted(prisma, projectId));

  if (!frozen) {
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
  }

  await syncProjectStatus(prisma, projectId);
}

/**
 * Derives and writes Project.status from current membership participation alone.
 * Called after any membership participation transition.
 *
 * RFC-007: participation (active/quiet/dormant) and hosting (pendingClosureAt/
 * closed — see syncProjectHostingLifecycle) are fully independent axes. Neither
 * may overwrite or pre-empt the other — a project can be vibrantly `active` the
 * moment its last host departs, or `dormant` for years while still hosted.
 */
async function syncProjectStatus(prisma: PrismaClient, projectId: string): Promise<void> {
  const [activeCount, quietCount] = await Promise.all([
    prisma.projectMembership.count({ where: { projectId, status: "active", participationStatus: "active" } }),
    prisma.projectMembership.count({ where: { projectId, status: "active", participationStatus: { in: ["active", "quiet"] } } }),
  ]);

  // completed and closed are terminal — never auto-overwritten by participation transitions
  const current = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!current || current.status === "completed" || current.status === "closed") return;

  let newStatus: "active" | "quiet" | "dormant";
  if (activeCount > 0) {
    newStatus = "active";
  } else if (quietCount > 0) {
    newStatus = "quiet";
  } else {
    newStatus = "dormant";
  }

  if (newStatus !== current.status) {
    await prisma.project.update({ where: { id: projectId }, data: { status: newStatus } });
  }
}

/**
 * Derives and applies a project's hosting-driven lifecycle (RFC-007): opens or
 * cancels the pending-closure grace period, and applies the amended `closed`
 * trigger once that period elapses with no successor host. Call after any
 * change to a project's ProjectHosting rows (host withdrawal, new-host
 * adoption), and lazily on access — mirrors how applyProjectParticipationTransitions
 * is invoked, so a stale grace-period deadline is always caught on next view.
 *
 *   hosted          := an active ProjectHosting row exists (endedAt IS NULL)
 *   pending closure := !hosted && pendingClosureAt !== null
 *
 * `completed` is a one-way exit (RFC-007): a project whose mission concluded
 * intentionally never enters pending closure and is never converted to `closed`
 * by hostlessness — those two terminal stories must never blur into one.
 * `pendingClosureAt` is intentionally left set on a `closed` project — it is
 * the historical record of when the grace period began (mirrors how
 * ProjectHosting.endedAt preserves history rather than deleting rows).
 */
export async function syncProjectHostingLifecycle(prisma: PrismaClient, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, pendingClosureAt: true },
  });
  if (!project || project.status === "completed" || project.status === "closed") return;

  const hosted = await isProjectHosted(prisma, projectId);

  if (hosted) {
    if (project.pendingClosureAt !== null) {
      // A successor host arrived in time — cancel the clock and return the
      // project to ordinary hosted standing, untouched by the episode.
      await prisma.project.update({
        where: { id: projectId },
        data: { pendingClosureAt: null, pendingClosureElectorate: Prisma.JsonNull },
      });
      await logAction(prisma, {
        action: "project_hosting.pending_closure_cancelled",
        targetType: "project",
        targetId: projectId,
        metadata: { projectId },
      });
    }
    return;
  }

  if (project.pendingClosureAt === null) {
    // Lost its last active host — open the 30-day adoption grace period. This
    // is also the instant the pending-closure electorate is defined (frozen at
    // "active membership + active participation", as of right now).
    const pendingClosureAt = new Date();
    const frozenMemberships = await prisma.projectMembership.findMany({
      where: { projectId, status: "active", participationStatus: "active" },
      select: { id: true, accountId: true },
      orderBy: { joinedAt: "asc" },
    });
    const pendingClosureElectorate = {
      projectId,
      capturedAt: pendingClosureAt.toISOString(),
      projectMembershipIds: frozenMemberships.map((membership) => membership.id),
      accountIds: frozenMemberships.map((membership) => membership.accountId),
    };
    await prisma.$transaction([
      prisma.project.update({ where: { id: projectId }, data: { pendingClosureAt, pendingClosureElectorate } }),
      prisma.petition.updateMany({
        where: {
          scopeType: "project",
          scopeId: projectId,
          status: "open",
          subjectType: { not: "project_hosting_acceptance" },
        },
        data: { status: "superseded", resolvedAt: pendingClosureAt },
      }),
    ]);
    await logAction(prisma, {
      action: "project_hosting.pending_closure_opened",
      targetType: "project",
      targetId: projectId,
      metadata: { projectId, graceDays: PENDING_CLOSURE_GRACE_DAYS },
    });
    return;
  }

  const deadline = project.pendingClosureAt.getTime() + PENDING_CLOSURE_GRACE_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() >= deadline) {
    // Amended trigger (RFC-007): closed now fires on grace-period expiry with
    // no successor host — not "no members AND no hosts". Closure automatically
    // archives the project (RFC-007 Archive Behavior: read-access is unchanged;
    // only editability and active-list discoverability are affected).
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "closed", archivedAt: new Date() },
    });
    await logAction(prisma, {
      action: "project_hosting.closed_no_successor_host",
      targetType: "project",
      targetId: projectId,
      metadata: { projectId, pendingClosureAt: project.pendingClosureAt.toISOString(), graceDays: PENDING_CLOSURE_GRACE_DAYS },
    });
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
  await assertProjectWritable(prisma, projectId);

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
 * also dormant/inactive in ALL other *currently active* host groups for each
 * project they belong to. If so, sets their ProjectMembership.status = inactive.
 *
 * This preserves the constitutional rule: a member retains project membership
 * as long as they are non-dormant in at least one active host group.
 *
 * RFC-007: every check below is scoped to active hostings (endedAt: null) —
 * a group that has withdrawn confers no ongoing standing, so its members'
 * participation there can no longer keep a project membership alive. This is
 * also, automatically, the electorate freeze for hostless projects: once a
 * project has no active ProjectHosting row, `project: { hostings: { some: {
 * groupId, endedAt: null } } }` can never match it for any groupId, so this
 * cascade simply stops reaching it — exactly the "evaporation" the
 * pending-closure electorate must be protected from (see
 * applyProjectParticipationTransitions for the participation-side half of the
 * same freeze).
 */
export async function applyGroupDormancyToProjectMemberships(
  prisma: PrismaClient,
  groupId: string,
  dormantAccountIds: string[],
): Promise<void> {
  if (dormantAccountIds.length === 0) return;

  for (const accountId of dormantAccountIds) {
    // Find all projects this account belongs to that are *actively* hosted by this group
    const projectMemberships = await prisma.projectMembership.findMany({
      where: {
        accountId,
        status: "active",
        project: { hostings: { some: { groupId, endedAt: null } } },
      },
      select: { id: true, projectId: true },
    });

    for (const pm of projectMemberships) {
      // Check if any *currently active* host group still has this account as active or quiet
      const stillParticipating = await prisma.groupMembership.findFirst({
        where: {
          accountId,
          status: "active",
          participationStatus: { in: ["active", "quiet"] },
          group: { hostedProjects: { some: { projectId: pm.projectId, endedAt: null } } },
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
