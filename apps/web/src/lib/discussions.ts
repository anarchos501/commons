import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { openPetition, requireApprovedPetition } from "./petitions";
import { assertProjectWritable } from "./project-membership";
import { resolveGovernanceParams } from "./governance-resolver";
import { requireCoalitionAccess, requireCoalitionParticipant } from "./coalition-authorization";

export const GENERAL_DISCUSSION_TITLE = "General Discussion";

export type OpenThreadClosurePetitionResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "invalid_family" | "category_mismatch" | "creator_not_eligible" | "petition_already_open" };

type DiscussionSpace = {
  spaceType: CoordinationSpaceType;
  spaceId: string;
  groupId: string;
};

type ActiveMembership = {
  id: string;
  accountId: string;
};

async function requireActiveMembership(
  prisma: PrismaClient,
  membershipId: string,
  groupId: string,
): Promise<ActiveMembership> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, accountId: true, groupId: true, status: true, participationStatus: true },
  });

  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    throw new Error("Active group membership required for discussion participation.");
  }

  return { id: membership.id, accountId: membership.accountId };
}

async function requireActiveProjectMembership(
  prisma: PrismaClient,
  projectMembershipId: string,
  projectId: string,
): Promise<ActiveMembership> {
  const membership = await prisma.projectMembership.findUnique({
    where: { id: projectMembershipId },
    select: { id: true, accountId: true, projectId: true, status: true, participationStatus: true },
  });

  if (
    !membership ||
    membership.projectId !== projectId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    throw new Error("Active project membership required for project discussion participation.");
  }

  return { id: membership.id, accountId: membership.accountId };
}

async function assertDiscussionSpace(
  prisma: PrismaClient,
  { spaceType, spaceId, groupId }: DiscussionSpace,
): Promise<void> {
  await assertSpaceBelongsToGroup(prisma, spaceType, spaceId, groupId);
}

function daysFromNow(days: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.ceil(days) * 24 * 60 * 60 * 1000);
}

function daysBeforeNow(days: number, now = new Date()): Date {
  return new Date(now.getTime() - Math.ceil(days) * 24 * 60 * 60 * 1000);
}

async function getDiscussionRetention(
  prisma: PrismaClient,
  groupId: string,
): Promise<{ messageRetentionDays: number; threadInactivityDays: number }> {
  const params = await resolveGovernanceParams(prisma, groupId, "discussion");
  return {
    messageRetentionDays: Math.ceil(params.messageRetentionDays ?? 30),
    threadInactivityDays: Math.ceil(params.threadInactivityDays ?? 60),
  };
}

async function getCoalitionDiscussionRetention(
  prisma: PrismaClient,
  coalitionId: string,
): Promise<{ messageRetentionDays: number; threadInactivityDays: number }> {
  const memberships = await prisma.coalitionMembership.findMany({
    where: { coalitionId, endedAt: null },
    select: { groupId: true },
  });
  if (memberships.length === 0) throw new Error("Coalition has no active member groups.");
  const policies = await Promise.all(
    memberships.map((membership) => getDiscussionRetention(prisma, membership.groupId)),
  );
  return {
    messageRetentionDays: Math.min(...policies.map((policy) => policy.messageRetentionDays)),
    threadInactivityDays: Math.min(...policies.map((policy) => policy.threadInactivityDays)),
  };
}

