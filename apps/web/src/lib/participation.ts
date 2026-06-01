import type { PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";
import { endAssignmentsForMember } from "./responsibilities";

const QUIET_THRESHOLD_DAYS = 90;
const DORMANT_THRESHOLD_DAYS = 365;
const SEEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Records a Group Presence Event for a logged-in member.
 *
 * Reactivation (Quiet/Dormant → Active) is never rate-limited and happens immediately.
 * Routine lastSeenAt refreshes are rate-limited to once per hour to reduce write load.
 *
 * Guest access via request token is NOT a Group Presence Event — callers must not
 * invoke this function for unauthenticated or token-only access paths.
 */
export async function recordGroupPresence(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true, participationStatus: true, lastSeenAt: true },
  });

  if (!membership || membership.status !== "active") return;

  // Reactivation: always immediate, bypasses the rate limit.
  // RFC-004: returning to Active restores participation only.
  // Responsibilities require re-volunteering — do not restore assignments here.
  if (membership.participationStatus !== "active") {
    await prisma.groupMembership.update({
      where: { accountId_groupId: { accountId, groupId } },
      data: { participationStatus: "active", lastSeenAt: new Date() },
    });
    await logAction(prisma, {
      actorAccountId: accountId,
      groupId,
      action: "participation.reactivated",
      targetType: "group_membership",
      targetId: membership.id,
      metadata: { previousStatus: membership.participationStatus },
    });
    return;
  }

  // Rate-limit routine presence writes
  if (membership.lastSeenAt && Date.now() - membership.lastSeenAt.getTime() < SEEN_REFRESH_INTERVAL_MS) {
    return;
  }

  await prisma.groupMembership.update({
    where: { accountId_groupId: { accountId, groupId } },
    data: { lastSeenAt: new Date() },
  });
}

/**
 * Evaluates absence-based transitions for all members in a group.
 *
 * Runs separately from presence recording. Called alongside recordGroupPresence
 * on group page loads (lazy evaluation — no scheduler required for local beta).
 */
export async function applyParticipationTransitions(
  prisma: PrismaClient,
  groupId: string,
): Promise<void> {
  const quietCutoff = daysAgo(QUIET_THRESHOLD_DAYS);
  const dormantCutoff = daysAgo(DORMANT_THRESHOLD_DAYS);

  // Active → Quiet
  const toQuiet = await prisma.groupMembership.findMany({
    where: {
      groupId,
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
    await prisma.groupMembership.updateMany({
      where: { id: { in: toQuiet.map((m) => m.id) } },
      data: { participationStatus: "quiet" },
    });
    for (const m of toQuiet) {
      await endAssignmentsForMember(prisma, m.id, "quiet");
      await logAction(prisma, {
        groupId,
        action: "participation.quieted",
        targetType: "group_membership",
        targetId: m.id,
        metadata: { previousStatus: "active", thresholdDays: QUIET_THRESHOLD_DAYS },
      });
    }
  }

  // Quiet → Dormant
  const toDormant = await prisma.groupMembership.findMany({
    where: {
      groupId,
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
    await prisma.groupMembership.updateMany({
      where: { id: { in: toDormant.map((m) => m.id) } },
      data: { participationStatus: "dormant" },
    });
    for (const m of toDormant) {
      await endAssignmentsForMember(prisma, m.id, "dormant");
      await logAction(prisma, {
        groupId,
        action: "participation.dormanted",
        targetType: "group_membership",
        targetId: m.id,
        metadata: { previousStatus: "quiet", thresholdDays: DORMANT_THRESHOLD_DAYS },
      });
    }
  }
}

/**
 * Count of Active members (membershipStatus: active AND participationStatus: active).
 * Use for petition denominator calculations.
 */
export async function getActiveParticipantCount(prisma: PrismaClient, groupId: string): Promise<number> {
  return prisma.groupMembership.count({
    where: { groupId, status: "active", participationStatus: "active" },
  });
}

/**
 * Count of Active + Quiet members (membershipStatus: active AND participationStatus: active|quiet).
 * Use for governance preference aggregation.
 */
export async function getParticipatingMemberCount(prisma: PrismaClient, groupId: string): Promise<number> {
  return prisma.groupMembership.count({
    where: { groupId, status: "active", participationStatus: { in: ["active", "quiet"] } },
  });
}
