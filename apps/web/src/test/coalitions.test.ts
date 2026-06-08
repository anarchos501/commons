import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { addPetitionSupport, withdrawPetition } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import {
  openCoalitionDepartureProposal,
  openCoalitionFormationProposal,
  openCoalitionJoinProposal,
  openCoalitionRemovalProposal,
} from "../lib/coalitions";
import {
  createCoalitionDiscussionThread,
  deleteExpiredDiscussionContent,
  listCoalitionDiscussionThreads,
  postCoalitionDiscussionMessage,
} from "../lib/discussions";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("coalition formation requires every prospective group petition to approve", async () => {
  const fixture = await createFixture("coal_form", 2);
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name: "Shared Watershed",
      description: "Two groups coordinating shared work.",
      content: "Should our groups form this coalition?",
      participants: sponsors(fixture),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveBundle(result.petitionIds, fixture);

    const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "succeeded");
    assert.ok(proposal.coalitionId);
    const memberships = await activeCoalitionGroups(proposal.coalitionId!);
    assert.deepEqual(memberships, fixture.groups.map((group) => group.id).sort());
  } finally {
    await cleanupFixture("coal_form");
  }
});

test("coalition bundle rejection supersedes unfinished child petitions", async () => {
  const fixture = await createFixture("coal_reject", 2);
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name: "Rejected Coalition",
      content: "Should our groups form this coalition?",
      participants: sponsors(fixture),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.petition.update({
      where: { id: result.petitionIds[0] },
      data: { closesAt: new Date(Date.now() - 1000) },
    });
    await evaluateAndApplyPetition(prisma, result.petitionIds[0]);

    const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    const sibling = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[1] } });
    assert.equal(proposal.status, "failed-rejected");
    assert.equal(sibling.status, "superseded");
    assert.equal(proposal.coalitionId, null);
  } finally {
    await cleanupFixture("coal_reject");
  }
});

test("one group can initiate formation while every group keeps its own electorate", async () => {
  const fixture = await createFixture("coal_independent", 2);
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name: "Independent Sponsors",
      content: "Should our groups form this coalition?",
      participants: [
        sponsor(fixture, 0),
        { groupId: fixture.groups[1].id },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const children = await prisma.coalitionProposalPetition.findMany({
      where: { proposalId: result.proposalId },
      orderBy: { groupId: "asc" },
    });
    const childPetitions = await prisma.petition.findMany({
      where: { id: { in: children.map((child) => child.petitionId) } },
    });
    const petitionById = new Map(childPetitions.map((petition) => [petition.id, petition]));
    assert.equal(children.length, 2);
    assert.equal(petitionById.get(children[0].petitionId)?.createdByMembershipId, fixture.memberships[0].id);
    assert.equal(petitionById.get(children[1].petitionId)?.createdByMembershipId, null);

    await approveBundle(result.petitionIds, fixture);
    const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "succeeded");
  } finally {
    await cleanupFixture("coal_independent");
  }
});

test("withdrawing one child immediately fails the bundle and supersedes siblings", async () => {
  const fixture = await createFixture("coal_withdraw", 2);
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name: "Withdrawn Coalition",
      content: "Should our groups form this coalition?",
      participants: sponsors(fixture),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const withdrawal = await withdrawPetition(prisma, result.petitionIds[0], fixture.memberships[0].id);
    assert.equal(withdrawal.outcome, "withdrawn");
    await evaluateAndApplyPetition(prisma, result.petitionIds[0]);

    const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    const sibling = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[1] } });
    assert.equal(proposal.status, "failed-withdrawn");
    assert.equal(sibling.status, "superseded");
  } finally {
    await cleanupFixture("coal_withdraw");
  }
});

