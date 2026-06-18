import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/prisma";
import { joinOpenGroup, leaveGroup, requireGroupMembership, applyForGroupMembership, withdrawGroupApplication } from "../lib/group-membership";
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

test("joinOpenGroup reactivates an inactive membership", async () => {
  const { account, group } = await createFixture("gm_rejoin_inactive");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "inactive" },
    });

    await joinOpenGroup(prisma, account.id, group.id);

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true },
    });
    assert.equal(membership?.status, "active");
  } finally {
    await cleanupFixture("gm_rejoin_inactive");
  }
});

test("applyForGroupMembership reactivates an inactive membership to pending (re-apply after leaving)", async () => {
  const { account, group } = await createFixture("gm_reapply");
  try {
    // Simulate a prior member who left: an inactive row already exists.
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "inactive" },
    });

    const result = await applyForGroupMembership(prisma, account.id, group.id, "Back again, please.");
    assert.equal(result.ok, true);

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true, applicationNote: true },
    });
    assert.equal(membership?.status, "pending");
    assert.equal(membership?.applicationNote, "Back again, please.");
  } finally {
    await cleanupFixture("gm_reapply");
  }
});

test("applyForGroupMembership rejects a duplicate application from a pending applicant", async () => {
  const { account, group } = await createFixture("gm_reapply_pending");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "pending" },
    });
    const result = await applyForGroupMembership(prisma, account.id, group.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "already_applied");
  } finally {
    await cleanupFixture("gm_reapply_pending");
  }
});

test("leaving as the last active member archives the group (P2.5)", async () => {
  const { account, group } = await createFixture("gm_archive");
  try {
    await joinOpenGroup(prisma, account.id, group.id);
    await leaveGroup(prisma, account.id, group.id);
    const g = await prisma.group.findUniqueOrThrow({ where: { id: group.id }, select: { archivedAt: true } });
    assert.ok(g.archivedAt, "expected the defunct group to be archived");
  } finally {
    await cleanupFixture("gm_archive");
  }
});

test("an open group is revived (un-archived) when a new member joins (P2.5)", async () => {
  const { account, group } = await createFixture("gm_revive");
  try {
    await prisma.group.update({ where: { id: group.id }, data: { archivedAt: new Date() } });
    await joinOpenGroup(prisma, account.id, group.id);
    const g = await prisma.group.findUniqueOrThrow({ where: { id: group.id }, select: { archivedAt: true } });
    assert.equal(g.archivedAt, null);
  } finally {
    await cleanupFixture("gm_revive");
  }
});

test("leaving does not archive a group that still has another active member (P2.5)", async () => {
  const { account, group, node } = await createFixture("gm_keep");
  try {
    await joinOpenGroup(prisma, account.id, group.id);
    const other = await prisma.account.create({
      data: { id: "gm_keep_other", homeNodeId: node.id, displayName: "Other", accountType: "participant", profileVisibility: "private" },
    });
    await joinOpenGroup(prisma, other.id, group.id);

    await leaveGroup(prisma, account.id, group.id);
    const g = await prisma.group.findUniqueOrThrow({ where: { id: group.id }, select: { archivedAt: true } });
    assert.equal(g.archivedAt, null);
  } finally {
    await cleanupFixture("gm_keep");
  }
});

test("withdrawGroupApplication deactivates a pending application (P2.3)", async () => {
  const { account, group } = await createFixture("gm_withdraw_app");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "pending", applicationNote: "Please." },
    });

    const result = await withdrawGroupApplication(prisma, account.id, group.id);
    assert.equal(result.ok, true);

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true },
    });
    assert.equal(membership?.status, "inactive");
  } finally {
    await cleanupFixture("gm_withdraw_app");
  }
});

test("withdrawGroupApplication is a no-op for a non-pending membership (P2.3)", async () => {
  const { account, group } = await createFixture("gm_withdraw_active");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active" },
    });
    const result = await withdrawGroupApplication(prisma, account.id, group.id);
    assert.equal(result.ok, false);
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true },
    });
    assert.equal(membership?.status, "active");
  } finally {
    await cleanupFixture("gm_withdraw_active");
  }
});