export async function ensureGeneralDiscussion(
  prisma: PrismaClient,
  opts: DiscussionSpace & { createdByMembershipId: string },
) {
  await assertDiscussionSpace(prisma, opts);
  const membership = await requireActiveMembership(prisma, opts.createdByMembershipId, opts.groupId);

  const existing = await prisma.discussionThread.findFirst({
    where: {
      spaceType: opts.spaceType,
      spaceId: opts.spaceId,
      title: GENERAL_DISCUSSION_TITLE,
      closedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.discussionThread.create({
    data: {
      spaceType: opts.spaceType,
      spaceId: opts.spaceId,
      title: GENERAL_DISCUSSION_TITLE,
      createdByAccountId: membership.accountId,
    },
  });
}

export async function createDiscussionThread(
  prisma: PrismaClient,
  opts: DiscussionSpace & { createdByMembershipId: string; title: string },
) {
  await assertDiscussionSpace(prisma, opts);
  const membership = await requireActiveMembership(prisma, opts.createdByMembershipId, opts.groupId);
  const title = opts.title.trim();
  if (!title) throw new Error("Discussion thread title is required.");

  return prisma.discussionThread.create({
    data: {
      spaceType: opts.spaceType,
      spaceId: opts.spaceId,
      title,
      createdByAccountId: membership.accountId,
    },
  });
}

export async function createProjectDiscussionThread(
  prisma: PrismaClient,
  opts: { projectId: string; createdByProjectMembershipId: string; title: string },
) {
  await assertProjectWritable(prisma, opts.projectId);
  const membership = await requireActiveProjectMembership(prisma, opts.createdByProjectMembershipId, opts.projectId);
  const title = opts.title.trim();
  if (!title) throw new Error("Discussion thread title is required.");

  return prisma.discussionThread.create({
    data: {
      spaceType: "project",
      spaceId: opts.projectId,
      title,
      createdByAccountId: membership.accountId,
    },
  });
}

export async function createCoalitionDiscussionThread(
  prisma: PrismaClient,
  opts: { coalitionId: string; accountId: string; title: string },
) {
  const participant = await requireCoalitionParticipant(prisma, opts.accountId, opts.coalitionId);
  const title = opts.title.trim();
  if (!title) throw new Error("Discussion thread title is required.");
  return prisma.discussionThread.create({
    data: {
      spaceType: "coalition",
      spaceId: opts.coalitionId,
      title,
      createdByAccountId: participant.accountId,
    },
  });
}

export async function postDiscussionMessage(
  prisma: PrismaClient,
  opts: { threadId: string; groupId: string; authorMembershipId: string; body: string },
) {
  const membership = await requireActiveMembership(prisma, opts.authorMembershipId, opts.groupId);
  const body = opts.body.trim();
  if (!body) throw new Error("Discussion message body is required.");

  const thread = await prisma.discussionThread.findUnique({
    where: { id: opts.threadId },
    select: { id: true, spaceType: true, spaceId: true, closedAt: true, lastActivityAt: true },
  });
  if (!thread) throw new Error(`Discussion thread ${opts.threadId} not found.`);

  await assertDiscussionSpace(prisma, { spaceType: thread.spaceType, spaceId: thread.spaceId, groupId: opts.groupId });
  if (thread.closedAt) throw new Error("Closed discussion threads do not accept new messages.");

  const retention = await getDiscussionRetention(prisma, opts.groupId);
  const inactiveBefore = daysBeforeNow(retention.threadInactivityDays);
  if (thread.lastActivityAt < inactiveBefore) {
    throw new Error("Inactive discussion threads do not accept new messages.");
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const message = await tx.discussionMessage.create({
      data: {
        threadId: opts.threadId,
        authorId: membership.accountId,
        body,
        expiresAt: daysFromNow(retention.messageRetentionDays, now),
      },
    });

    await tx.discussionThread.update({
      where: { id: opts.threadId },
      data: {
        lastActivityAt: now,
        messageCount: { increment: 1 },
      },
    });

    return message;
  });
}

export async function postProjectDiscussionMessage(
  prisma: PrismaClient,
  opts: { threadId: string; projectId: string; authorProjectMembershipId: string; body: string },
) {
  await assertProjectWritable(prisma, opts.projectId);
  const membership = await requireActiveProjectMembership(prisma, opts.authorProjectMembershipId, opts.projectId);
  const body = opts.body.trim();
  if (!body) throw new Error("Discussion message body is required.");

  const thread = await prisma.discussionThread.findUnique({
    where: { id: opts.threadId },
    select: { id: true, spaceType: true, spaceId: true, closedAt: true, lastActivityAt: true },
  });
  if (!thread) throw new Error(`Discussion thread ${opts.threadId} not found.`);
  if (thread.spaceType !== "project" || thread.spaceId !== opts.projectId) {
    throw new Error(`Discussion thread ${opts.threadId} does not belong to project "${opts.projectId}".`);
  }
  if (thread.closedAt) throw new Error("Closed discussion threads do not accept new messages.");

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: opts.projectId },
    select: { foundingGroupId: true },
  });
  const retention = await getDiscussionRetention(prisma, project.foundingGroupId);
  const inactiveBefore = daysBeforeNow(retention.threadInactivityDays);
  if (thread.lastActivityAt < inactiveBefore) {
    throw new Error("Inactive discussion threads do not accept new messages.");
  }

  const expiresAt = daysFromNow(retention.messageRetentionDays);
  return prisma.$transaction(async (tx) => {
    const message = await tx.discussionMessage.create({
      data: { threadId: opts.threadId, authorId: membership.accountId, body, expiresAt },
    });
    await tx.discussionThread.update({
      where: { id: opts.threadId },
      data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
    });
    return message;
  });
}

