import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createGroup } from "../lib/group-settings";
import {
  getNodeGovernanceEligibility,
  resolveNodeGovernanceParams,
  upsertNodeGovernanceSignal,
} from "../lib/node-governance";
import {
  openGroupStewardNomination,
  openHostNoConfidence,
  openHostStewardNomination,
  openStewardResignation,
} from "../lib/node-stewardship";
import { addNodePetitionSupport, addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { labelNodeGroupForAccount } from "../lib/node-privacy";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("first group bootstrap creates the initial node host and later groups do not", async () => {
  const fixture = await createBareFixture("node_bootstrap", 2);
  try {
    const [first, second] = await Promise.all([
      createGroup(prisma, {
        nodeId: fixture.node.id,
        creatorAccountId: fixture.accounts[0].id,
        name: "First Group",
      }),
      createGroup(prisma, {
        nodeId: fixture.node.id,
        creatorAccountId: fixture.accounts[1].id,
        name: "Second Group",
      }),
    ]);
    assert.equal(first.ok && second.ok, true);
    const hosts = await prisma.nodeHost.findMany({ where: { nodeId: fixture.node.id, revokedAt: null } });
    assert.equal(hosts.length, 1);
    assert.equal(fixture.accounts.some((account) => account.id === hosts[0].accountId), true);
  } finally {
    await cleanup("node_bootstrap");
  }
});

test("node eligibility deduplicates accounts and uses strongest same-node participation", async () => {
  const fixture = await createFixture("node_eligibility", 3);
  try {
    await prisma.groupMembership.update({
      where: { id: fixture.memberships[0].id },
      data: { participationStatus: "dormant" },
    });
    await prisma.groupMembership.create({
      data: {
        id: "node_eligibility_shared_membership",
        accountId: fixture.accounts[0].id,
        groupId: fixture.groups[1].id,
        status: "active",
        participationStatus: "active",
      },
    });
    await prisma.account.update({
      where: { id: fixture.accounts[0].id },
      data: { homeNodeId: fixture.otherNode.id },
    });
    const eligibility = await getNodeGovernanceEligibility(prisma, fixture.node.id);
    assert.equal(eligibility.filter((entry) => entry.accountId === fixture.accounts[0].id).length, 1);
    assert.equal(
      eligibility.find((entry) => entry.accountId === fixture.accounts[0].id)?.participationStatus,
      "active",
    );

    const signal = await upsertNodeGovernanceSignal(prisma, {
      nodeId: fixture.node.id,
      accountId: fixture.accounts[0].id,
      category: "node_stewardship",
      signal: 1,
    });
    assert.equal(signal.ok, true);
  } finally {
    await cleanup("node_eligibility");
  }
});

test("host nomination creates only candidate consent before node appointment", async () => {
  const fixture = await createFixture("node_host_nomination", 2);
  try {
    await makeHost(fixture, 0);
    const opened = await openHostStewardNomination(prisma, {
      nodeId: fixture.node.id,
      candidateGroupId: fixture.groups[1].id,
      hostAccountId: fixture.accounts[0].id,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    let proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.status, "awaiting_candidate_consent");
    assert.equal(proposal.nodePetitionId, null);
    assert.equal((await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } })).stewardGroupId, null);

    await approveGroupPetition(opened.petitionId, fixture.memberships[1].id);
    proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.status, "awaiting_node_vote");
    assert.ok(proposal.nodePetitionId);
    await approveNodePetition(proposal.nodePetitionId!, fixture.accounts.map((account) => account.id));
    assert.equal(
      (await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } })).stewardGroupId,
      fixture.groups[1].id,
    );
  } finally {
    await cleanup("node_host_nomination");
  }
});

