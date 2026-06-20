import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { submitMemberConcern } from "../lib/concerns";
import { logContactViewedOnce, getContactAccessLog, CONTACT_VIEWED_ACTION } from "../lib/request-access";

const prisma = createPrismaClient();

test.after(async () => {
  await cleanupFixture("rax_concern");
  await cleanupFixture("rax_flag");
  await cleanupFixture("rax_log");
  await prisma.$disconnect();
});

test("submitMemberConcern defaults to a person_concern and writes a concern.submitted log", async () => {
  const { group, account } = await createFixture("rax_concern");
  try {
    const { id } = await submitMemberConcern(prisma, {
      groupId: group.id,
      reportedByAccountId: account.id,
      subject: "A concern",
      description: "Something happened.",
    });
    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    assert.equal(report.kind, "person_concern");
    assert.equal(report.subjectAccountId, null);
    assert.equal(report.supportRequestId, null);
    const log = await prisma.actionLog.findFirst({ where: { action: "concern.submitted", targetId: id } });
    assert.ok(log, "expected a concern.submitted action log");
  } finally {
    await cleanupFixture("rax_concern");
  }
});

test("submitMemberConcern records a request flag bound to the request, never a person", async () => {
  const { group, account, supportRequest } = await createFixture("rax_flag");
  try {
    const { id } = await submitMemberConcern(prisma, {
      groupId: group.id,
      reportedByAccountId: account.id,
      subject: "Looks like spam",
      description: "This request seems fraudulent.",
      kind: "request_flag",
      supportRequestId: supportRequest.id,
      // subjectAccountId intentionally omitted — a request flag never targets a person.
    });
    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    assert.equal(report.kind, "request_flag");
    assert.equal(report.supportRequestId, supportRequest.id);
    assert.equal(report.subjectAccountId, null);
  } finally {
    await cleanupFixture("rax_flag");
  }
});

test("logContactViewedOnce de-dups per helper+request; getContactAccessLog lists accessors", async () => {
  const { group, account, helper2, supportRequest } = await createFixture("rax_log");
  try {
    // First reveal by the helper logs once; a second view does NOT add a row.
    await logContactViewedOnce(prisma, { actorAccountId: account.id, groupId: group.id, supportRequestId: supportRequest.id, routeId: "rax_log_route" });
    await logContactViewedOnce(prisma, { actorAccountId: account.id, groupId: group.id, supportRequestId: supportRequest.id, routeId: "rax_log_route" });
    let rows = await prisma.actionLog.count({ where: { action: CONTACT_VIEWED_ACTION, targetId: supportRequest.id, actorAccountId: account.id } });
    assert.equal(rows, 1, "same helper viewing twice should log once");

    // A different helper adds their own row.
    await logContactViewedOnce(prisma, { actorAccountId: helper2.id, groupId: group.id, supportRequestId: supportRequest.id, routeId: "rax_log_route2" });
    rows = await prisma.actionLog.count({ where: { action: CONTACT_VIEWED_ACTION, targetId: supportRequest.id } });
    assert.equal(rows, 2);

    const ledger = await getContactAccessLog(prisma, supportRequest.id);
    assert.equal(ledger.length, 2);
    const names = ledger.map((e) => e.accessorName).sort();
    assert.deepEqual(names, ["Helper One rax_log", "Helper Two rax_log"]);
    assert.ok(ledger.every((e) => e.viewedAt instanceof Date));
  } finally {
    await cleanupFixture("rax_log");
  }
});

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `Helper One ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  const helper2 = await prisma.account.create({
    data: { id: `${prefix}_helper2`, homeNodeId: node.id, displayName: `Helper Two ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
  const supportRequest = await prisma.supportRequest.create({
    data: {
      id: `${prefix}_req`,
      groupId: group.id,
      requestType: "custom",
      requestedServices: [{ serviceType: "custom", trustRequirement: "lightweight" }],
      description: "Private contact note: call me",
    },
  });
  return { node, group, account, helper2, supportRequest };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { targetId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.report.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
