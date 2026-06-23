import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { volunteerForResponsibility } from "../lib/responsibilities";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("a member cannot open two volunteer petitions for the same role (Layer 1 pre-check)", async () => {
  await cleanupFixture("rvd_pre");
  try {
    const { membership } = await createFixture("rvd_pre");
    const first = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    assert.equal(first.ok, true, "first volunteer petition opens");

    const second = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    assert.equal(second.ok, false, "second volunteer petition is rejected");
    if (second.ok) return;
    assert.equal(second.reason, "petition_already_open");
  } finally {
    await cleanupFixture("rvd_pre");
  }
});

test("the partial unique index blocks a duplicate open petition even when the pre-check is bypassed (Layer 2)", async () => {
  await cleanupFixture("rvd_idx");
  try {
    const { membership } = await createFixture("rvd_idx");
    const first = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Bypass the application-level pre-check entirely: clone the existing open petition's row
    // with a new id. The DB partial unique index must reject the duplicate with P2002 — this is
    // the race-safe guarantee the pre-check alone can't provide.
    const existing = await prisma.petition.findUniqueOrThrow({ where: { id: first.petitionId } });
    const { id: _id, ...clone } = existing;
    void _id;
    await assert.rejects(
      prisma.petition.create({ data: { ...clone, id: "rvd_idx_dup" } }),
      (err: unknown) => (err as { code?: string }).code === "P2002",
      "duplicate open responsibility_proposal petition should violate the unique index",
    );
  } finally {
    await cleanupFixture("rvd_idx");
  }
});

test("a different member may still volunteer for the same role (multi-holder preserved)", async () => {
  await cleanupFixture("rvd_multi");
  try {
    const { membership, groupId } = await createFixture("rvd_multi");
    const other = await prisma.account.create({
      data: { id: "rvd_multi_acct2", homeNodeId: "rvd_multi_node", displayName: "User 2", accountType: "member", profileVisibility: "private" },
    });
    const otherMembership = await prisma.groupMembership.create({
      data: { id: "rvd_multi_mem2", accountId: other.id, groupId, status: "active", participationStatus: "active" },
    });

    const a = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    const b = await volunteerForResponsibility(prisma, { membershipId: otherMembership.id, type: "reviewer" });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true, "a different member's volunteer petition is independent");
  } finally {
    await cleanupFixture("rvd_multi");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string) {
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.rvd.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open", visibility: "public" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  // Note: volunteerForResponsibility only opens a petition (the responsibility need not exist
  // until approval), so no responsibility is provisioned here.
  return { node, account, group, groupId: group.id, membership };
}

async function cleanupFixture(prefix: string) {
  await prisma.petition.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  // Delete abilities before responsibilities (FK), in case any responsibility rows exist.
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
