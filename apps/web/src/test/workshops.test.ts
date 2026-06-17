import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createWorkshop, submitEvent } from "../lib/events";
import { createGroupFixture, cleanupEventFixture } from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-08-01T17:00:00Z");
const end = new Date("2026-08-01T18:30:00Z");

function baseInput(accountId: string, groupId: string) {
  return {
    accountId,
    category: "workshop" as const,
    hostType: "group" as const,
    hostId: groupId,
    title: "Skill share",
    startTime: start,
    endTime: end,
    timezone: "America/New_York",
    visibility: "host_only" as const,
  };
}

test("internal workshop is created directly with NO petition", async () => {
  const prefix = "ws_internal";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await createWorkshop(prisma, baseInput(accountId, groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const event = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: result.eventId } });
    assert.equal(event.category, "workshop");
    assert.equal(event.authorizingPetitionId, null);
    // Scope to this fixture's group: an unscoped global count picks up unrelated seed/other-test
    // data and is not what this test means — it asserts THIS workshop opened no authorization petition.
    assert.equal(await prisma.petition.count({ where: { subjectType: "event_authorization", groupId } }), 0);
    assert.equal(await prisma.eventProposal.count({ where: { hostId: groupId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("submitEvent routes an internal workshop to direct create", async () => {
  const prefix = "ws_submit";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await submitEvent(prisma, baseInput(accountId, groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "created");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("non-member host throws (authorization failure)", async () => {
  const prefix = "ws_nonmember";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { groupId } = await createGroupFixture(prisma, prefix);
    await assert.rejects(
      createWorkshop(prisma, baseInput(`${prefix}_stranger`, groupId)),
      /Active group membership required/,
    );
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("personal workshop requires hostId === accountId", async () => {
  const prefix = "ws_personal";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    // own account: ok
    const ok = await createWorkshop(prisma, {
      ...baseInput(accountId, accountId),
      hostType: "account",
      hostId: accountId,
    });
    assert.equal(ok.ok, true);
    // someone else's account: rejected
    await assert.rejects(
      createWorkshop(prisma, { ...baseInput(accountId, accountId), hostType: "account", hostId: `${prefix}_other_acct` }),
      /personal events for your own account/,
    );
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("cross-space workshop via createWorkshop is rejected with requires_authorization", async () => {
  const prefix = "ws_cross";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await createWorkshop(prisma, {
      ...baseInput(accountId, groupId),
      audiences: [{ audienceType: "coalition", audienceId: `${prefix}_some_coalition` }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "requires_authorization");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("invalid time range is rejected before any write", async () => {
  const prefix = "ws_badtime";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await createWorkshop(prisma, { ...baseInput(accountId, groupId), endTime: start, startTime: end });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_time_range");
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
