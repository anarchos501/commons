import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPrismaClient } from "../lib/prisma";
import {
  generateGroupRequestLink,
  resolveGroupRequestLink,
  requestLinkGrantsAccess,
  getActiveGroupRequestLinkPreview,
  revokeAllGroupRequestLinks,
} from "../lib/group-request-links";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("generateGroupRequestLink stores hash and preview, never the raw token, and has no expiry", async () => {
  await cleanupFixture("grl_store");
  try {
    const { membership, groupId } = await createFixture("grl_store");
    const result = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const expectedHash = createHash("sha256").update(result.rawToken).digest("hex");
    const record = await prisma.groupRequestLink.findUniqueOrThrow({ where: { tokenHash: expectedHash } });
    assert.equal(record.tokenPreview, result.rawToken.slice(0, 8));
    assert.notEqual(record.tokenHash, result.rawToken);
    // Durable by design: no expiry field exists; only revokedAt can disable it.
    assert.equal(record.revokedAt, null);
  } finally {
    await cleanupFixture("grl_store");
  }
});

test("generateGroupRequestLink revokes the previous link before issuing a new one", async () => {
  await cleanupFixture("grl_regen");
  try {
    const { membership, groupId } = await createFixture("grl_regen");
    const first = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const firstHash = createHash("sha256").update(first.rawToken).digest("hex");

    await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });

    const firstRecord = await prisma.groupRequestLink.findUniqueOrThrow({ where: { tokenHash: firstHash } });
    assert.notEqual(firstRecord.revokedAt, null, "previous link should be revoked after regeneration");
  } finally {
    await cleanupFixture("grl_regen");
  }
});

test("generateGroupRequestLink returns not_eligible for a non-active member", async () => {
  await cleanupFixture("grl_inelig");
  try {
    const { membership, groupId } = await createFixture("grl_inelig");
    await prisma.groupMembership.update({ where: { id: membership.id }, data: { participationStatus: "quiet" } });
    const result = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not_eligible");
  } finally {
    await cleanupFixture("grl_inelig");
  }
});

test("requestLinkGrantsAccess: a token grants access to its own group but NOT another group", async () => {
  await cleanupFixture("grl_scope");
  try {
    const { membership, groupId } = await createFixture("grl_scope");
    // A second private group on the same node — the token must never open it.
    const otherGroup = await prisma.group.create({
      data: { id: "grl_scope_group2", nodeId: "grl_scope_node", name: "Group grl_scope 2", membershipPolicy: "request_required", visibility: "private" },
    });

    const gen = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    assert.equal(await requestLinkGrantsAccess(prisma, groupId, gen.rawToken), true, "token opens its own group");
    assert.equal(await requestLinkGrantsAccess(prisma, otherGroup.id, gen.rawToken), false, "token must not open another group");
    assert.equal(await requestLinkGrantsAccess(prisma, groupId, null), false, "absent token grants nothing");
    assert.equal(await requestLinkGrantsAccess(prisma, groupId, "bogus-token"), false, "unknown token grants nothing");
  } finally {
    await cleanupFixture("grl_scope");
  }
});

test("a revoked token fails closed", async () => {
  await cleanupFixture("grl_revoked");
  try {
    const { membership, groupId } = await createFixture("grl_revoked");
    const gen = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const revoke = await revokeAllGroupRequestLinks(prisma, { groupId, membershipId: membership.id });
    assert.equal(revoke.ok, true);

    const resolved = await resolveGroupRequestLink(prisma, gen.rawToken);
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.reason, "revoked");
    assert.equal(await requestLinkGrantsAccess(prisma, groupId, gen.rawToken), false);
    assert.equal(await getActiveGroupRequestLinkPreview(prisma, groupId), null);
  } finally {
    await cleanupFixture("grl_revoked");
  }
});

test("resolveGroupRequestLink returns not_found for an unknown token", async () => {
  const result = await resolveGroupRequestLink(prisma, "definitely-not-a-real-token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_found");
});

test("the raw token is persisted so the preview getter can re-display the full link (feedback #2)", async () => {
  await cleanupFixture("grl_raw");
  try {
    const { membership, groupId } = await createFixture("grl_raw");
    const gen = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;
    const preview = await getActiveGroupRequestLinkPreview(prisma, groupId);
    assert.equal(preview?.rawToken, gen.rawToken, "the full raw token is retrievable for re-copy");
    assert.equal(preview?.tokenPreview, gen.rawToken.slice(0, 8));
  } finally {
    await cleanupFixture("grl_raw");
  }
});

test("a legacy link with no stored raw token still works by hash and degrades to null rawToken", async () => {
  await cleanupFixture("grl_legacy");
  try {
    const { membership, groupId } = await createFixture("grl_legacy");
    const gen = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;
    // Simulate a pre-migration row: clear the stored raw token.
    await prisma.groupRequestLink.updateMany({ where: { groupId }, data: { rawToken: null } });
    // The link keeps working (resolution is by hash) ...
    assert.equal(await requestLinkGrantsAccess(prisma, groupId, gen.rawToken), true);
    // ... but it can't be re-displayed: the getter returns the row with a null rawToken (not null/crash).
    const preview = await getActiveGroupRequestLinkPreview(prisma, groupId);
    assert.notEqual(preview, null);
    assert.equal(preview?.rawToken, null);
  } finally {
    await cleanupFixture("grl_legacy");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string) {
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.grl.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "request_required", visibility: "private" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  return { node, account, group, groupId: group.id, membership };
}

async function cleanupFixture(prefix: string) {
  await prisma.groupRequestLink.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
