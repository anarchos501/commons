import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createWorkshop, getInterestCounts, setInterest } from "../lib/events";
import { cleanupEventFixture, createGroupFixture, createMember } from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-11-02T14:00:00Z");
const end = new Date("2026-11-02T15:00:00Z");

async function makeWorkshop(prefix: string, accountId: string, groupId: string, visibility: "host_only" | "public" = "host_only") {
  const result = await createWorkshop(prisma, {
    accountId,
    category: "workshop",
    hostType: "group",
    hostId: groupId,
    title: "Interest test",
    startTime: start,
    endTime: end,
    timezone: "UTC",
    visibility,
  });
  if (!result.ok) throw new Error(`workshop create failed: ${result.reason}`);
  return result.eventId;
}

test("interest counts aggregate and are identity-blind", async () => {
  const prefix = "int_counts";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, nodeId } = await createGroupFixture(prisma, prefix);
    // add a second active member of the same group
    const second = await createMember(prisma, nodeId, prefix, "1");
    await prisma.groupMembership.create({
      data: { id: `${prefix}_mem1`, accountId: second.id, groupId, status: "active", participationStatus: "active" },
    });
    const eventId = await makeWorkshop(prefix, accountId, groupId);

    assert.equal((await setInterest(prisma, { accountId, eventId, level: "planning_to_attend" })).ok, true);
    assert.equal((await setInterest(prisma, { accountId: second.id, eventId, level: "planning_to_attend" })).ok, true);

    const counts = await getInterestCounts(prisma, eventId);
    assert.deepEqual(Object.keys(counts).sort(), ["interested", "planning_to_attend"]);
    assert.equal(counts.planning_to_attend, 2);
    assert.equal(counts.interested, 0);
    // The returned shape carries only counts — no account identities.
    assert.equal(JSON.stringify(counts).includes(accountId), false);
    assert.equal(JSON.stringify(counts).includes(second.id), false);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("changing level keeps one response; withdrawing removes it", async () => {
  const prefix = "int_change";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const eventId = await makeWorkshop(prefix, accountId, groupId);

    await setInterest(prisma, { accountId, eventId, level: "interested" });
    await setInterest(prisma, { accountId, eventId, level: "planning_to_attend" });
    let counts = await getInterestCounts(prisma, eventId);
    assert.equal(counts.planning_to_attend, 1);
    assert.equal(counts.interested, 0);
    assert.equal(await prisma.eventInterest.count({ where: { eventId } }), 1);

    await setInterest(prisma, { accountId, eventId, level: null });
    counts = await getInterestCounts(prisma, eventId);
    assert.equal(counts.planning_to_attend, 0);
    assert.equal(await prisma.eventInterest.count({ where: { eventId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("interest on an unviewable (host_only, non-member) event is rejected", async () => {
  const prefix = "int_unview";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, nodeId } = await createGroupFixture(prisma, prefix);
    const eventId = await makeWorkshop(prefix, accountId, groupId, "host_only");
    // an outsider account (not a member of the host group)
    const outsider = await createMember(prisma, nodeId, prefix, "out");
    const result = await setInterest(prisma, { accountId: outsider.id, eventId, level: "interested" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not_visible");
    assert.equal(await prisma.eventInterest.count({ where: { eventId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
