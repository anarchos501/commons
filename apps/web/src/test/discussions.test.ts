import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  createDiscussionThread,
  createProjectDiscussionThread,
  deleteExpiredDiscussionContent,
  ensureGeneralDiscussion,
  GENERAL_DISCUSSION_TITLE,
  listDiscussionMessages,
  listDiscussionThreads,
  listProjectDiscussionThreads,
  onThreadClosurePetitionApproved,
  openThreadClosurePetition,
  postDiscussionMessage,
  postProjectDiscussionMessage,
} from "../lib/discussions";
import { addPetitionSupport, evaluatePetition } from "../lib/petitions";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("ensureGeneralDiscussion is idempotent and recreates after closure", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_general");
  try {
    const first = await ensureGeneralDiscussion(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    const second = await ensureGeneralDiscussion(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(first.id, second.id);

    await prisma.discussionThread.update({ where: { id: first.id }, data: { closedAt: new Date(), closureReason: "test" } });
    const replacement = await ensureGeneralDiscussion(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.notEqual(replacement.id, first.id);
    assert.equal(replacement.title, GENERAL_DISCUSSION_TITLE);
    assert.equal(replacement.closedAt, null);
  } finally {
    await cleanupDiscussionFixture("disc_general");
  }
});

test("active members create threads and post messages without petition", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_post");
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Garden day" });
    const before = await prisma.discussionThread.findUniqueOrThrow({ where: { id: thread.id } });
    const message = await postDiscussionMessage(prisma, { threadId: thread.id, groupId: group.id, authorMembershipId: memberships[0].id, body: "Bring gloves." });
    assert.ok(message.expiresAt > new Date());

    const after = await prisma.discussionThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(after.messageCount, 1);
    assert.ok(after.lastActivityAt >= before.lastActivityAt);

    const messages = await listDiscussionMessages(prisma, thread.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].body, "Bring gloves.");
  } finally {
    await cleanupDiscussionFixture("disc_post");
  }
});

test("project member without host-group membership creates project thread and message", async () => {
  const { group } = await createDiscussionFixture("disc_project_only", 1);
  const project = await prisma.project.create({ data: { id: "disc_project_only_project", foundingGroupId: group.id, name: "Project Only", status: "active" } });
  try {
    const account = await prisma.account.create({
      data: {
        id: "disc_project_only_project_account",
        homeNodeId: "disc_project_only_node",
        displayName: "Project Only",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    const projectMembership = await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });

    const thread = await createProjectDiscussionThread(prisma, {
      projectId: project.id,
      createdByProjectMembershipId: projectMembership.id,
      title: "Project thread",
    });
    const message = await postProjectDiscussionMessage(prisma, {
      threadId: thread.id,
      projectId: project.id,
      authorProjectMembershipId: projectMembership.id,
      body: "Project-only members can post.",
    });

    assert.equal(thread.spaceType, "project");
    assert.equal(thread.spaceId, project.id);
    assert.equal(message.body, "Project-only members can post.");
  } finally {
    await cleanupDiscussionFixture("disc_project_only");
  }
});

test("closed projects reject new discussion threads", async () => {
  const { group } = await createDiscussionFixture("disc_project_closed", 1);
  const project = await prisma.project.create({
    data: { id: "disc_project_closed_project", foundingGroupId: group.id, name: "Closed Project", status: "closed", archivedAt: new Date() },
  });
  try {
    const account = await prisma.account.create({
      data: {
        id: "disc_project_closed_account",
        homeNodeId: "disc_project_closed_node",
        displayName: "Closed Project Member",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    const projectMembership = await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });

    await assert.rejects(
      () => createProjectDiscussionThread(prisma, {
        projectId: project.id,
        createdByProjectMembershipId: projectMembership.id,
        title: "Too late",
      }),
      /read-only/,
    );
  } finally {
    await cleanupDiscussionFixture("disc_project_closed");
  }
});

test("quiet and dormant members cannot create threads or post messages", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_participation");
  try {
    await prisma.groupMembership.update({ where: { id: memberships[1].id }, data: { participationStatus: "quiet" } });
    await prisma.groupMembership.update({ where: { id: memberships[2].id }, data: { participationStatus: "dormant" } });

    await assert.rejects(
      () => createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[1].id, title: "Quiet thread" }),
      /Active group membership/,
    );
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Active thread" });
    await assert.rejects(
      () => postDiscussionMessage(prisma, { threadId: thread.id, groupId: group.id, authorMembershipId: memberships[2].id, body: "Dormant post" }),
      /Active group membership/,
    );
  } finally {
    await cleanupDiscussionFixture("disc_participation");
  }
});

test("thread closure petition approval closes the thread and blocks new messages", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_close", 3);
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Close me" });
    const result = await openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const evaluated = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evaluated.outcome, "approved");
    await onThreadClosurePetitionApproved(prisma, result.petitionId);

    const closed = await prisma.discussionThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.ok(closed.closedAt);
    assert.equal(closed.closedByPetitionId, result.petitionId);
    assert.equal(closed.closureReason, "approved_by_community_petition");

    await assert.rejects(
      () => postDiscussionMessage(prisma, { threadId: thread.id, groupId: group.id, authorMembershipId: memberships[0].id, body: "Nope" }),
      /Closed discussion threads/,
    );
  } finally {
    await cleanupDiscussionFixture("disc_close");
  }
});