test("approved group self-nomination serves as candidate consent", async () => {
  const fixture = await createFixture("node_self_nomination", 2);
  try {
    const opened = await openGroupStewardNomination(prisma, {
      nodeId: fixture.node.id,
      initiatingGroupId: fixture.groups[0].id,
      candidateGroupId: fixture.groups[0].id,
      createdByMembershipId: fixture.memberships[0].id,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await approveGroupPetition(opened.petitionId, fixture.memberships[0].id);
    const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.candidateConsentPetitionId, null);
    assert.ok(proposal.nodePetitionId);
  } finally {
    await cleanup("node_self_nomination");
  }
});

test("host no confidence does not remove the steward until node approval", async () => {
  const fixture = await createFixture("node_no_confidence", 3);
  try {
    await makeHost(fixture, 0);
    await prisma.node.update({
      where: { id: fixture.node.id },
      data: { stewardGroupId: fixture.groups[1].id },
    });
    const opened = await openHostNoConfidence(prisma, {
      nodeId: fixture.node.id,
      hostAccountId: fixture.accounts[0].id,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(
      (await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } })).stewardGroupId,
      fixture.groups[1].id,
    );
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: opened.petitionId } });
    const snapshot = petition.governanceSnapshot as { threshold: number; noConfidenceThreshold: number };
    assert.equal(snapshot.noConfidenceThreshold, 0.667);
    assert.equal(snapshot.threshold, 0.667);

    await approveNodePetition(opened.petitionId, fixture.accounts.map((account) => account.id));
    assert.equal(
      (await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } })).stewardGroupId,
      null,
    );
  } finally {
    await cleanup("node_no_confidence");
  }
});

test("steward resignation requires only approval from the steward group", async () => {
  const fixture = await createFixture("node_resignation", 2);
  try {
    await prisma.node.update({
      where: { id: fixture.node.id },
      data: { stewardGroupId: fixture.groups[0].id },
    });
    const opened = await openStewardResignation(prisma, {
      nodeId: fixture.node.id,
      createdByMembershipId: fixture.memberships[0].id,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await approveGroupPetition(opened.petitionId, fixture.memberships[0].id);
    assert.equal(
      (await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } })).stewardGroupId,
      null,
    );
  } finally {
    await cleanup("node_resignation");
  }
});

test("stale appointment proposals cannot revive after a later stewardship era", async () => {
  const fixture = await createFixture("node_stale_appointment", 3);
  try {
    await makeHost(fixture, 0);
    const stale = await openHostStewardNomination(prisma, {
      nodeId: fixture.node.id,
      candidateGroupId: fixture.groups[1].id,
      hostAccountId: fixture.accounts[0].id,
    });
    const current = await openHostStewardNomination(prisma, {
      nodeId: fixture.node.id,
      candidateGroupId: fixture.groups[2].id,
      hostAccountId: fixture.accounts[0].id,
    });
    assert.equal(stale.ok, true);
    assert.equal(current.ok, true);
    if (!stale.ok || !current.ok) return;

    await approveGroupPetition(current.petitionId, fixture.memberships[2].id);
    const currentProposal = await prisma.nodeStewardProposal.findUniqueOrThrow({
      where: { id: current.proposalId },
    });
    await approveNodePetition(currentProposal.nodePetitionId!, fixture.accounts.map((account) => account.id));

    const resignation = await openStewardResignation(prisma, {
      nodeId: fixture.node.id,
      createdByMembershipId: fixture.memberships[2].id,
    });
    assert.equal(resignation.ok, true);
    if (!resignation.ok) return;
    await approveGroupPetition(resignation.petitionId, fixture.memberships[2].id);

    await approveGroupPetition(stale.petitionId, fixture.memberships[1].id);
    const staleProposal = await prisma.nodeStewardProposal.findUniqueOrThrow({
      where: { id: stale.proposalId },
    });
    const node = await prisma.node.findUniqueOrThrow({ where: { id: fixture.node.id } });
    assert.equal(staleProposal.status, "failed-stale");
    assert.equal(staleProposal.nodePetitionId, null);
    assert.equal(node.stewardGroupId, null);
    assert.equal(node.stewardRevision, 2);
  } finally {
    await cleanup("node_stale_appointment");
  }
});

test("revoked hosts cannot initiate steward questions", async () => {
  const fixture = await createFixture("node_revoked_host", 2);
  try {
    const host = await makeHost(fixture, 0);
    await prisma.nodeHost.update({ where: { id: host.id }, data: { revokedAt: new Date() } });
    const result = await openHostStewardNomination(prisma, {
      nodeId: fixture.node.id,
      candidateGroupId: fixture.groups[1].id,
      hostAccountId: fixture.accounts[0].id,
    });
    assert.deepEqual(result, { ok: false, reason: "not_eligible" });
  } finally {
    await cleanup("node_revoked_host");
  }
});

