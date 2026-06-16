import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { getCalendarFilterPreferences, setCalendarFilterPreferences } from "../lib/events";
import { cleanupEventFixture, createGroupFixture } from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("defaults are all-on when no preference row exists", async () => {
  const prefix = "pref_default";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    const prefs = await getCalendarFilterPreferences(prisma, accountId);
    assert.equal(prefs.showGroupEvents, true);
    assert.equal(prefs.showCoalitionEvents, true);
    assert.equal(prefs.showPersonalEvents, true);
    assert.equal(prefs.spaceFilters, null);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("preferences upsert and round-trip", async () => {
  const prefix = "pref_roundtrip";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    await setCalendarFilterPreferences(prisma, accountId, {
      showCoalitionEvents: false,
      spaceFilters: { group: [groupId] },
    });
    let prefs = await getCalendarFilterPreferences(prisma, accountId);
    assert.equal(prefs.showCoalitionEvents, false);
    assert.equal(prefs.showGroupEvents, true);
    assert.deepEqual(prefs.spaceFilters, { group: [groupId] });

    // update again — upsert path
    await setCalendarFilterPreferences(prisma, accountId, { showCoalitionEvents: true });
    prefs = await getCalendarFilterPreferences(prisma, accountId);
    assert.equal(prefs.showCoalitionEvents, true);
    assert.deepEqual(prefs.spaceFilters, { group: [groupId] }); // unchanged
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("invalid spaceFilters are sanitized away", async () => {
  const prefix = "pref_sanitize";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    await setCalendarFilterPreferences(prisma, accountId, {
      spaceFilters: { group: ["g1", 42, null], bogusKey: ["x"], project: "not-an-array" },
    });
    const prefs = await getCalendarFilterPreferences(prisma, accountId);
    assert.deepEqual(prefs.spaceFilters, { group: ["g1"] }); // 42/null dropped, bogusKey + bad project ignored
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
