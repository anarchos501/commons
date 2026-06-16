import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createGroupFixture, cleanupEventFixture } from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-07-01T18:00:00Z");
const end = new Date("2026-07-01T19:00:00Z");

test("CalendarEvent: endTime > startTime CHECK rejects inverted times", async () => {
  const prefix = "evtschema_check";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    await assert.rejects(
      prisma.calendarEvent.create({
        data: {
          category: "workshop",
          hostType: "account",
          hostId: accountId,
          title: "Bad times",
          startTime: end, // start after end
          endTime: start,
          timezone: "UTC",
          createdByAccountId: accountId,
          visibility: "host_only",
        },
      }),
    );
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("EventInterest: @@unique([eventId, accountId]) rejects a duplicate response row", async () => {
  const prefix = "evtschema_uniq";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    const event = await prisma.calendarEvent.create({
      data: {
        category: "workshop",
        hostType: "account",
        hostId: accountId,
        title: "Solo",
        startTime: start,
        endTime: end,
        timezone: "UTC",
        createdByAccountId: accountId,
        visibility: "host_only",
      },
    });
    await prisma.eventInterest.create({ data: { eventId: event.id, accountId, level: "interested" } });
    await assert.rejects(
      prisma.eventInterest.create({ data: { eventId: event.id, accountId, level: "planning_to_attend" } }),
    );
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("EventAudience cascade: deleting an event removes its audiences and interests", async () => {
  const prefix = "evtschema_cascade";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const event = await prisma.calendarEvent.create({
      data: {
        category: "workshop",
        hostType: "group",
        hostId: groupId,
        title: "Cascade",
        startTime: start,
        endTime: end,
        timezone: "UTC",
        createdByAccountId: accountId,
        visibility: "host_only",
        audiences: { create: [{ audienceType: "group", audienceId: `${prefix}_other` }] },
        interests: { create: [{ accountId, level: "interested" }] },
      },
    });
    await prisma.calendarEvent.delete({ where: { id: event.id } });
    assert.equal(await prisma.eventAudience.count({ where: { eventId: event.id } }), 0);
    assert.equal(await prisma.eventInterest.count({ where: { eventId: event.id } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
