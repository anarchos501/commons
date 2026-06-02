import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { grantAbility, revokeAbility, hasAbility, getAbilities } from "../lib/responsibility-abilities";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- grantAbility ---

test("grantAbility creates a responsibility ability record", async () => {
  const { responsibility } = await createFixture("ga_create");
  try {
    await grantAbility(prisma, responsibility.id, "create_bulletins");
    assert.equal(await hasAbility(prisma, responsibility.id, "create_bulletins"), true);
  } finally {
    await cleanupFixture("ga_create");
  }
});

test("grantAbility is idempotent when called twice with the same availability", async () => {
  const { responsibility } = await createFixture("ga_idem");
  try {
    await grantAbility(prisma, responsibility.id, "create_projects");
    await assert.doesNotReject(() => grantAbility(prisma, responsibility.id, "create_projects"));
    // Still exactly one record
    const abilities = await getAbilities(prisma, responsibility.id);
    assert.equal(abilities.length, 1);
  } finally {
    await cleanupFixture("ga_idem");
  }
});

test("grantAbility updates availability when called again with a different value", async () => {
  const { responsibility } = await createFixture("ga_update_avail");
  try {
    await grantAbility(prisma, responsibility.id, "issue_support_requests", "always_available");
    await grantAbility(prisma, responsibility.id, "issue_support_requests", "available_during_emergency");
    const abilities = await getAbilities(prisma, responsibility.id);
    assert.equal(abilities.length, 1);
    assert.equal(abilities[0].availability, "available_during_emergency");
  } finally {
    await cleanupFixture("ga_update_avail");
  }
});

test("grantAbility defaults to always_available", async () => {
  const { responsibility } = await createFixture("ga_avail");
  try {
    await grantAbility(prisma, responsibility.id, "issue_support_requests");
    const abilities = await getAbilities(prisma, responsibility.id);
    assert.equal(abilities[0].availability, "always_available");
  } finally {
    await cleanupFixture("ga_avail");
  }
});

test("grantAbility records available_during_emergency when specified", async () => {
  const { responsibility } = await createFixture("ga_emergency");
  try {
    await grantAbility(prisma, responsibility.id, "issue_support_requests", "available_during_emergency");
    const abilities = await getAbilities(prisma, responsibility.id);
    assert.equal(abilities[0].availability, "available_during_emergency");
  } finally {
    await cleanupFixture("ga_emergency");
  }
});

// --- hasAbility ---

test("hasAbility returns false when ability not granted", async () => {
  const { responsibility } = await createFixture("ha_false");
  try {
    assert.equal(await hasAbility(prisma, responsibility.id, "create_projects"), false);
  } finally {
    await cleanupFixture("ha_false");
  }
});

test("hasAbility returns true after grant", async () => {
  const { responsibility } = await createFixture("ha_true");
  try {
    await grantAbility(prisma, responsibility.id, "approve_membership");
    assert.equal(await hasAbility(prisma, responsibility.id, "approve_membership"), true);
  } finally {
    await cleanupFixture("ha_true");
  }
});

// --- revokeAbility ---

test("revokeAbility removes the record; hasAbility returns false", async () => {
  const { responsibility } = await createFixture("ra_remove");
  try {
    await grantAbility(prisma, responsibility.id, "create_bulletins");
    await revokeAbility(prisma, responsibility.id, "create_bulletins");
    assert.equal(await hasAbility(prisma, responsibility.id, "create_bulletins"), false);
  } finally {
    await cleanupFixture("ra_remove");
  }
});

test("revokeAbility on non-existent ability is a no-op", async () => {
  const { responsibility } = await createFixture("ra_noop");
  try {
    await assert.doesNotReject(() => revokeAbility(prisma, responsibility.id, "create_publications"));
  } finally {
    await cleanupFixture("ra_noop");
  }
});

// --- getAbilities ---

test("getAbilities lists all granted abilities in order", async () => {
  const { responsibility } = await createFixture("ga_list");
  try {
    await grantAbility(prisma, responsibility.id, "create_projects");
    await grantAbility(prisma, responsibility.id, "create_bulletins");
    await grantAbility(prisma, responsibility.id, "issue_support_requests");
    const abilities = await getAbilities(prisma, responsibility.id);
    assert.equal(abilities.length, 3);
    // Ordered by ability name (alphabetical)
    const names = abilities.map((a) => a.ability);
    assert.deepEqual(names, [...names].sort());
  } finally {
    await cleanupFixture("ga_list");
  }
});

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });

  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });

  const responsibility = await prisma.responsibility.create({
    data: { id: `${prefix}_responsibility`, groupId: group.id, type: "reviewer" },
  });

  return { node, group, responsibility };
}

async function cleanupFixture(prefix: string) {
  await prisma.responsibilityAbility.deleteMany({
    where: { responsibilityId: { startsWith: prefix } },
  });
  await prisma.responsibility.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