test("duplicate formation approvals fail the losing bundle instead of leaving it open", async () => {
  const fixture = await createFixture("coal_duplicate", 2);
  try {
    const first = await openCoalitionFormationProposal(prisma, {
      name: "One Name",
      content: "First attempt.",
      participants: sponsors(fixture),
    });
    const second = await openCoalitionFormationProposal(prisma, {
      name: "One Name",
      content: "Concurrent attempt.",
      participants: sponsors(fixture),
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    await approveBundle(first.petitionIds, fixture);
    await approveBundle(second.petitionIds, fixture);

    const losingProposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: second.proposalId } });
    assert.equal(losingProposal.status, "failed-withdrawn");
    assert.equal(
      await prisma.coalition.count({ where: { nodeId: fixture.node.id, name: "One Name" } }),
      1,
    );
  } finally {
    await cleanupFixture("coal_duplicate");
  }
});

test("joining requires approval from the applicant and every existing member", async () => {
  const fixture = await createFixture("coal_join", 3);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Joinable Coalition");
    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: sponsor(fixture, 2),
      memberSponsors: [sponsor(fixture, 0), sponsor(fixture, 1)],
      content: "Should the applicant join?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveBundle(result.petitionIds, fixture);

    assert.deepEqual(await activeCoalitionGroups(coalitionId), fixture.groups.map((group) => group.id).sort());
  } finally {
    await cleanupFixture("coal_join");
  }
});

test("an applicant can initiate joining without belonging to every current member group", async () => {
  const fixture = await createFixture("coal_join_independent", 3);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Independent Join Coalition");
    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: sponsor(fixture, 2),
      memberSponsors: [
        { groupId: fixture.groups[0].id },
        { groupId: fixture.groups[1].id },
      ],
      content: "Should the applicant join?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveBundle(result.petitionIds, fixture);
    assert.deepEqual(await activeCoalitionGroups(coalitionId), fixture.groups.map((group) => group.id).sort());
  } finally {
    await cleanupFixture("coal_join_independent");
  }
});

test("voluntary departure requires only the departing group's approval", async () => {
  const fixture = await createFixture("coal_depart", 3);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1, 2], "Departure Coalition");
    const result = await openCoalitionDepartureProposal(prisma, {
      coalitionId,
      departing: sponsor(fixture, 2),
      content: "Should our group leave this coalition?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.petitionIds.length, 1);

    await approveBundle(result.petitionIds, fixture);

    assert.deepEqual(
      await activeCoalitionGroups(coalitionId),
      [fixture.groups[0].id, fixture.groups[1].id].sort(),
    );
    const ended = await prisma.coalitionMembership.findFirstOrThrow({
      where: { coalitionId, groupId: fixture.groups[2].id, endedAt: { not: null } },
    });
    assert.equal(ended.endReason, "voluntary_departure");
  } finally {
    await cleanupFixture("coal_depart");
  }
});

test("the final departure dissolves an empty coalition", async () => {
  const fixture = await createFixture("coal_dissolve", 2);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Dissolving Coalition");
    for (const index of [0, 1]) {
      const result = await openCoalitionDepartureProposal(prisma, {
        coalitionId,
        departing: sponsor(fixture, index),
        content: "Our group is leaving.",
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      await approveBundle(result.petitionIds, fixture);
    }

    const coalition = await prisma.coalition.findUniqueOrThrow({ where: { id: coalitionId } });
    assert.equal(coalition.status, "dissolved");
    assert.ok(coalition.dissolvedAt);
    assert.deepEqual(await activeCoalitionGroups(coalitionId), []);
  } finally {
    await cleanupFixture("coal_dissolve");
  }
});

test("removal excludes the target and requires every remaining group", async () => {
  const fixture = await createFixture("coal_remove", 3);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1, 2], "Removal Coalition");
    const result = await openCoalitionRemovalProposal(prisma, {
      coalitionId,
      targetGroupId: fixture.groups[2].id,
      remainingSponsors: [sponsor(fixture, 0), sponsor(fixture, 1)],
      content: "Should the remaining groups remove the target?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.petitionIds.length, 2);

    await approveBundle(result.petitionIds, fixture);

    assert.deepEqual(
      await activeCoalitionGroups(coalitionId),
      [fixture.groups[0].id, fixture.groups[1].id].sort(),
    );
  } finally {
    await cleanupFixture("coal_remove");
  }
});

