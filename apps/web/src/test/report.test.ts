import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("report is created with status open by default", async () => {
  const { account, group } = await createFixture("rpt_default_status");
  try {
    const report = await prisma.report.create({
      data: {
        reportedByAccountId: account.id,
        groupId: group.id,
        subject: "Test concern",
        description: "Something needs attention.",
      },
    });
    assert.equal(report.status, "open");
    assert.equal(report.visibility, "private");
  } finally {
    await cleanupFixture("rpt_default_status");
  }
});

test("reporter can query their own report by accountId", async () => {
  const { account, group } = await createFixture("rpt_query_own");
  try {
    await prisma.report.create({
      data: {
        reportedByAccountId: account.id,
        groupId: group.id,
        subject: "Availability mismatch",
        description: "Coordinator did not respond within the expected window.",
        context: "This was an urgent request.",
      },
    });

    const results = await prisma.report.findMany({
      where: { reportedByAccountId: account.id, groupId: group.id },
      select: { subject: true, description: true, context: true },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].subject, "Availability mismatch");
    assert.equal(results[0].context, "This was an urgent request.");
  } finally {
    await cleanupFixture("rpt_query_own");
  }
});

test("group open concern count reflects only open reports", async () => {
  const { account, group } = await createFixture("rpt_count");
  try {
    await prisma.report.createMany({
      data: [
        { reportedByAccountId: account.id, groupId: group.id, subject: "Open concern", description: "Still open.", status: "open" },
        { reportedByAccountId: account.id, groupId: group.id, subject: "Resolved concern", description: "Closed.", status: "resolved" },
        { reportedByAccountId: account.id, groupId: group.id, subject: "Dismissed concern", description: "Dismissed.", status: "dismissed" },
      ],
    });

    const openCount = await prisma.report.count({ where: { groupId: group.id, status: "open" } });
    assert.equal(openCount, 1);
  } finally {
    await cleanupFixture("rpt_count");
  }
});

test("concern count does not bleed across groups", async () => {
  const { account, group } = await createFixture("rpt_isolation");
  const groupB = await prisma.group.create({
    data: {
      id: "rpt_isolation_group_b",
      nodeId: `rpt_isolation_node`,
      name: "Group B rpt_isolation",
      membershipPolicy: "open",
    },
  });
  try {
    await prisma.report.create({
      data: {
        reportedByAccountId: account.id,
        groupId: group.id,
        subject: "Concern in group A",
        description: "Only visible to group A.",
        status: "open",
      },
    });

    const countInGroupB = await prisma.report.count({ where: { groupId: groupB.id, status: "open" } });
    assert.equal(countInGroupB, 0);
  } finally {
    await prisma.group.deleteMany({ where: { id: groupB.id } });
    await cleanupFixture("rpt_isolation");
  }
});

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Test Node ${prefix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Test Group ${prefix}`,
      membershipPolicy: "open",
    },
  });

  const account = await prisma.account.create({
    data: {
      id: `${prefix}_account`,
      homeNodeId: node.id,
      displayName: `Test User ${prefix}`,
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  return { node, group, account };
}

async function cleanupFixture(prefix: string) {
  await prisma.report.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.report.deleteMany({ where: { reportedByAccountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
