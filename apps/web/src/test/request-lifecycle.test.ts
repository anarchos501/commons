import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  DEFAULT_ACCOUNTABILITY_DAYS,
  concernWindowEndsAt,
  deleteSupportRequest,
  fulfillSupportRequest,
  generateGuestAccessToken,
  redactSupportRequestIfEligible,
  validateGuestAccessToken,
} from "../lib/request-lifecycle";
import { createSupportRequest, routeSupportRequest } from "../lib/capability-routing";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function createFixture(suffix: string) {
  const prefix = `lifecycle_${suffix}`;
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Lifecycle Test ${suffix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Lifecycle Group ${suffix}`,
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private" },
    },
  });

  await prisma.groupServiceOffering.create({
    data: {
      id: `${prefix}_offering`,
      groupId: group.id,
      serviceType: "food delivery",
      status: "active",
      minimumContributorTrust: "lightweight",
    },
  });

  const requester = await prisma.account.create({
    data: { id: `${prefix}_requester`, homeNodeId: node.id, displayName: `Requester ${suffix}`, accountType: "participant", profileVisibility: "private" },
  });

  return { node, group, requester, prefix };
}

async function cleanupFixture(prefix: string) {
  await prisma.report.deleteMany({ where: { guestAccessToken: { supportRequest: { id: { startsWith: prefix } } } } });
  await prisma.guestAccessToken.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.requestRoute.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.supportRequestService.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.privacyEnvelope.deleteMany({ where: { targetId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contributorAvailability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.serviceCapability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupServiceOffering.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function makeRequest(prefix: string, groupId: string, requesterId: string) {
  return createSupportRequest(prisma, {
    id: `${prefix}_request`,
    submittedByAccountId: requesterId,
    groupId,
    requestType: "food delivery",
    requestedServices: [{ serviceType: "food delivery", trustRequirement: "lightweight" }],
    description: "Test request",
    urgency: "normal",
    privacyLevel: "private",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

// ---------------------------------------------------------------------------
// generateGuestAccessToken
// ---------------------------------------------------------------------------

test("generateGuestAccessToken sets expiresAt to requestExpiresAt + DEFAULT_ACCOUNTABILITY_DAYS", async () => {
  const { group, requester, prefix } = await createFixture("token_expiry_set");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    assert.ok(request.expiresAt !== null, "fixture request must have expiresAt");
    await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    const record = await prisma.guestAccessToken.findUnique({ where: { supportRequestId: request.id } });
    assert.ok(record?.expiresAt !== null, "token expiresAt must be set at creation");
    const expectedMs = request.expiresAt!.getTime() + DEFAULT_ACCOUNTABILITY_DAYS * 24 * 60 * 60 * 1000;
    assert.equal(record!.expiresAt!.getTime(), expectedMs);
  } finally {
    await cleanupFixture(prefix);
  }
});

test("generateGuestAccessToken with null requestExpiresAt applies defensive 2× fallback", async () => {
  const { group, requester, prefix } = await createFixture("token_expiry_null");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const before = new Date();
    await generateGuestAccessToken(prisma, request.id, null);
    const record = await prisma.guestAccessToken.findUnique({ where: { supportRequestId: request.id } });
    assert.ok(record?.expiresAt !== null, "null requestExpiresAt must still produce a bounded token");
    const expectedMs = before.getTime() + DEFAULT_ACCOUNTABILITY_DAYS * 2 * 24 * 60 * 60 * 1000;
    const diffMs = Math.abs(record!.expiresAt!.getTime() - expectedMs);
    assert.ok(diffMs < 5000, "token expiresAt should be approximately 2× DEFAULT_ACCOUNTABILITY_DAYS from now");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("generateGuestAccessToken produces unique tokens for different requests", async () => {
  const { group, requester, prefix } = await createFixture("token_unique");
  try {
    const req1 = await makeRequest(`${prefix}_a`, group.id, requester.id);
    const req2 = await makeRequest(`${prefix}_b`, group.id, requester.id);

    const token1 = await generateGuestAccessToken(prisma, req1.id, req1.expiresAt);
    const token2 = await generateGuestAccessToken(prisma, req2.id, req2.expiresAt);

    assert.notEqual(token1, token2);
    assert.ok(token1.length >= 32);
  } finally {
    await cleanupFixture(`${prefix}_a`);
    await cleanupFixture(`${prefix}_b`);
    await cleanupFixture(prefix);
  }
});

test("generateGuestAccessToken stores only the hash, not the raw token", async () => {
  const { group, requester, prefix } = await createFixture("token_hash");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);

    const record = await prisma.guestAccessToken.findUnique({ where: { supportRequestId: request.id } });
    assert.ok(record, "token record should exist");
    assert.notEqual(record.tokenHash, rawToken, "stored hash must differ from raw token");
    assert.equal(record.tokenHash.length, 64, "SHA-256 hex is 64 chars");
  } finally {
    await cleanupFixture(prefix);
  }
});

// ---------------------------------------------------------------------------
// validateGuestAccessToken
// ---------------------------------------------------------------------------

test("validateGuestAccessToken accepts a valid token", async () => {
  const { group, requester, prefix } = await createFixture("validate_ok");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    const result = await validateGuestAccessToken(prisma, rawToken);
    assert.equal(result.supportRequest.id, request.id);
  } finally {
    await cleanupFixture(prefix);
  }
});

test("validateGuestAccessToken rejects an unknown token", async () => {
  await assert.rejects(
    () => validateGuestAccessToken(prisma, "totally-unknown-token-xyz"),
    /invalid or has been revoked/,
  );
});

test("validateGuestAccessToken rejects a revoked token", async () => {
  const { group, requester, prefix } = await createFixture("validate_revoked");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    await prisma.guestAccessToken.update({
      where: { supportRequestId: request.id },
      data: { revokedAt: new Date() },
    });
    await assert.rejects(
      () => validateGuestAccessToken(prisma, rawToken),
      /revoked/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

test("validateGuestAccessToken rejects an expired token", async () => {
  const { group, requester, prefix } = await createFixture("validate_expired");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    await prisma.guestAccessToken.update({
      where: { supportRequestId: request.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(
      () => validateGuestAccessToken(prisma, rawToken),
      /expired/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

test("validateGuestAccessToken rejects deleted request even if revokedAt is unset", async () => {
  const { group, requester, prefix } = await createFixture("validate_deleted_no_revoke");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    // Simulate deletion without revokedAt being set (e.g. direct DB update)
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "deleted" } });
    await prisma.guestAccessToken.update({ where: { supportRequestId: request.id }, data: { revokedAt: null } });
    await assert.rejects(
      () => validateGuestAccessToken(prisma, rawToken),
      /invalid or has been revoked/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

// ---------------------------------------------------------------------------
// fulfillSupportRequest
// ---------------------------------------------------------------------------

test("fulfillSupportRequest sets status and accountabilityEndsAt", async () => {
  const { group, requester, prefix } = await createFixture("fulfill_ok");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "matched" } });
    const before = new Date();
    await fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(updated.status, "fulfilled");
    assert.ok(updated.accountabilityEndsAt !== null);
    const diffDays = Math.round((updated.accountabilityEndsAt!.getTime() - before.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(diffDays >= DEFAULT_ACCOUNTABILITY_DAYS - 1 && diffDays <= DEFAULT_ACCOUNTABILITY_DAYS + 1);
  } finally {
    await cleanupFixture(prefix);
  }
});

test("fulfillSupportRequest is idempotent", async () => {
  const { group, requester, prefix } = await createFixture("fulfill_idempotent");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "matched" } });
    await fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    await fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(updated.status, "fulfilled");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("fulfillSupportRequest rejects open and routed requests", async () => {
  const { group, requester, prefix } = await createFixture("fulfill_requires_matched");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    assert.equal(request.status, "open");
    await assert.rejects(
      () => fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id }),
      /only be marked fulfilled after a contributor has accepted/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

test("fulfillSupportRequest rejects a wrong actor", async () => {
  const { group, requester, prefix } = await createFixture("fulfill_wrong_actor");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "matched" } });
    await assert.rejects(
      () => fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: "wrong_account_id" }),
      /Only the requester/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

test("fulfillSupportRequest updates guest token expiresAt to match accountability window", async () => {
  const { group, requester, prefix } = await createFixture("fulfill_token_expiry");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "matched" } });
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    await fulfillSupportRequest(prisma, { supportRequestId: request.id, rawToken });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    const token = await prisma.guestAccessToken.findUnique({ where: { supportRequestId: request.id } });
    assert.ok(token?.expiresAt !== null);
    assert.equal(token!.expiresAt!.getTime(), updated.accountabilityEndsAt!.getTime());
  } finally {
    await cleanupFixture(prefix);
  }
});

// ---------------------------------------------------------------------------
// deleteSupportRequest
// ---------------------------------------------------------------------------

test("deleteSupportRequest sets status to deleted", async () => {
  const { group, requester, prefix } = await createFixture("delete_ok");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(updated.status, "deleted");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("deleteSupportRequest preserves description (cleanup deferred to privacy pass)", async () => {
  const { group, requester, prefix } = await createFixture("delete_preserve");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.ok(updated.description !== null && updated.description.length > 0, "description must be preserved until privacy-cleanup pass");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("deleteSupportRequest revokes guest access token immediately", async () => {
  const { group, requester, prefix } = await createFixture("delete_revokes_token");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    const rawToken = await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    await deleteSupportRequest(prisma, { supportRequestId: request.id, rawToken });
    const token = await prisma.guestAccessToken.findUnique({ where: { supportRequestId: request.id } });
    assert.ok(token?.revokedAt !== null, "token must be revoked on deletion");
    await assert.rejects(
      () => validateGuestAccessToken(prisma, rawToken),
      /revoked/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

test("deleteSupportRequest is idempotent", async () => {
  const { group, requester, prefix } = await createFixture("delete_idempotent");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    await deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: requester.id });
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(updated.status, "deleted");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("deleteSupportRequest rejects a wrong actor", async () => {
  const { group, requester, prefix } = await createFixture("delete_wrong_actor");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await assert.rejects(
      () => deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: "wrong_account_id" }),
      /Only the requester/,
    );
  } finally {
    await cleanupFixture(prefix);
  }
});

// ---------------------------------------------------------------------------
// routeSupportRequest → routed status
// ---------------------------------------------------------------------------

test("routeSupportRequest sets status to routed when routes are created", async () => {
  const prefix = "lifecycle_routing";
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: "Routing Test", domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: "Routing Group", membershipPolicy: "open", privacyPreferences: { supportRequests: "private" } },
  });
  await prisma.groupServiceOffering.create({
    data: { id: `${prefix}_offering`, groupId: group.id, serviceType: "translation", status: "active", minimumContributorTrust: "lightweight" },
  });
  const requester = await prisma.account.create({
    data: { id: `${prefix}_requester`, homeNodeId: node.id, displayName: "Requester", accountType: "participant", profileVisibility: "private" },
  });
  const helper = await prisma.account.create({
    data: { id: `${prefix}_helper`, homeNodeId: node.id, displayName: "Helper", accountType: "member", profileVisibility: "group" },
  });
  await prisma.groupMembership.create({ data: { accountId: helper.id, groupId: group.id, status: "active" } });

  const { declareServiceCapability } = await import("../lib/capability-routing");
  await declareServiceCapability(prisma, { accountId: helper.id, serviceType: "translation", trustRequirement: "lightweight", availability: { availableNow: true } });

  const request = await createSupportRequest(prisma, {
    id: `${prefix}_request`,
    submittedByAccountId: requester.id,
    groupId: group.id,
    requestType: "translation",
    requestedServices: [{ serviceType: "translation", trustRequirement: "lightweight" }],
    description: "Needs translation",
    urgency: "normal",
    privacyLevel: "private",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  assert.equal(request.status, "open", "initial status must be open");

  await routeSupportRequest(prisma, { supportRequestId: request.id });

  const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(updated.status, "routed", "status must be routed after routes are created");

  await cleanupFixture(prefix);
});

// ---------------------------------------------------------------------------
// redactSupportRequestIfEligible
// ---------------------------------------------------------------------------

test("redactSupportRequestIfEligible redacts description after accountability window closes", async () => {
  const { group, requester, prefix } = await createFixture("redact_ok");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    // Simulate accountability window already closed
    const past = new Date(Date.now() - 1000);
    await prisma.supportRequest.update({
      where: { id: request.id },
      data: { status: "fulfilled", accountabilityEndsAt: past },
    });
    const result = await redactSupportRequestIfEligible(prisma, request.id);
    assert.equal(result, "redacted");
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(updated.description, "");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("redactSupportRequestIfEligible returns window_still_open when concern window is active", async () => {
  const { group, requester, prefix } = await createFixture("redact_window_open");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.supportRequest.update({
      where: { id: request.id },
      data: { status: "fulfilled", accountabilityEndsAt: future },
    });
    const result = await redactSupportRequestIfEligible(prisma, request.id);
    assert.equal(result, "window_still_open");
    const updated = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.notEqual(updated.description, "");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("redactSupportRequestIfEligible is idempotent", async () => {
  const { group, requester, prefix } = await createFixture("redact_idempotent");
  try {
    const request = await makeRequest(prefix, group.id, requester.id);
    await generateGuestAccessToken(prisma, request.id, request.expiresAt);
    const past = new Date(Date.now() - 1000);
    await prisma.supportRequest.update({
      where: { id: request.id },
      data: { status: "fulfilled", accountabilityEndsAt: past },
    });
    await redactSupportRequestIfEligible(prisma, request.id);
    const result = await redactSupportRequestIfEligible(prisma, request.id);
    assert.equal(result, "already_redacted");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("redactSupportRequestIfEligible returns not_found for unknown request", async () => {
  const result = await redactSupportRequestIfEligible(prisma, "nonexistent_request_id");
  assert.equal(result, "not_found");
});

// ---------------------------------------------------------------------------
// concernWindowEndsAt
// ---------------------------------------------------------------------------

test("concernWindowEndsAt returns accountabilityEndsAt for fulfilled requests", () => {
  const accountabilityEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  const result = concernWindowEndsAt(
    { status: "fulfilled", accountabilityEndsAt },
    { expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
  );
  assert.equal(result?.getTime(), accountabilityEndsAt.getTime());
});

test("concernWindowEndsAt returns token.expiresAt for expired requests", () => {
  const tokenExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const result = concernWindowEndsAt(
    { status: "expired", accountabilityEndsAt: null },
    { expiresAt: tokenExpiry },
  );
  assert.equal(result?.getTime(), tokenExpiry.getTime());
});

test("concernWindowEndsAt returns null when no anchor is available", () => {
  const result = concernWindowEndsAt(
    { status: "expired", accountabilityEndsAt: null },
    { expiresAt: null },
  );
  assert.equal(result, null);
});