export async function postCoalitionDiscussionMessage(
  prisma: PrismaClient,
  opts: { threadId: string; coalitionId: string; accountId: string; body: string },
) {
  const participant = await requireCoalitionParticipant(prisma, opts.accountId, opts.coalitionId);
  const body = opts.body.trim();
  if (!body) throw new Error("Discussion message body is required.");
  const thread = await prisma.discussionThread.findUnique({
    where: { id: opts.threadId },
    select: { spaceType: true, spaceId: true, closedAt: true, lastActivityAt: true },
  });
  if (!thread || thread.spaceType !== "coalition" || thread.spaceId !== opts.coalitionId) {
    throw new Error("Discussion thread does not belong to this coalition.");
  }
  if (thread.closedAt) throw new Error("Closed discussion threads do not accept new messages.");
  const retention = await getCoalitionDiscussionRetention(prisma, opts.coalitionId);
  if (thread.lastActivityAt < daysBeforeNow(retention.threadInactivityDays)) {
    throw new Error("Inactive discussion threads do not accept new messages.");
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const message = await tx.discussionMessage.create({
      data: {
        threadId: opts.threadId,
        authorId: participant.accountId,
        body,
        expiresAt: daysFromNow(retention.messageRetentionDays, now),
      },
    });
    await tx.discussionThread.update({
      where: { id: opts.threadId },
      data: { messageCount: { increment: 1 }, lastActivityAt: now },
    });
    return message;
  });
}