test("one remaining group can initiate removal while all remaining groups decide", async () => {
  const fixture = await createFixture("coal_remove_independent", 3);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1, 2], "Independent Removal Coalition");
    const result = await openCoalitionRemovalProposal(prisma, {
      coalitionId,
      targetGroupId: fixture.groups[2].id,
      remainingSponsors: [
        sponsor(fixture, 0),
        { groupId: fixture.groups[1].id },
      ],
      content: "Should the remaining groups remove the target?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveBundle(result.petitionIds, fixture);
    assert.deepEqual(
      await activeCoalitionGroups(coalitionId),
      [fixture.groups[0].id, fixture.groups[1].id].sort(),
    );
  } finally {
    await cleanupFixture("coal_remove_independent");
  }
});

test("participant changes fail an open coalition bundle and supersede its petitions", async () => {
  const fixture = await createFixture("coal_snapshot", 4);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Snapshot Coalition");
    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: sponsor(fixture, 2),
      memberSponsors: [sponsor(fixture, 0), sponsor(fixture, 1)],
      content: "Should the applicant join?",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.coalitionMembership.create({
      data: { coalitionId, groupId: fixture.groups[3].id },
    });
    await evaluateAndApplyPetition(prisma, result.petitionIds[0]);

    const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    const petitions = await prisma.petition.findMany({ where: { id: { in: result.petitionIds } } });
    assert.equal(proposal.status, "failed-withdrawn");
    assert.equal(petitions.every((petition) => petition.status === "superseded"), true);
  } finally {
    await cleanupFixture("coal_snapshot");
  }
});

test("coalition discussion authorization is account-deduplicated across member groups", async () => {
  const fixture = await createFixture("coal_space", 3, true);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Shared Space Coalition");
    const sharedAccountId = fixture.accounts[0].id;
    const thread = await createCoalitionDiscussionThread(prisma, {
      coalitionId,
      accountId: sharedAccountId,
      title: "Shared coordination",
    });
    await postCoalitionDiscussionMessage(prisma, {
      coalitionId,
      threadId: thread.id,
      accountId: sharedAccountId,
      body: "One account identity, even through two groups.",
    });
    const threads = await listCoalitionDiscussionThreads(prisma, {
      coalitionId,
      accountId: sharedAccountId,
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0].messageCount, 1);

    await assert.rejects(
      () => createCoalitionDiscussionThread(prisma, {
        coalitionId,
        accountId: fixture.accounts[2].id,
        title: "Outsider",
      }),
      /coalition member group/,
    );
  } finally {
    await cleanupFixture("coal_space");
  }
});

test("coalition discussion read access survives quiet participation but dissolved coalitions are closed", async () => {
  const fixture = await createFixture("coal_space_read", 2);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Readable Coalition");
    const thread = await createCoalitionDiscussionThread(prisma, {
      coalitionId,
      accountId: fixture.accounts[0].id,
      title: "Quiet readers",
    });
    await prisma.groupMembership.update({
      where: { id: fixture.memberships[0].id },
      data: { participationStatus: "quiet" },
    });

    const threads = await listCoalitionDiscussionThreads(prisma, {
      coalitionId,
      accountId: fixture.accounts[0].id,
    });
    assert.equal(threads.some((candidate) => candidate.id === thread.id), true);
    await assert.rejects(
      () => postCoalitionDiscussionMessage(prisma, {
        coalitionId,
        threadId: thread.id,
        accountId: fixture.accounts[0].id,
        body: "quiet write",
      }),
      /coalition member group/,
    );

    await prisma.coalition.update({ where: { id: coalitionId }, data: { status: "dissolved" } });
    await assert.rejects(
      () => listCoalitionDiscussionThreads(prisma, {
        coalitionId,
        accountId: fixture.accounts[1].id,
      }),
      /coalition member group/,
    );
  } finally {
    await cleanupFixture("coal_space_read");
  }
});

