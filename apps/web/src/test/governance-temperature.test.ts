import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  upsertGovernanceSignal,
  clearGovernanceSignal,
  computeAllParameterTemperatures,
  computeGroupTemperature,
  SIGNAL_CHANGE_COOLDOWN_HOURS,
} from "../lib/governance-temperature";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ---- fixtures ----

async function createFixture(prefix: string, memberCount = 1) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.gtemp.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });

  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({ data: { id: `${prefix}_account_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const membership = await prisma.groupMembership.create({ data: { id: `${prefix}_membership_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(membership);
  }
  return { node, group, memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

// ---- signal tests ----

test("upsertGovernanceSignal rejects invalid category", async () => {
  const { group, memberships } = await createFixture("gt_invalid_cat");
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "not_a_category", signal: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_category");
  } finally {
    await cleanupFixture("gt_invalid_cat");
  }
});

test("upsertGovernanceSignal rejects invalid signal values", async () => {
  const { group, memberships } = await createFixture("gt_invalid_sig");
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 2 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_signal");
  } finally {
    await cleanupFixture("gt_invalid_sig");
  }
});

test("upsertGovernanceSignal rejects invalid parameter names", async () => {
  const { group, memberships } = await createFixture("gt_invalid_param");
  try {
    const result = await upsertGovernanceSignal(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      category: "membership",
      parameter: "notAParameter",
      signal: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_parameter");
  } finally {
    await cleanupFixture("gt_invalid_param");
  }
});

test("upsertGovernanceSignal rejects mismatched membershipId/groupId", async () => {
  const { memberships } = await createFixture("gt_mismatch");
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: "wrong_group", category: "membership", signal: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "membership_group_mismatch");
  } finally {
    await cleanupFixture("gt_mismatch");
  }
});

test("upsertGovernanceSignal creates signal record", async () => {
  const { group, memberships } = await createFixture("gt_create");
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    assert.equal(result.ok, true);
    const record = await prisma.memberGovernanceSignal.findUnique({ where: { membershipId_category_parameter: { membershipId: memberships[0].id, category: "membership", parameter: "_" } } });
    assert.ok(record);
    assert.equal(record?.signal, 1);
  } finally {
    await cleanupFixture("gt_create");
  }
});

test("upsertGovernanceSignal is idempotent for same signal (no cooldown)", async () => {
  const { group, memberships } = await createFixture("gt_idem");
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    assert.equal(result.ok, true);
  } finally {
    await cleanupFixture("gt_idem");
  }
});

test("upsertGovernanceSignal enforces cooldown on changes", async () => {
  const { group, memberships } = await createFixture("gt_cooldown");
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: -1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "cooldown");
  } finally {
    await cleanupFixture("gt_cooldown");
  }
});

test("cooldown is per-category (different category not blocked)", async () => {
  const { group, memberships } = await createFixture("gt_cat_cooldown");
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    // Different category should NOT be blocked
    const result = await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "emergency", signal: -1 });
    assert.equal(result.ok, true);
  } finally {
    await cleanupFixture("gt_cat_cooldown");
  }
});

test("cooldown is per-parameter within a category", async () => {
  const { group, memberships } = await createFixture("gt_param_cooldown");
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    const result = await upsertGovernanceSignal(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      category: "membership",
      parameter: "threshold",
      signal: -1,
    });
    assert.equal(result.ok, true);
  } finally {
    await cleanupFixture("gt_param_cooldown");
  }
});

test("clearGovernanceSignal sets signal to 0", async () => {
  const { group, memberships } = await createFixture("gt_clear");
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    // Backdate updatedAt so cooldown has passed
    await prisma.memberGovernanceSignal.updateMany({
      where: { membershipId: memberships[0].id, category: "membership" },
      data: { updatedAt: new Date(Date.now() - (SIGNAL_CHANGE_COOLDOWN_HOURS + 1) * 60 * 60 * 1000) },
    });
    await clearGovernanceSignal(prisma, { membershipId: memberships[0].id, category: "membership" });
    const record = await prisma.memberGovernanceSignal.findUnique({ where: { membershipId_category_parameter: { membershipId: memberships[0].id, category: "membership", parameter: "_" } } });
    assert.equal(record?.signal, 0);
  } finally {
    await cleanupFixture("gt_clear");
  }
});

// ---- temperature computation tests ----

test("computeGroupTemperature returns 0 when no signals", async () => {
  const { group } = await createFixture("gt_no_sigs", 5);
  try {
    const temp = await computeGroupTemperature(prisma, group.id, "membership");
    assert.equal(temp, 0);
  } finally {
    await cleanupFixture("gt_no_sigs");
  }
});

