import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { openNodeNameProposal, evaluateNodeNameProposalForPetition } from "../lib/node-name";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

async function fixture(prefix: string) {
  await cleanup(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: "Old Name", domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: "Founder Group", membershipPolicy: "open", visibility: "public" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: "Member", accountType: "member", profileVisibility: "private" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  return { node, group, account, membership };
}

async function cleanup(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { OR: [{ groupId: { startsWith: prefix } }, { scopeId: { startsWith: prefix } }] } } });
  await prisma.petition.deleteMany({ where: { OR: [{ groupId: { startsWith: prefix } }, { scopeId: { startsWith: prefix } }] } });
  await prisma.nodeNameProposal.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

test("node name proposal: group approval escalates to a node vote; node approval renames the node (P3.3)", async () => {
  const prefix = "nn_ok";
  try {
    const { node, group, membership } = await fixture(prefix);

    const opened = await openNodeNameProposal(prisma, {
      nodeId: node.id,
      initiatingGroupId: group.id,
      proposedName: "New Commons Name",
      createdByMembershipId: membership.id,
    });
    assert.ok(opened.ok);
    if (!opened.ok) return;

    // Stage 1: the group petition is approved → escalates to a node-wide vote.
    await prisma.petition.update({ where: { id: opened.petitionId }, data: { status: "approved" } });
    const r1 = await evaluateNodeNameProposalForPetition(prisma, opened.petitionId);
    assert.equal(r1?.outcome, "pending");
    const mid = await prisma.nodeNameProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(mid.status, "awaiting_node_vote");
    assert.ok(mid.nodePetitionId);
    // Not renamed yet.
    assert.equal((await prisma.node.findUniqueOrThrow({ where: { id: node.id } })).name, "Old Name");

    // Stage 2: the node vote is approved → the node is renamed.
    await prisma.petition.update({ where: { id: mid.nodePetitionId! }, data: { status: "approved" } });
    const r2 = await evaluateNodeNameProposalForPetition(prisma, mid.nodePetitionId!);
    assert.equal(r2?.outcome, "succeeded");
    assert.equal((await prisma.node.findUniqueOrThrow({ where: { id: node.id } })).name, "New Commons Name");
  } finally {
    await cleanup(prefix);
  }
});

test("node name proposal: a rejected group petition fails the proposal and does not rename (P3.3)", async () => {
  const prefix = "nn_reject";
  try {
    const { node, group, membership } = await fixture(prefix);
    const opened = await openNodeNameProposal(prisma, {
      nodeId: node.id, initiatingGroupId: group.id, proposedName: "Nope", createdByMembershipId: membership.id,
    });
    assert.ok(opened.ok);
    if (!opened.ok) return;

    await prisma.petition.update({ where: { id: opened.petitionId }, data: { status: "rejected" } });
    const r = await evaluateNodeNameProposalForPetition(prisma, opened.petitionId);
    assert.equal(r?.outcome, "failed-rejected");
    assert.equal((await prisma.node.findUniqueOrThrow({ where: { id: node.id } })).name, "Old Name");
    const proposal = await prisma.nodeNameProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.status, "failed-rejected");
    assert.equal(proposal.nodePetitionId, null);
  } finally {
    await cleanup(prefix);
  }
});

test("openNodeNameProposal rejects an empty name and a non-member proposer (P3.3)", async () => {
  const prefix = "nn_guard";
  try {
    const { node, group, membership } = await fixture(prefix);
    const blank = await openNodeNameProposal(prisma, { nodeId: node.id, initiatingGroupId: group.id, proposedName: "   ", createdByMembershipId: membership.id });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.reason, "invalid_name");

    const bogus = await openNodeNameProposal(prisma, { nodeId: node.id, initiatingGroupId: group.id, proposedName: "X", createdByMembershipId: "not-a-membership" });
    assert.equal(bogus.ok, false);
    if (!bogus.ok) assert.equal(bogus.reason, "not_eligible");
  } finally {
    await cleanup(prefix);
  }
});