test("joinOpenGroup does not reactivate a revoked membership", async () => {
  const { account, group } = await createFixture("gm_join_revoked");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "revoked" },
    });

    await assert.rejects(
      () => joinOpenGroup(prisma, account.id, group.id),
      /Revoked memberships cannot be reactivated/,
    );

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true },
    });
    assert.equal(membership?.status, "revoked");
  } finally {
    await cleanupFixture("gm_join_revoked");
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
    assert.equal(session.activeGroupId, group.id);
    assert.equal(session.nodeId, node.id);
  } finally {
    await cleanupFixture("gm_login_member");
  }
});

test("loginAccount returns activeGroupId null for account with no membership", async () => {
  const { account } = await createFixture("gm_login_nomember");
  const passwordHash = await bcrypt.hash("testpass", 10);
  await prisma.account.update({
    where: { id: account.id },
    data: { email: "gm_login_nomember@test.local", passwordHash },
  });
  try {
    const session = await loginAccount(prisma, { email: "gm_login_nomember@test.local", password: "testpass" });
    assert.equal(session.activeGroupId, null);
  } finally {
    await cleanupFixture("gm_login_nomember");
  }
});

test("leaveGroup sets membership status to inactive", async () => {
  const { account, group } = await createFixture("gm_leave");
  try {
    await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group.id, status: "active" } });
    await leaveGroup(prisma, account.id, group.id);
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
      select: { status: true },
    });
    assert.equal(membership?.status, "inactive");
  } finally {
    await cleanupFixture("gm_leave");
  }
});

test("requireGroupMembership throws for an inactive membership", async () => {
  const { account, group } = await createFixture("gm_inactive_guard");
  try {
    await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group.id, status: "inactive" } });
    await assert.rejects(
      () => requireGroupMembership(prisma, account.id, group.id),
      /Active group membership required/,
    );
  } finally {
    await cleanupFixture("gm_inactive_guard");
  }
});

test("loginAccount with multiple memberships sets activeGroupId to earliest-joined", async () => {
  const { node, account } = await createFixture("gm_multi_login");
  const passwordHash = await bcrypt.hash("testpass", 10);
  await prisma.account.update({
    where: { id: account.id },
    data: { email: "gm_multi_login@test.local", passwordHash },
  });
  const group1 = await prisma.group.create({
    data: { id: "gm_multi_login_group1", nodeId: node.id, name: "Group A multi_login", membershipPolicy: "open" },
  });
  const group2 = await prisma.group.create({
    data: { id: "gm_multi_login_group2", nodeId: node.id, name: "Group B multi_login", membershipPolicy: "open" },
  });
  await prisma.groupMembership.create({
    data: { accountId: account.id, groupId: group1.id, status: "active", joinedAt: new Date("2026-01-01T00:00:00Z") },
  });
  await prisma.groupMembership.create({
    data: { accountId: account.id, groupId: group2.id, status: "active", joinedAt: new Date("2026-02-01T00:00:00Z") },
  });
  try {
    const session = await loginAccount(prisma, { email: "gm_multi_login@test.local", password: "testpass" });
    assert.equal(session.activeGroupId, group1.id);
  } finally {
    await cleanupFixture("gm_multi_login");
  }
});

test("requireGroupMembership passes for member of a second group", async () => {
  const { account, group } = await createFixture("gm_second_group");
  const group2 = await prisma.group.create({
    data: { id: "gm_second_group_g2", nodeId: `gm_second_group_node`, name: "Second group for member", membershipPolicy: "open" },
  });
  try {
    await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group.id, status: "active" } });
    await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group2.id, status: "active" } });
    await assert.doesNotReject(() => requireGroupMembership(prisma, account.id, group2.id));
  } finally {
    await prisma.groupMembership.deleteMany({ where: { groupId: group2.id } });
    await prisma.group.deleteMany({ where: { id: group2.id } });
    await cleanupFixture("gm_second_group");
  }
});

test("requireGroupMembership rejects switch to a group with no membership", async () => {
  const { account, group } = await createFixture("gm_switch_guard");
  const otherGroup = await prisma.group.create({
    data: { id: "gm_switch_guard_g2", nodeId: `gm_switch_guard_node`, name: "Other group switch guard", membershipPolicy: "open" },
  });
  try {
    await prisma.groupMembership.create({ data: { accountId: account.id, groupId: group.id, status: "active" } });
    await assert.rejects(
      () => requireGroupMembership(prisma, account.id, otherGroup.id),
      /Active group membership required/,
    );
  } finally {
    await prisma.groupMembership.deleteMany({ where: { groupId: otherGroup.id } });
    await prisma.group.deleteMany({ where: { id: otherGroup.id } });
    await cleanupFixture("gm_switch_guard");
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