test("computeGroupTemperature: 1 active signal of +1 from 100 members ≈ +0.010", async () => {
  const { group, memberships } = await createFixture("gt_100", 100);
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    const temp = await computeGroupTemperature(prisma, group.id, "membership");
    // weightedSum=1.0, maxWeight=100.0, result=0.010
    assert.ok(Math.abs(temp - 0.01) < 0.001, `Expected ~0.010, got ${temp}`);
  } finally {
    await cleanupFixture("gt_100");
  }
});

test("computeGroupTemperature: quiet member weight is 0.5", async () => {
  const { group, memberships } = await createFixture("gt_quiet", 2);
  try {
    // Make second member quiet
    await prisma.groupMembership.update({ where: { id: memberships[1].id }, data: { participationStatus: "quiet" } });
    // Both signal +1
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    await upsertGovernanceSignal(prisma, { membershipId: memberships[1].id, groupId: group.id, category: "membership", signal: 1 });
    const temp = await computeGroupTemperature(prisma, group.id, "membership");
    // weightedSum = 1.0 + 0.5 = 1.5, maxWeight = 1.0 + 0.5 = 1.5, result = 1.0
    assert.ok(Math.abs(temp - 1.0) < 0.001, `Expected 1.000, got ${temp}`);
  } finally {
    await cleanupFixture("gt_quiet");
  }
});

test("computeGroupTemperature: dormant members excluded", async () => {
  const { group, memberships } = await createFixture("gt_dormant", 2);
  try {
    // Make second member dormant
    await prisma.groupMembership.update({ where: { id: memberships[1].id }, data: { participationStatus: "dormant" } });
    // Dormant member signals +1 — should be excluded from both numerator and denominator
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    await upsertGovernanceSignal(prisma, { membershipId: memberships[1].id, groupId: group.id, category: "membership", signal: 1 });
    const temp = await computeGroupTemperature(prisma, group.id, "membership");
    // Only active member: weightedSum=1.0, maxWeight=1.0, result=1.0
    assert.ok(Math.abs(temp - 1.0) < 0.001, `Expected 1.000, got ${temp}`);
  } finally {
    await cleanupFixture("gt_dormant");
  }
});

test("computeGroupTemperature: all +1 → temperature = +1.000", async () => {
  const { group, memberships } = await createFixture("gt_all_pos", 3);
  try {
    for (const m of memberships) {
      await upsertGovernanceSignal(prisma, { membershipId: m.id, groupId: group.id, category: "membership", signal: 1 });
    }
    const temp = await computeGroupTemperature(prisma, group.id, "membership");
    assert.ok(Math.abs(temp - 1.0) < 0.001, `Expected 1.000, got ${temp}`);
  } finally {
    await cleanupFixture("gt_all_pos");
  }
});

test("computeGroupTemperature uses category signal as parameter fallback", async () => {
  const { group, memberships } = await createFixture("gt_param_fallback", 2);
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    await upsertGovernanceSignal(prisma, { membershipId: memberships[1].id, groupId: group.id, category: "membership", signal: 1 });
    const temp = await computeGroupTemperature(prisma, group.id, "membership", "threshold");
    assert.equal(temp, 1);
  } finally {
    await cleanupFixture("gt_param_fallback");
  }
});

test("computeGroupTemperature lets parameter signal override category signal", async () => {
  const { group, memberships } = await createFixture("gt_param_override", 1);
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    await upsertGovernanceSignal(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      category: "membership",
      parameter: "threshold",
      signal: -1,
    });
    assert.equal(await computeGroupTemperature(prisma, group.id, "membership"), 1);
    assert.equal(await computeGroupTemperature(prisma, group.id, "membership", "threshold"), -1);
  } finally {
    await cleanupFixture("gt_param_override");
  }
});

test("computeAllParameterTemperatures returns category and parameter temperatures", async () => {
  const { group, memberships } = await createFixture("gt_all_param_temps", 1);
  try {
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    await upsertGovernanceSignal(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      category: "membership",
      parameter: "petitionDuration",
      signal: -1,
    });
    const temperatures = await computeAllParameterTemperatures(prisma, group.id, "membership");
    assert.equal(temperatures.get("_"), 1);
    assert.equal(temperatures.get("threshold"), 1);
    assert.equal(temperatures.get("petitionDuration"), -1);
  } finally {
    await cleanupFixture("gt_all_param_temps");
  }
});

test("resolver returns temperature-interpolated threshold after signal set", async () => {
  const { group, memberships } = await createFixture("gt_resolver", 1);
  try {
    // All members signal +1 means temperature = 1.0 and threshold resolves to the permissive anchor.
    await upsertGovernanceSignal(prisma, { membershipId: memberships[0].id, groupId: group.id, category: "membership", signal: 1 });
    const { resolveGovernanceParams } = await import("../lib/governance-resolver");
    const params = await resolveGovernanceParams(prisma, group.id, "membership");
    assert.ok(Math.abs(params.threshold - 0.05) < 0.001, `Expected 0.05, got ${params.threshold}`);
  } finally {
    await cleanupFixture("gt_resolver");
  }
});