export async function listDiscussionThreads(
  prisma: PrismaClient,
  opts: DiscussionSpace & { includeClosed?: boolean },
) {
  await assertDiscussionSpace(prisma, opts);
  const retention = await getDiscussionRetention(prisma, opts.groupId);

  return prisma.discussionThread.findMany({
    where: {
      spaceType: opts.spaceType,
      spaceId: opts.spaceId,
      lastActivityAt: { gte: daysBeforeNow(retention.threadInactivityDays) },
      ...(opts.includeClosed ? {} : { closedAt: null }),
    },
    include: { creator: { select: { displayName: true } } },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * Project-native counterpart to listDiscussionThreads (mirrors
 * createProjectDiscussionThread / postProjectDiscussionMessage): authorizes
 * solely on project membership, not on a current host-group anchor. Required
 * because a hosted project's discussion space must remain readable even when
 * RFC-007 leaves it with zero active hosts (pending closure or closed) — the
 * group-anchored assertSpaceBelongsToGroup path is structurally unsatisfiable
 * for a hostless project. foundingGroupId is consulted only for the discussion
 * retention policy, never for authorization (RFC-007: it confers no standing).
 */
export async function listProjectDiscussionThreads(
  prisma: PrismaClient,
  opts: { projectId: string; includeClosed?: boolean },
) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: opts.projectId },
    select: { foundingGroupId: true },
  });
  const retention = await getDiscussionRetention(prisma, project.foundingGroupId);

  return prisma.discussionThread.findMany({
    where: {
      spaceType: "project",
      spaceId: opts.projectId,
      lastActivityAt: { gte: daysBeforeNow(retention.threadInactivityDays) },
      ...(opts.includeClosed ? {} : { closedAt: null }),
    },
    include: { creator: { select: { displayName: true } } },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listCoalitionDiscussionThreads(
  prisma: PrismaClient,
  opts: { coalitionId: string; accountId: string; includeClosed?: boolean },
) {
  await requireCoalitionAccess(prisma, opts.accountId, opts.coalitionId);
  const retention = await getCoalitionDiscussionRetention(prisma, opts.coalitionId);
  return prisma.discussionThread.findMany({
    where: {
      spaceType: "coalition",
      spaceId: opts.coalitionId,
      lastActivityAt: { gte: daysBeforeNow(retention.threadInactivityDays) },
      ...(opts.includeClosed ? {} : { closedAt: null }),
    },
    include: { creator: { select: { displayName: true } } },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listDiscussionMessages(prisma: PrismaClient, threadId: string) {
  return prisma.discussionMessage.findMany({
    where: {
      threadId,
      expiresAt: { gt: new Date() },
    },
    include: { author: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function openThreadClosurePetition(
  prisma: PrismaClient,
  opts: { threadId: string; createdByMembershipId: string; groupId: string },
): Promise<OpenThreadClosurePetitionResult> {
  const thread = await prisma.discussionThread.findUniqueOrThrow({
    where: { id: opts.threadId },
    select: { spaceType: true, spaceId: true },
  });
  await assertDiscussionSpace(prisma, { spaceType: thread.spaceType, spaceId: thread.spaceId, groupId: opts.groupId });

  const creatorMembership = await prisma.groupMembership.findUnique({
    where: { id: opts.createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !creatorMembership ||
    creatorMembership.groupId !== opts.groupId ||
    creatorMembership.status !== "active" ||
    creatorMembership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "creator_not_eligible" };
  }

  return openPetition(prisma, {
    groupId: opts.groupId,
    category: "discussion",
    subjectType: "discussion_thread_close",
    subjectId: opts.threadId,
    createdByMembershipId: opts.createdByMembershipId,
  });
}

export async function onThreadClosurePetitionApproved(prisma: PrismaClient, petitionId: string): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "discussion_thread_close");
  const thread = await prisma.discussionThread.findUniqueOrThrow({
    where: { id: petition.subjectId },
    select: { spaceType: true, spaceId: true },
  });
  await assertDiscussionSpace(prisma, { spaceType: thread.spaceType, spaceId: thread.spaceId, groupId: petition.groupId });

  await prisma.discussionThread.updateMany({
    where: { id: petition.subjectId, closedAt: null },
    data: {
      closedAt: new Date(),
      closedByPetitionId: petitionId,
      closureReason: "approved_by_community_petition",
    },
  });
}

export async function deleteExpiredDiscussionContent(
  prisma: PrismaClient,
  opts: { groupId: string; now?: Date },
): Promise<{ deletedMessages: number; deletedThreads: number }> {
  const now = opts.now ?? new Date();
  const retention = await getDiscussionRetention(prisma, opts.groupId);

  const [projects, responsibilities, coalitionMemberships] = await Promise.all([
    prisma.project.findMany({
      where: {
        // Retention reach follows current hosting only — founding provenance confers
        // no ongoing authority over a project's content once a group stops hosting it (RFC-007).
        hostings: { some: { groupId: opts.groupId, endedAt: null } },
      },
      select: { id: true },
    }),
    prisma.responsibility.findMany({
      where: { groupId: opts.groupId },
      select: { id: true },
    }),
    prisma.coalitionMembership.findMany({
      where: {
        groupId: opts.groupId,
        endedAt: null,
        coalition: { status: "active" },
      },
      select: { coalitionId: true },
    }),
  ]);
  const ownedSpaceFilter = [
    { spaceType: "group" as const, spaceId: opts.groupId },
    { spaceType: "project" as const, spaceId: { in: projects.map((project) => project.id) } },
    { spaceType: "responsibility" as const, spaceId: { in: responsibilities.map((responsibility) => responsibility.id) } },
    { spaceType: "coalition" as const, spaceId: { in: coalitionMemberships.map((membership) => membership.coalitionId) } },
  ];

  const expiringMessages = await prisma.discussionMessage.findMany({
    where: {
      expiresAt: { lte: now },
      thread: { OR: ownedSpaceFilter },
    },
    select: { threadId: true },
  });
  const affectedThreadIds = Array.from(new Set(expiringMessages.map((message) => message.threadId)));

  const result = await prisma.$transaction(async (tx) => {
    const messages = await tx.discussionMessage.deleteMany({
      where: {
        expiresAt: { lte: now },
        thread: { OR: ownedSpaceFilter },
      },
    });

    for (const threadId of affectedThreadIds) {
      const liveMessageCount = await tx.discussionMessage.count({
        where: { threadId, expiresAt: { gt: now } },
      });
      await tx.discussionThread.updateMany({
        where: { id: threadId },
        data: { messageCount: liveMessageCount },
      });
    }

    const inactiveBefore = daysBeforeNow(retention.threadInactivityDays, now);
    const threads = await tx.discussionThread.deleteMany({
      where: {
        OR: ownedSpaceFilter,
        lastActivityAt: { lte: inactiveBefore },
      },
    });

    return { deletedMessages: messages.count, deletedThreads: threads.count };
  });

  return result;
}
