import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/prisma";
import { joinOpenGroup, requireGroupMembership } from "../lib/group-membership";
import { loginAccount } from "../lib/auth";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("joinOpenGroup creates an active membership", async () => {
  const { account, group } = await createFixture("gm_join");
  try {
    const result = await joinOpenGroup(prisma, account.id, group.id);
    assert.equal(result.groupId, group.id);

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
    });
    assert.ok(membership);
    assert.equal(membership.status, "active");
  } finally {
    await cleanupFixture("gm_join");
  }
});

test("joinOpenGroup is idempotent", async () => {
  const { account, group } = await createFixture("gm_idempotent");
  try {
    await joinOpenGroup(prisma, account.id, group.id);
    await joinOpenGroup(prisma, account.id, group.id);

    const count = await prisma.groupMembership.count({
      where: { accountId: account.id, groupId: group.id },
    });
    assert.equal(count, 1);
  } finally {
    await cleanupFixture("gm_idempotent");
  }
});

test("joinOpenGroup rejects a non-open group", async () => {
  const { account, group } = await createFixture("gm_closed");
  await prisma.group.update({ where: { id: group.id }, data: { membershipPolicy: "invite-only" } });
  try {
    await assert.rejects(
      () => joinOpenGroup(prisma, account.id, group.id),
      /not open to join/,
    );
  } finally {
    await cleanupFixture("gm_closed");
  }
});

test("requireGroupMembership passes for an active member", async () => {
  const { account, group } = await createFixture("gm_pass");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active" },
    });
    await assert.doesNotReject(() => requireGroupMembership(prisma, account.id, group.id));
  } finally {
    await cleanupFixture("gm_pass");
  }
});

test("requireGroupMembership throws for a non-member", async () => {
  const { account, group } = await createFixture("gm_nonmember");
  try {
    await assert.rejects(
      () => requireGroupMembership(prisma, account.id, group.id),
      /Active group membership required/,
    );
  } finally {
    await cleanupFixture("gm_nonmember");
  }
});

test("requireGroupMembership throws for a revoked membership", async () => {
  const { account, group } = await createFixture("gm_revoked");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "revoked" },
    });
    await assert.rejects(
      () => requireGroupMembership(prisma, account.id, group.id),
      /Active group membership required/,
    );
  } finally {
    await cleanupFixture("gm_revoked");
  }
});

test("loginAccount populates groupId from GroupMembership", async () => {
  const { node, account, group } = await createFixture("gm_login_member");
  const passwordHash = await bcrypt.hash("testpass", 10);
  await prisma.account.update({
    where: { id: account.id },
    data: { email: "gm_login_member@test.local", passwordHash },
  });
  await prisma.groupMembership.create({
    data: { accountId: account.id, groupId: group.id, status: "active" },
  });
  try {
    const session = await loginAccount(prisma, { email: "gm_login_member@test.local", password: "testpass" });
    assert.equal(session.groupId, group.id);
    assert.equal(session.nodeId, node.id);
  } finally {
    await cleanupFixture("gm_login_member");
  }
});

test("loginAccount returns groupId null for account with no membership", async () => {
  const { account } = await createFixture("gm_login_nomember");
  const passwordHash = await bcrypt.hash("testpass", 10);
  await prisma.account.update({
    where: { id: account.id },
    data: { email: "gm_login_nomember@test.local", passwordHash },
  });
  try {
    const session = await loginAccount(prisma, { email: "gm_login_nomember@test.local", password: "testpass" });
    assert.equal(session.groupId, null);
  } finally {
    await cleanupFixture("gm_login_nomember");
  }
});

async function createFixture(prefix: string) {
  const suffix = prefix.replace(/_/g, " ");

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Test Node ${suffix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Test Group ${suffix}`,
      membershipPolicy: "open",
    },
  });

  const account = await prisma.account.create({
    data: {
      id: `${prefix}_account`,
      homeNodeId: node.id,
      displayName: `Test User ${suffix}`,
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  return { node, group, account };
}

async function cleanupFixture(prefix: string) {
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
