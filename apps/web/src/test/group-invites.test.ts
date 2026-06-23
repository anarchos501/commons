import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  generateGroupInviteToken,
  getActiveGroupInvitePreview,
  resolveGroupInviteToken,
  revokeAllGroupInviteTokens,
} from "../lib/group-invites";
import { createHash } from "node:crypto";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("generateGroupInviteToken stores hash and preview, not the raw token", async () => {
  await cleanupFixture("gi_store");
  try {
    const { membership, groupId } = await createFixture("gi_store");
    const result = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const { rawToken } = result;
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    const record = await prisma.groupInviteToken.findUniqueOrThrow({ where: { tokenHash: expectedHash } });
    assert.equal(record.tokenHash, expectedHash);
    assert.equal(record.tokenPreview, rawToken.slice(0, 8));
    // Raw token must NOT be stored anywhere in the record
    assert.notEqual(record.tokenHash, rawToken);
    assert.notEqual(record.tokenPreview, rawToken);
  } finally {
    await cleanupFixture("gi_store");
  }
});

test("generateGroupInviteToken revokes the previous token before creating a new one", async () => {
  await cleanupFixture("gi_revoke_old");
  try {
    const { membership, groupId } = await createFixture("gi_revoke_old");
    const first = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const firstHash = createHash("sha256").update(first.rawToken).digest("hex");

    const second = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(second.ok, true);

    const firstRecord = await prisma.groupInviteToken.findUniqueOrThrow({ where: { tokenHash: firstHash } });
    assert.notEqual(firstRecord.revokedAt, null, "first token should be revoked after regeneration");
  } finally {
    await cleanupFixture("gi_revoke_old");
  }
});

test("generateGroupInviteToken returns not_eligible for non-active member", async () => {
  await cleanupFixture("gi_ineligible");
  try {
    const { membership, groupId } = await createFixture("gi_ineligible");
    // Downgrade member to quiet
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "quiet" },
    });
    const result = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not_eligible");
  } finally {
    await cleanupFixture("gi_ineligible");
  }
});

test("resolveGroupInviteToken returns group info for a valid token", async () => {
  await cleanupFixture("gi_resolve");
  try {
    const { membership, groupId } = await createFixture("gi_resolve");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const resolved = await resolveGroupInviteToken(prisma, gen.rawToken);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.groupId, groupId);
  } finally {
    await cleanupFixture("gi_resolve");
  }
});

test("resolveGroupInviteToken returns expired for a token past expiresAt", async () => {
  await cleanupFixture("gi_expired");
  try {
    const { membership, groupId } = await createFixture("gi_expired");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    // Backdate expiresAt to the past
    const hash = createHash("sha256").update(gen.rawToken).digest("hex");
    await prisma.groupInviteToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resolved = await resolveGroupInviteToken(prisma, gen.rawToken);
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.reason, "expired");
  } finally {
    await cleanupFixture("gi_expired");
  }
});

test("resolveGroupInviteToken returns revoked for a manually revoked token", async () => {
  await cleanupFixture("gi_revoked");
  try {
    const { membership, groupId } = await createFixture("gi_revoked");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const hash = createHash("sha256").update(gen.rawToken).digest("hex");
    await prisma.groupInviteToken.update({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    });

    const resolved = await resolveGroupInviteToken(prisma, gen.rawToken);
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.reason, "revoked");
  } finally {
    await cleanupFixture("gi_revoked");
  }
});

test("resolveGroupInviteToken returns not_found for an unknown token", async () => {
  const result = await resolveGroupInviteToken(prisma, "completely-unknown-token-value-xyz");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_found");
});

test("getActiveGroupInvitePreview returns null when no active token exists", async () => {
  await cleanupFixture("gi_preview_none");
  try {
    const { groupId } = await createFixture("gi_preview_none");
    const preview = await getActiveGroupInvitePreview(prisma, groupId);
    assert.equal(preview, null);
  } finally {
    await cleanupFixture("gi_preview_none");
  }
});

test("getActiveGroupInvitePreview returns tokenPreview and expiresAt for active token", async () => {
  await cleanupFixture("gi_preview_ok");
  try {
    const { membership, groupId } = await createFixture("gi_preview_ok");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const preview = await getActiveGroupInvitePreview(prisma, groupId);
    assert.notEqual(preview, null);
    if (!preview) return;
    assert.equal(preview.tokenPreview, gen.rawToken.slice(0, 8));
    assert.ok(preview.expiresAt > new Date());
  } finally {
    await cleanupFixture("gi_preview_ok");
  }
});

test("revokeAllGroupInviteTokens revokes all active tokens", async () => {
  await cleanupFixture("gi_revoke_all");
  try {
    const { membership, groupId } = await createFixture("gi_revoke_all");
    await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });

    const result = await revokeAllGroupInviteTokens(prisma, { groupId, membershipId: membership.id });
    assert.equal(result.ok, true);

    const preview = await getActiveGroupInvitePreview(prisma, groupId);
    assert.equal(preview, null);
  } finally {
    await cleanupFixture("gi_revoke_all");
  }
});

test("the raw token is persisted so the preview getter can re-display the full invite link (feedback #2)", async () => {
  await cleanupFixture("gi_raw");
  try {
    const { membership, groupId } = await createFixture("gi_raw");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;
    const preview = await getActiveGroupInvitePreview(prisma, groupId);
    assert.equal(preview?.rawToken, gen.rawToken, "the full raw token is retrievable for re-copy");
  } finally {
    await cleanupFixture("gi_raw");
  }
});

test("a legacy invite with no stored raw token still resolves and degrades to null rawToken", async () => {
  await cleanupFixture("gi_legacy");
  try {
    const { membership, groupId } = await createFixture("gi_legacy");
    const gen = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;
    await prisma.groupInviteToken.updateMany({ where: { groupId }, data: { rawToken: null } });
    const resolved = await resolveGroupInviteToken(prisma, gen.rawToken);
    assert.equal(resolved.ok, true, "the invite still validates by hash");
    const preview = await getActiveGroupInvitePreview(prisma, groupId);
    assert.notEqual(preview, null);
    assert.equal(preview?.rawToken, null);
  } finally {
    await cleanupFixture("gi_legacy");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string) {
  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Node ${prefix}`,
      domain: `${prefix}.gi.localhost`,
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
  return { node, account, group, groupId: group.id, membership };
}

async function cleanupFixture(prefix: string) {
  await prisma.groupInviteToken.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
