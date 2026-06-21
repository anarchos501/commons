import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { runGroupVisitEffects } from "../lib/group-visit";

// Pins the non-negotiable visit invariant against the group loader's restructure: the presence +
// reactivation + sweep block is one named, ordered unit, and a quiet/dormant member's visit
// reactivates them. (recordGroupPresence's reactivation is also tested in participation.test.ts;
// this asserts the whole bundle the loader depends on runs and reactivates.)

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function makeFixture(prefix: string, participationStatus: "quiet" | "dormant") {
  await cleanup(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  const membership = await prisma.groupMembership.create({
    data: { accountId: account.id, groupId: group.id, status: "active", participationStatus },
  });
  return { node, group, account, membership };
}

test("runGroupVisitEffects reactivates a quiet member on visit (sweep block runs first + in order)", async () => {
  const prefix = "gvisit_quiet";
  const { account, group, membership } = await makeFixture(prefix, "quiet");
  try {
    await runGroupVisitEffects(prisma, account.id, group.id);
    const after = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id }, select: { participationStatus: true } });
    assert.equal(after.participationStatus, "active");
  } finally {
    await cleanup(prefix);
  }
});

test("runGroupVisitEffects reactivates a dormant member on visit", async () => {
  const prefix = "gvisit_dormant";
  const { account, group, membership } = await makeFixture(prefix, "dormant");
  try {
    await runGroupVisitEffects(prisma, account.id, group.id);
    const after = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id }, select: { participationStatus: true } });
    assert.equal(after.participationStatus, "active");
  } finally {
    await cleanup(prefix);
  }
});
