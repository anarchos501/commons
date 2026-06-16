import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createWorkshop, listEventsForAccount, type ResolvedCalendarFilters } from "../lib/events";
import { cleanupEventFixture, createGroupFixture, createMember } from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-12-01T13:00:00Z");
const end = new Date("2026-12-01T14:00:00Z");

const ALL_ON: ResolvedCalendarFilters = {
  showGroupEvents: true,
  showProjectEvents: true,
  showResponsibilityEvents: true,
  showCoalitionEvents: true,
  showPersonalEvents: true,
  spaceFilters: null,
};

async function workshop(accountId: string, hostType: "group" | "account", hostId: string, title: string) {
  const result = await createWorkshop(prisma, {
    accountId,
    category: "workshop",
    hostType,
    hostId,
    title,
    startTime: start,
    endTime: end,
    timezone: "UTC",
    visibility: "host_only",
  });
  if (!result.ok) throw new Error(`workshop create failed: ${result.reason}`);
  return result.eventId;
}

test("dashboard aggregates the account's group + personal events and hides non-member private groups", async () => {
  const prefix = "dash_agg";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, nodeId } = await createGroupFixture(prisma, prefix);
    const groupEventId = await workshop(accountId, "group", groupId, "My group workshop");
    const personalEventId = await workshop(accountId, "account", accountId, "Personal plan");

    // A separate private group the account is NOT a member of, with its own event.
    const outsider = await createMember(prisma, nodeId, prefix, "out");
    const otherGroup = await prisma.group.create({
      data: { id: `${prefix}_othergroup`, nodeId, name: `Other ${prefix}`, membershipPolicy: "open", visibility: "private" },
    });
    await prisma.groupMembership.create({
      data: { id: `${prefix}_othermem`, accountId: outsider.id, groupId: otherGroup.id, status: "active", participationStatus: "active" },
    });
    const hiddenEventId = await workshop(outsider.id, "group", otherGroup.id, "Hidden workshop");

    const events = await listEventsForAccount(prisma, accountId, ALL_ON);
    const ids = events.map((e) => e.id);
    assert.ok(ids.includes(groupEventId));
    assert.ok(ids.includes(personalEventId));
    assert.equal(ids.includes(hiddenEventId), false); // membership-leak guard
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("category toggle narrows the dashboard view", async () => {
  const prefix = "dash_toggle";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const groupEventId = await workshop(accountId, "group", groupId, "Group only");
    const personalEventId = await workshop(accountId, "account", accountId, "Personal only");

    const noGroups = await listEventsForAccount(prisma, accountId, { ...ALL_ON, showGroupEvents: false });
    const ids = noGroups.map((e) => e.id);
    assert.equal(ids.includes(groupEventId), false);
    assert.ok(ids.includes(personalEventId));
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("canceled events are excluded by default", async () => {
  const prefix = "dash_cancel";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const eventId = await workshop(accountId, "group", groupId, "To be canceled");
    await prisma.calendarEvent.update({ where: { id: eventId }, data: { canceledAt: new Date() } });

    const events = await listEventsForAccount(prisma, accountId, ALL_ON);
    assert.equal(events.map((e) => e.id).includes(eventId), false);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