test("quiet members cannot open or support discussion closure petitions", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_close_quiet", 3);
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Decision" });
    await prisma.groupMembership.update({ where: { id: memberships[1].id }, data: { participationStatus: "quiet" } });

    const openByQuiet = await openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[1].id });
    assert.equal(openByQuiet.ok, false);
    if (!openByQuiet.ok) assert.equal(openByQuiet.reason, "creator_not_eligible");

    const openByActive = await openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(openByActive.ok, true);
    if (!openByActive.ok) return;
    const support = await addPetitionSupport(prisma, { petitionId: openByActive.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    assert.equal(support.ok, false);
    if (!support.ok) assert.equal(support.reason, "not_eligible");
  } finally {
    await cleanupDiscussionFixture("disc_close_quiet");
  }
});

test("duplicate thread closure petitions are rejected while one is open", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_close_duplicate", 3);
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "One petition" });
    const first = await openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(first.ok, true);

    const second = await openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[1].id });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "petition_already_open");
  } finally {
    await cleanupDiscussionFixture("disc_close_duplicate");
  }
});

test("thread closure petition rejects threads from another group space", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_wrong_a");
  const { group: otherGroup, memberships: otherMemberships } = await createDiscussionFixture("disc_wrong_b");
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: otherGroup.id, groupId: otherGroup.id, createdByMembershipId: otherMemberships[0].id, title: "Foreign thread" });
    await assert.rejects(
      () => openThreadClosurePetition(prisma, { threadId: thread.id, groupId: group.id, createdByMembershipId: memberships[0].id }),
      /group/,
    );
  } finally {
    await cleanupDiscussionFixture("disc_wrong_a");
    await cleanupDiscussionFixture("disc_wrong_b");
  }
});

test("cleanup hard-deletes expired messages and inactive threads", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_cleanup");
  try {
    const thread = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Old thread" });
    const message = await postDiscussionMessage(prisma, { threadId: thread.id, groupId: group.id, authorMembershipId: memberships[0].id, body: "Temporary" });

    await prisma.discussionMessage.update({ where: { id: message.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const messageCleanup = await deleteExpiredDiscussionContent(prisma, { groupId: group.id });
    assert.equal(messageCleanup.deletedMessages, 1);
    assert.equal(await prisma.discussionMessage.findUnique({ where: { id: message.id } }), null);
    const afterMessageCleanup = await prisma.discussionThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(afterMessageCleanup.messageCount, 0);

    const oldDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
    await prisma.discussionThread.update({ where: { id: thread.id }, data: { lastActivityAt: oldDate } });
    const threadCleanup = await deleteExpiredDiscussionContent(prisma, { groupId: group.id });
    assert.equal(threadCleanup.deletedThreads, 1);
    assert.equal(await prisma.discussionThread.findUnique({ where: { id: thread.id } }), null);
  } finally {
    await cleanupDiscussionFixture("disc_cleanup");
  }
});

test("listDiscussionThreads excludes inactive threads", async () => {
  const { group, memberships } = await createDiscussionFixture("disc_list");
  try {
    const active = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Active" });
    const inactive = await createDiscussionThread(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id, createdByMembershipId: memberships[0].id, title: "Inactive" });
    await prisma.discussionThread.update({ where: { id: inactive.id }, data: { lastActivityAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) } });

    const threads = await listDiscussionThreads(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id });
    assert.equal(threads.some((thread) => thread.id === active.id), true);
    assert.equal(threads.some((thread) => thread.id === inactive.id), false);
  } finally {
    await cleanupDiscussionFixture("disc_list");
  }
});

test("listProjectDiscussionThreads returns project threads after the last host withdraws", async () => {
  const { group } = await createDiscussionFixture("disc_project_hostless", 1);
  const project = await prisma.project.create({
    data: {
      id: "disc_project_hostless_project",
      foundingGroupId: group.id,
      name: "Hostless Project",
      status: "active",
      pendingClosureAt: new Date(),
    },
  });
  try {
    await prisma.projectHosting.create({
      data: { projectId: project.id, groupId: group.id, endedAt: new Date() },
    });
    const account = await prisma.account.create({
      data: {
        id: "disc_project_hostless_account",
        homeNodeId: "disc_project_hostless_node",
        displayName: "Hostless Project Member",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    const projectMembership = await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });
    const thread = await prisma.discussionThread.create({
      data: {
        spaceType: "project",
        spaceId: project.id,
        title: "Still readable",
        createdByAccountId: account.id,
      },
    });

    const threads = await listProjectDiscussionThreads(prisma, { projectId: project.id });

    assert.equal(threads.some((candidate) => candidate.id === thread.id), true);
    assert.equal(projectMembership.projectId, project.id);
  } finally {
    await cleanupDiscussionFixture("disc_project_hostless");
  }
});

async function createDiscussionFixture(prefix: string, memberCount = 3) {
  await cleanupDiscussionFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.comm.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];

  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({ data: { id: `${prefix}_account_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const membership = await prisma.groupMembership.create({ data: { id: `${prefix}_membership_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(membership);
  }

  return { node, group, memberships };
}

async function cleanupDiscussionFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.discussionMessage.deleteMany({ where: { thread: { spaceId: { startsWith: prefix } } } });
  await prisma.discussionThread.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.projectHostingProposal.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.projectMembership.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.projectHosting.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { foundingGroupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
