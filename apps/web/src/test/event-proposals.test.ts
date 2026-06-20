import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { proposeEvent, submitEvent } from "../lib/events";
import { addPetitionSupport } from "../lib/petitions";
import {
  evaluateAndApplyPetition,
  resolveExpiredPetitions,
  resolveDuePetitionsForGroup,
  getPetitionDetail,
} from "../lib/petition-evaluation";
import { GOVERNANCE_CATEGORIES } from "../lib/governance-categories";
import { categoryForFamily, isProposalFamily } from "../lib/governance-proposal-families";
import {
  approveEventProposal,
  cleanupEventFixture,
  createCoalitionFixture,
  createGroupFixture,
  createProjectFixture,
} from "./event-fixtures";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const start = new Date("2026-09-10T16:00:00Z");
const end = new Date("2026-09-10T17:00:00Z");

function meeting(accountId: string, hostType: "group" | "project" | "coalition", hostId: string) {
  return {
    accountId,
    category: "meeting" as const,
    hostType,
    hostId,
    title: "Assembly",
    startTime: start,
    endTime: end,
    timezone: "UTC",
    visibility: "host_only" as const,
  };
}

// ── Governance wiring ─────────────────────────────────────────────────────────

test("governance: coordination category exists and event_authorization maps to it", () => {
  assert.ok(GOVERNANCE_CATEGORIES.includes("coordination"));
  assert.ok(isProposalFamily("event_authorization"));
  assert.equal(categoryForFamily("event_authorization"), "coordination");
});

// ── Group-hosted meeting ──────────────────────────────────────────────────────

test("group meeting opens a petition and creates no event until all approve", async () => {
  const prefix = "ep_group";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.petitionIds.length, 1);

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[0] } });
    assert.equal(petition.category, "coordination");
    assert.equal(petition.subjectType, "event_authorization");
    assert.equal(petition.subjectId, result.proposalId);

    // No event yet
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 0);

    // Approve → event created with provenance
    const applied = await approveEventProposal(prisma, result.petitionIds);
    assert.equal(applied?.outcome, "succeeded");
    const events = await prisma.calendarEvent.findMany({ where: { hostId: groupId } });
    assert.equal(events.length, 1);
    assert.equal(events[0].category, "meeting");
    assert.equal(events[0].authorizingPetitionId, result.petitionIds[0]);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("applying an approved event proposal twice is idempotent", async () => {
  const prefix = "ep_idem";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveEventProposal(prisma, result.petitionIds);
    await approveEventProposal(prisma, result.petitionIds);

    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 1);
    const logs = await prisma.actionLog.findMany({ where: { action: "event.created", groupId } });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("a rejected petition produces no event and a failed proposal", async () => {
  const prefix = "ep_reject";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.petition.update({ where: { id: result.petitionIds[0] }, data: { status: "rejected" } });
    const { evaluateEventProposalForPetition } = await import("../lib/events");
    const outcome = await prisma.$transaction((tx) => evaluateEventProposalForPetition(tx, result.petitionIds[0]));
    assert.equal(outcome?.outcome, "failed-rejected");

    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 0);
    const proposal = await prisma.eventProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "failed-rejected");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Account host rejected ─────────────────────────────────────────────────────

test("meeting hosted by an account is rejected (meeting_requires_collective)", async () => {
  const prefix = "ep_acct";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId } = await createGroupFixture(prisma, prefix);
    const viaSubmit = await submitEvent(prisma, meeting(accountId, "group", `${prefix}_group`));
    assert.equal(viaSubmit.ok, true); // sanity: group meeting works
    const result = await submitEvent(prisma, { ...meeting(accountId, "group", accountId), hostType: "account", hostId: accountId });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "meeting_requires_collective");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Project-hosted meeting uses project voter scope ───────────────────────────

test("project meeting petition uses project voter scope", async () => {
  const prefix = "ep_proj";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, projectId } = await createProjectFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "project", projectId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[0] } });
    assert.equal(petition.scopeType, "project");
    assert.equal(petition.scopeId, projectId);
    const voterScope = petition.voterScope as { type: string; scopeId: string };
    assert.equal(voterScope.type, "project");
    assert.equal(voterScope.scopeId, projectId);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Cross-space workshop also goes through the petition flow ───────────────────

