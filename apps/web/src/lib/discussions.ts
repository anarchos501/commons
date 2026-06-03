import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationSpaceType } from "../generated/prisma/enums";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { openPetition, requireApprovedPetition } from "./petitions";
import { resolveGovernanceParams } from "./governance-resolver";

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

  const [projects, responsibilities] = await Promise.all([
    prisma.project.findMany({
      where: {
        OR: [
          { groupId: opts.groupId },
          { hostings: { some: { groupId: opts.groupId } } },
        ],
      },
      select: { id: true },
    }),
    prisma.responsibility.findMany({
      where: { groupId: opts.groupId },
      select: { id: true },
    }),
  ]);
  const ownedSpaceFilter = [
    { spaceType: "group" as const, spaceId: opts.groupId },
    { spaceType: "project" as const, spaceId: { in: projects.map((project) => project.id) } },
    { spaceType: "responsibility" as const, spaceId: { in: responsibilities.map((responsibility) => responsibility.id) } },
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
