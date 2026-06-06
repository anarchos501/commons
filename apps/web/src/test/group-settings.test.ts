import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { applyGroupVisibilityFromPetition, createGroup, proposeGroupVisibility } from "../lib/group-settings";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("createGroup creates a private request-required group with the creator as active member", async () => {
  await cleanupFixture("gs_create");
  try {
    const { node, account } = await createBase("gs_create");

    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "New Private Group",
      description: "A fresh group.",
      creatorAccountId: account.id,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.visibility, "private");
    assert.equal(group.membershipPolicy, "request_required");

    const membership = await prisma.groupMembership.findUniqueOrThrow({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
    });
    assert.equal(membership.status, "active");
    assert.equal(membership.participationStatus, "active");
  } finally {
    await cleanupFixture("gs_create");
  }
});

test("createGroup with explicit 'open' policy creates an open group", async () => {
  await cleanupFixture("gs_open");
  try {
    const { node, account } = await createBase("gs_open");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Open Group",
      creatorAccountId: account.id,
      membershipPolicy: "open",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "open");
  } finally {
    await cleanupFixture("gs_open");
  }
});

test("createGroup with explicit 'request_required' policy creates a request_required group", async () => {
  await cleanupFixture("gs_rr");
  try {
    const { node, account } = await createBase("gs_rr");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "RR Group",
      creatorAccountId: account.id,
      membershipPolicy: "request_required",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "request_required");
  } finally {
    await cleanupFixture("gs_rr");
  }
});

test("createGroup with missing or invalid policy defaults to request_required", async () => {
  await cleanupFixture("gs_fallback");
  try {
    const { node, account } = await createBase("gs_fallback");
    // No membershipPolicy provided
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Fallback Group",
      creatorAccountId: account.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "request_required");
  } finally {
    await cleanupFixture("gs_fallback");
  }
});

test("group visibility petition approval makes the group public", async () => {
  await cleanupFixture("gs_visibility");
  try {
    const { group, membership } = await createGroupFixture("gs_visibility");

    const result = await proposeGroupVisibility(prisma, {
      groupId: group.id,
      createdByMembershipId: membership.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.category, "group_settings");
    assert.equal(petition.subjectType, "group_visibility_proposal");
    assert.equal(petition.subjectId, group.id);

    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved" } });
    await applyGroupVisibilityFromPetition(prisma, result.petitionId);

    const updated = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(updated.visibility, "public");
  } finally {
    await cleanupFixture("gs_visibility");
  }
});

async function createBase(prefix: string) {
  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Node ${prefix}`,
      domain: `${prefix}.cc.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });
  const account = await prisma.account.create({
    data: {
      id: `${prefix}_acct`,
      homeNodeId: node.id,
      displayName: `User ${prefix}`,
      accountType: "member",
      profileVisibility: "private",
    },
  });
  return { node, account };
}

async function createGroupFixture(prefix: string) {
  const { node, account } = await createBase(prefix);
  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Group ${prefix}`,
      membershipPolicy: "request_required",
      visibility: "private",
    },
  });
  const membership = await prisma.groupMembership.create({
    data: {
      id: `${prefix}_mem`,
      accountId: account.id,
      groupId: group.id,
      status: "active",
      participationStatus: "active",
    },
  });
  return { group, membership };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { group: { nodeId: { startsWith: prefix } } } } });
  await prisma.petition.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