test("coalition discussion cleanup is reachable through active member groups", async () => {
  const fixture = await createFixture("coal_space_cleanup", 2);
  try {
    const coalitionId = await formCoalition(fixture, [0, 1], "Cleanup Coalition");
    const thread = await createCoalitionDiscussionThread(prisma, {
      coalitionId,
      accountId: fixture.accounts[0].id,
      title: "Cleanup",
    });
    const message = await postCoalitionDiscussionMessage(prisma, {
      coalitionId,
      threadId: thread.id,
      accountId: fixture.accounts[0].id,
      body: "Temporary",
    });
    await prisma.discussionMessage.update({
      where: { id: message.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await deleteExpiredDiscussionContent(prisma, { groupId: fixture.groups[0].id });
    assert.equal(result.deletedMessages, 1);
    const updatedThread = await prisma.discussionThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(updatedThread.messageCount, 0);
  } finally {
    await cleanupFixture("coal_space_cleanup");
  }
});

async function createFixture(prefix: string, groupCount: number, sharedMembership = false) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const groups = [];
  const accounts = [];
  const memberships = [];
  for (let i = 0; i < groupCount; i++) {
    groups.push(await prisma.group.create({
      data: { id: `${prefix}_group_${i}`, nodeId: node.id, name: `Group ${prefix} ${i}`, membershipPolicy: "open" },
    }));
    accounts.push(await prisma.account.create({
      data: {
        id: `${prefix}_account_${i}`,
        homeNodeId: node.id,
        displayName: `User ${prefix} ${i}`,
        accountType: "member",
        profileVisibility: "private",
      },
    }));
    memberships.push(await prisma.groupMembership.create({
      data: {
        id: `${prefix}_membership_${i}`,
        accountId: accounts[i].id,
        groupId: groups[i].id,
        status: "active",
        participationStatus: "active",
      },
    }));
  }
  if (sharedMembership && groupCount >= 2) {
    await prisma.groupMembership.delete({ where: { id: memberships[1].id } });
    memberships[1] = await prisma.groupMembership.create({
      data: {
        id: `${prefix}_membership_1`,
        accountId: accounts[0].id,
        groupId: groups[1].id,
        status: "active",
        participationStatus: "active",
      },
    });
  }
  return { node, groups, accounts, memberships };
}

function sponsors(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.groups.map((_, index) => sponsor(fixture, index));
}

function sponsor(fixture: Awaited<ReturnType<typeof createFixture>>, index: number) {
  return {
    groupId: fixture.groups[index].id,
    createdByMembershipId: fixture.memberships[index].id,
  };
}

async function formCoalition(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  indexes: number[],
  name: string,
): Promise<string> {
  const result = await openCoalitionFormationProposal(prisma, {
    name,
    content: "Form the coalition.",
    participants: indexes.map((index) => sponsor(fixture, index)),
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Coalition formation did not open.");
  await approveBundle(result.petitionIds, fixture);
  const proposal = await prisma.coalitionProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
  return proposal.coalitionId!;
}

async function approveBundle(
  petitionIds: string[],
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  const children = await prisma.coalitionProposalPetition.findMany({
    where: { petitionId: { in: petitionIds } },
  });
  for (const child of children) {
    const membership = fixture.memberships.find((candidate) => candidate.groupId === child.groupId);
    assert.ok(membership);
    await addPetitionSupport(prisma, { petitionId: child.petitionId, actorAccountId: membership.accountId, membershipId: membership.id });
  }
  await prisma.petition.updateMany({
    where: { id: { in: petitionIds } },
    data: { closesAt: new Date(Date.now() - 1000) },
  });
  await evaluateAndApplyPetition(prisma, petitionIds[0]);
}

async function activeCoalitionGroups(coalitionId: string): Promise<string[]> {
  const memberships = await prisma.coalitionMembership.findMany({
    where: { coalitionId, endedAt: null },
    select: { groupId: true },
  });
  return memberships.map((membership) => membership.groupId).sort();
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({
    where: { petition: { groupId: { startsWith: prefix } } },
  });
  await prisma.coalitionProposalPetition.deleteMany({
    where: { groupId: { startsWith: prefix } },
  });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.coalitionProposal.deleteMany({ where: { proposedByGroupId: { startsWith: prefix } } });
  await prisma.discussionMessage.deleteMany({
    where: { thread: { creator: { id: { startsWith: prefix } } } },
  });
  await prisma.discussionThread.deleteMany({
    where: { creator: { id: { startsWith: prefix } } },
  });
  await prisma.coalitionMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.coalition.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
