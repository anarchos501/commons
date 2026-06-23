import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { proposeCustomRequestsToggle, proposeMembershipPolicyChange } from "../lib/group-settings";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// Regression: these settings must be REVERSIBLE. A target-independent non-null competitionKey
// would make resolveCompetingPetitions treat the first approved petition as a permanent winner
// and auto-reject every later opposite-direction petition without counting votes. Both families
// must therefore be non-competing (null key); the partial unique index still bounds concurrency.

test("custom-requests toggle can be approved, then reversed by a second approved petition", async () => {
  await cleanupFixture("gsp_custom");
  try {
    const { group, memberships } = await createFixture("gsp_custom", 3);

    // 1. Propose + approve turning custom requests ON.
    const on = await proposeCustomRequestsToggle(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id, accepts: true });
    assert.equal(on.ok, true);
    if (!on.ok) return;
    await approve(on.petitionId, memberships);
    assert.equal((await groupRow(group.id)).acceptsCustomRequests, true, "custom requests turned on");

    // 2. Propose + approve turning it back OFF — must NOT be auto-rejected by a stale winner.
    const off = await proposeCustomRequestsToggle(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id, accepts: false });
    assert.equal(off.ok, true, "opposite-direction petition opens (no-op guard passes)");
    if (!off.ok) return;
    const result = await approve(off.petitionId, memberships);
    assert.equal(result.outcome, "approved", "reversal petition is approved on its own votes, not auto-rejected");
    assert.equal((await groupRow(group.id)).acceptsCustomRequests, false, "custom requests turned back off");
  } finally {
    await cleanupFixture("gsp_custom");
  }
});

test("membership policy can be flipped open -> request_required -> open via successive petitions", async () => {
  await cleanupFixture("gsp_policy");
  try {
    // Fixture starts as "open".
    const { group, memberships } = await createFixture("gsp_policy", 3, "open");

    const toReq = await proposeMembershipPolicyChange(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id, target: "request_required" });
    assert.equal(toReq.ok, true);
    if (!toReq.ok) return;
    await approve(toReq.petitionId, memberships);
    assert.equal((await groupRow(group.id)).membershipPolicy, "request_required");

    const backToOpen = await proposeMembershipPolicyChange(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id, target: "open" });
    assert.equal(backToOpen.ok, true);
    if (!backToOpen.ok) return;
    const result = await approve(backToOpen.petitionId, memberships);
    assert.equal(result.outcome, "approved", "reversal is approved on its own votes");
    assert.equal((await groupRow(group.id)).membershipPolicy, "open");
  } finally {
    await cleanupFixture("gsp_policy");
  }
});

test("proposing the value a group already has is a no-op (already_set)", async () => {
  await cleanupFixture("gsp_noop");
  try {
    const { group, memberships } = await createFixture("gsp_noop", 3);
    const r = await proposeCustomRequestsToggle(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id, accepts: false });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "already_set");
  } finally {
    await cleanupFixture("gsp_noop");
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupRow(id: string) {
  return prisma.group.findUniqueOrThrow({ where: { id }, select: { acceptsCustomRequests: true, membershipPolicy: true } });
}

// Drive a petition to approval: 2 of 3 members support (default 50% threshold), backdate, evaluate.
async function approve(petitionId: string, memberships: Array<{ id: string; accountId: string }>) {
  await addPetitionSupport(prisma, { petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
  await addPetitionSupport(prisma, { petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
  await prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  return evaluateAndApplyPetition(prisma, petitionId);
}

async function createFixture(prefix: string, memberCount: number, membershipPolicy: "open" | "request_required" = "request_required") {
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.gsp.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy, visibility: "public", acceptsCustomRequests: false },
  });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({
      data: { id: `${prefix}_acct${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" },
    });
    const membership = await prisma.groupMembership.create({
      data: { id: `${prefix}_mem${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    });
    memberships.push({ id: membership.id, accountId: account.id });
  }
  return { node, group, memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { group: { nodeId: { startsWith: prefix } } } } });
  await prisma.petition.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