test("cross-space workshop (group hosting for its coalition) opens a petition", async () => {
  const prefix = "ep_xspace";
  await cleanupEventFixture(prisma, prefix);
  try {
    // Build a coalition with two member groups; host the workshop from group 0 for the coalition.
    const coalition = await createCoalitionFixture(prisma, prefix, 2);
    const host = coalition.groups[0];
    const result = await submitEvent(prisma, {
      accountId: host.accountId,
      category: "workshop",
      hostType: "group",
      hostId: host.groupId,
      title: "Regional skill share",
      startTime: start,
      endTime: end,
      timezone: "UTC",
      visibility: "audience",
      audiences: [{ audienceType: "coalition", audienceId: coalition.coalitionId }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "proposed");
    if (result.kind !== "proposed") return;
    // One petition (single group host), no event yet
    assert.equal(result.petitionIds.length, 1);
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: host.groupId } }), 0);

    const applied = await approveEventProposal(prisma, result.petitionIds);
    assert.equal(applied?.outcome, "succeeded");
    const events = await prisma.calendarEvent.findMany({ where: { hostId: host.groupId }, include: { audiences: true } });
    assert.equal(events.length, 1);
    assert.equal(events[0].category, "workshop");
    assert.equal(events[0].audiences.length, 1);
    assert.equal(events[0].audiences[0].audienceType, "coalition");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Coalition-hosted meeting needs ALL member groups ──────────────────────────

test("coalition meeting opens one petition per member group; event only when all approve", async () => {
  const prefix = "ep_coal";
  await cleanupEventFixture(prisma, prefix);
  try {
    const coalition = await createCoalitionFixture(prisma, prefix, 3);
    const proposer = coalition.groups[0];
    const result = await proposeEvent(prisma, meeting(proposer.accountId, "coalition", coalition.coalitionId));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.petitionIds.length, 3);
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: coalition.coalitionId } }), 0);

    // Approve only two of three → still no event, still pending
    await prisma.petition.updateMany({ where: { id: { in: result.petitionIds.slice(0, 2) } }, data: { status: "approved" } });
    const { evaluateEventProposalForPetition } = await import("../lib/events");
    const partial = await prisma.$transaction((tx) => evaluateEventProposalForPetition(tx, result.petitionIds[0]));
    assert.equal(partial?.outcome, "pending");
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: coalition.coalitionId } }), 0);

    // Approve the third → event created
    const applied = await approveEventProposal(prisma, result.petitionIds);
    assert.equal(applied?.outcome, "succeeded");
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: coalition.coalitionId } }), 1);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("coalition meeting fails if any member group rejects", async () => {
  const prefix = "ep_coal_reject";
  await cleanupEventFixture(prisma, prefix);
  try {
    const coalition = await createCoalitionFixture(prisma, prefix, 3);
    const proposer = coalition.groups[0];
    const result = await proposeEvent(prisma, meeting(proposer.accountId, "coalition", coalition.coalitionId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.petition.updateMany({ where: { id: { in: result.petitionIds.slice(0, 2) } }, data: { status: "approved" } });
    await prisma.petition.update({ where: { id: result.petitionIds[2] }, data: { status: "rejected" } });
    const { evaluateEventProposalForPetition } = await import("../lib/events");
    const outcome = await prisma.$transaction((tx) => evaluateEventProposalForPetition(tx, result.petitionIds[0]));
    assert.equal(outcome?.outcome, "failed-rejected");
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: coalition.coalitionId } }), 0);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Regression: event petitions must apply through the generic resolution path ──
// These guard the petition-resolution-fix integration: evaluateAndApplyPetition was
// rewritten to run in one transaction, and the event-proposal handler must still be
// dispatched from it (and run on that transaction without opening its own). Unlike the
// tests above — which call evaluateEventProposalForPetition directly — these route a real
// petition through evaluateAndApplyPetition / resolveExpiredPetitions, so they fail if the
// events dispatch is dropped (no event created) or nests a transaction (the call throws).

test("event petition resolved via evaluateAndApplyPetition creates the CalendarEvent", async () => {
  const prefix = "ep_eval_apply";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, membershipId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 0);

    // Drive a real approval: the sole member supports, the petition is past its close time.
    await addPetitionSupport(prisma, { petitionId: result.petitionIds[0], actorAccountId: accountId, membershipId });
    await prisma.petition.update({
      where: { id: result.petitionIds[0] },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    // Route through the generic resolver (NOT evaluateEventProposalForPetition directly).
    await evaluateAndApplyPetition(prisma, result.petitionIds[0]);

    const events = await prisma.calendarEvent.findMany({ where: { hostId: groupId } });
    assert.equal(events.length, 1);
    assert.equal(events[0].authorizingPetitionId, result.petitionIds[0]);
    const proposal = await prisma.eventProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "succeeded");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

test("expired event petition is resolved into a CalendarEvent by the background sweep", async () => {
  const prefix = "ep_sweep";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, membershipId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await addPetitionSupport(prisma, { petitionId: result.petitionIds[0], actorAccountId: accountId, membershipId });
    await prisma.petition.update({
      where: { id: result.petitionIds[0] },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    // The sweep (what instrumentation.ts runs on a timer) must resolve it with no page visit.
    const sweep = await resolveExpiredPetitions(prisma);
    assert.ok(sweep.resolved >= 1);
    // Note: sweep.failed is global and may be non-zero on a shared/seeded DB (an unrelated stuck
    // petition). The scoped CalendarEvent count below proves OUR petition resolved successfully.

    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 1);
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Feedback bug 2: petitions resolve on page load (no "Check outcome" button) ──

test("resolveDuePetitionsForGroup resolves an expired group event petition on load", async () => {
  const prefix = "ep_due_group";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId, membershipId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, meeting(accountId, "group", groupId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await addPetitionSupport(prisma, { petitionId: result.petitionIds[0], actorAccountId: accountId, membershipId });
    await prisma.petition.update({
      where: { id: result.petitionIds[0] },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    // What the group page now runs in its maintenance pass instead of a button press.
    await resolveDuePetitionsForGroup(prisma, groupId);

    assert.equal(await prisma.calendarEvent.count({ where: { hostId: groupId } }), 1);
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[0] } });
    assert.equal(petition.status, "approved");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});

// ── Feedback bug 1: event petition card surfaces date/time and location ─────────

test("event petition detail includes a When (date/time) and Location field", async () => {
  const prefix = "ep_detail";
  await cleanupEventFixture(prisma, prefix);
  try {
    const { accountId, groupId } = await createGroupFixture(prisma, prefix);
    const result = await proposeEvent(prisma, {
      ...meeting(accountId, "group", groupId),
      location: "Library, Room 2",
      description: "Monthly planning",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionIds[0] } });
    const detail = await getPetitionDetail(prisma, {
      subjectType: petition.subjectType,
      subjectId: petition.subjectId,
      status: petition.status,
      createdByMembershipId: petition.createdByMembershipId,
      createdByAccountId: petition.createdByAccountId,
    });

    const fieldByLabel = Object.fromEntries(detail.fields.map((f) => [f.label, f.value]));
    assert.ok("When" in fieldByLabel, "detail should include a When field");
    assert.match(fieldByLabel["When"], /2026/); // formatted range carries the year
    assert.equal(fieldByLabel["Location"], "Library, Room 2");
    assert.equal(fieldByLabel["Description"], "Monthly planning");
  } finally {
    await cleanupEventFixture(prisma, prefix);
  }
});
