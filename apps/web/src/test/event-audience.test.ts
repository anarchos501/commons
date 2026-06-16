import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { proposeEvent, submitEvent } from "../lib/events";
import {
  cleanupEventFixture,
  createCoalitionFixture,
  createGroupFixture,
  createProjectFixture,
  createResponsibilityFixture,
} from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-10-05T15:00:00Z");
const end = new Date("2026-10-05T16:00:00Z");

function workshop(
  accountId: string,
  hostType: "group" | "project" | "responsibility" | "coalition",
  hostId: string,
  audiences: { audienceType: "group" | "project" | "responsibility" | "coalition"; audienceId: string }[],
) {
  return {
    accountId,
    category: "workshop" as const,
    hostType,
    hostId,
    title: "Cross-space workshop",
    startTime: start,
    endTime: end,
    timezone: "UTC",
    visibility: "audience" as const,
    audiences,
  };
}

test("group → hosted project is a legitimate audience", async () => {
  const prefix = "aud_g2p_ok";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, projectId } = await createProjectFixture(prisma, prefix);
    const result = await proposeEvent(prisma, workshop(accountId, "group", groupId, [{ audienceType: "project", audienceId: projectId }]));
    assert.equal(result.ok, true);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("group → unrelated project is rejected (audience_not_connected)", async () => {
  const prefix = "aud_g2p_bad";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, workshop(accountId, "group", groupId, [{ audienceType: "project", audienceId: `${prefix}_unrelated` }]));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "audience_not_connected");
    // No proposal / petition created on a connectivity failure
    assert.equal(await prisma.eventProposal.count({ where: { hostId: groupId } }), 0);
    assert.equal(await prisma.petition.count({ where: { groupId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("project → host group is a legitimate audience", async () => {
  const prefix = "aud_p2g_ok";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, projectId } = await createProjectFixture(prisma, prefix);
    const result = await proposeEvent(prisma, workshop(accountId, "project", projectId, [{ audienceType: "group", audienceId: groupId }]));
    assert.equal(result.ok, true);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("responsibility → owning group is a legitimate audience", async () => {
  const prefix = "aud_r2g_ok";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, responsibilityId } = await createResponsibilityFixture(prisma, prefix);
    const result = await proposeEvent(prisma, workshop(accountId, "responsibility", responsibilityId, [{ audienceType: "group", audienceId: groupId }]));
    assert.equal(result.ok, true);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("coalition → participant group ok; → non-participant rejected", async () => {
  const prefix = "aud_coal";
  await cleanupEventFixture(prisma, prefix);
  try {
    const coalition = await createCoalitionFixture(prisma, prefix, 2);
    const proposer = coalition.groups[0];
    const target = coalition.groups[1];

    const ok = await proposeEvent(prisma, workshop(proposer.accountId, "coalition", coalition.coalitionId, [{ audienceType: "group", audienceId: target.groupId }]));
    assert.equal(ok.ok, true);

    const bad = await proposeEvent(prisma, workshop(proposer.accountId, "coalition", coalition.coalitionId, [{ audienceType: "group", audienceId: `${prefix}_outsider` }]));
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.reason, "audience_not_connected");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("personal event with an audience is rejected", async () => {
  const prefix = "aud_personal";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await submitEvent(prisma, {
      accountId,
      category: "workshop",
      hostType: "account",
      hostId: accountId,
      title: "Personal with audience",
      startTime: start,
      endTime: end,
      timezone: "UTC",
      visibility: "host_only",
      audiences: [{ audienceType: "group", audienceId: groupId }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "audience_not_connected");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