test("no-confidence threshold never falls below ordinary appointment threshold", async () => {
  const fixture = await createFixture("node_threshold_floor", 2);
  try {
    for (const account of fixture.accounts) {
      await upsertNodeGovernanceSignal(prisma, {
        nodeId: fixture.node.id,
        accountId: account.id,
        category: "node_stewardship",
        signal: 1,
      });
    }
    const params = await resolveNodeGovernanceParams(prisma, fixture.node.id, "node_stewardship");
    assert.equal(params.noConfidenceThreshold, 0.5);
    assert.equal(params.threshold, 0.05);
    assert.equal(Math.max(params.threshold, params.noConfidenceThreshold ?? 0), 0.5);
  } finally {
    await cleanup("node_threshold_floor");
  }
});

test("node group labels do not expose private group names to hosts", async () => {
  const fixture = await createFixture("node_private_labels", 2);
  try {
    await makeHost(fixture, 0);
    const publicLabel = await labelNodeGroupForAccount(prisma, fixture.groups[0].id, fixture.accounts[0].id);
    const privateLabel = await labelNodeGroupForAccount(prisma, fixture.groups[1].id, fixture.accounts[0].id);
    assert.equal(publicLabel?.label, fixture.groups[0].name);
    assert.equal(privateLabel?.label, "Private group");
    assert.equal(privateLabel?.isPrivate, true);
  } finally {
    await cleanup("node_private_labels");
  }
});

async function createBareFixture(prefix: string, accountCount: number) {
  await cleanup(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: prefix, domain: `${prefix}.localhost` },
  });
  const accounts = [];
  for (let index = 0; index < accountCount; index += 1) {
    accounts.push(await prisma.account.create({
      data: {
        id: `${prefix}_account_${index}`,
        homeNodeId: node.id,
        displayName: `User ${index}`,
        accountType: "participant",
      },
    }));
  }
  return { node, accounts };
}

async function createFixture(prefix: string, groupCount: number) {
  const bare = await createBareFixture(prefix, groupCount);
  const otherNode = await prisma.node.create({
    data: { id: `${prefix}_other_node`, name: `${prefix} other`, domain: `${prefix}-other.localhost` },
  });
  const groups = [];
  const memberships = [];
  for (let index = 0; index < groupCount; index += 1) {
    groups.push(await prisma.group.create({
      data: {
        id: `${prefix}_group_${index}`,
        nodeId: bare.node.id,
        name: `Group ${index}`,
        membershipPolicy: "open",
        visibility: index === 0 ? "public" : "private",
      },
    }));
    memberships.push(await prisma.groupMembership.create({
      data: {
        id: `${prefix}_membership_${index}`,
        accountId: bare.accounts[index].id,
        groupId: groups[index].id,
        status: "active",
        participationStatus: "active",
      },
    }));
  }
  return { ...bare, otherNode, groups, memberships };
}

async function makeHost(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  accountIndex: number,
) {
  return prisma.nodeHost.create({
    data: { nodeId: fixture.node.id, accountId: fixture.accounts[accountIndex].id },
  });
}

async function approveGroupPetition(petitionId: string, membershipId: string) {
  const membership = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membershipId }, select: { accountId: true } });
  assert.equal((await addPetitionSupport(prisma, { petitionId, actorAccountId: membership.accountId, membershipId })).ok, true);
  await prisma.petition.update({
    where: { id: petitionId },
    data: { closesAt: new Date(Date.now() - 1000) },
  });
  await evaluateAndApplyPetition(prisma, petitionId);
}

async function approveNodePetition(petitionId: string, accountIds: string[]) {
  for (const accountId of accountIds) {
    assert.equal((await addNodePetitionSupport(prisma, { petitionId, accountId })).ok, true);
  }
  await prisma.petition.update({
    where: { id: petitionId },
    data: { closesAt: new Date(Date.now() - 1000) },
  });
  await evaluateAndApplyPetition(prisma, petitionId);
}

async function cleanup(prefix: string) {
  await prisma.node.updateMany({
    where: { id: { startsWith: prefix } },
    data: { stewardGroupId: null },
  });
  await prisma.nodePetitionSupport.deleteMany({
    where: { nodeId: { startsWith: prefix } },
  });
  await prisma.petitionSupport.deleteMany({
    where: { petition: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] } },
  });
  await prisma.nodeStewardProposal.deleteMany({
    where: { nodeId: { startsWith: prefix } },
  });
  await prisma.petition.deleteMany({
    where: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] },
  });
  await prisma.nodeGovernanceSignal.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.nodeHost.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
