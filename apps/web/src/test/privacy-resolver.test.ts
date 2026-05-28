import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContributionPrivacyEnvelope,
  buildRouteNotificationPayload,
  buildSupportRequestEventPayload,
  resolveEffectivePrivacy,
} from "../lib/privacy-resolver";

test("most restrictive valid privacy preference wins", () => {
  const resolution = resolveEffectivePrivacy({
    dataClass: "support_request",
    requestedPrivacy: "public",
    groupPreferences: { privacyLevel: "group" },
    projectPreferences: { privacyLevel: "private" },
  });

  assert.equal(resolution.privacyLevel, "private");
  assert.equal(resolution.visibility, "private");
});

test("sensitive requests default private and block federation", () => {
  const resolution = resolveEffectivePrivacy({
    dataClass: "support_request",
    requestedPrivacy: "public",
    sensitive: true,
  });

  assert.equal(resolution.privacyLevel, "private");
  assert.equal(resolution.federationAllowed, false);
  assert.equal(resolution.requiresEncryption, true);
});

test("route notification payload excludes requester identity and sensitive details", () => {
  const payload = buildRouteNotificationPayload(
    {
      id: "request_sensitive",
      requestType: "medical ride",
      requestedServices: [{ serviceType: "rides", trustRequirement: "elevated" }],
      urgency: "urgent",
      privacyLevel: "private",
      description: "Requester name and address must not leak.",
      submittedByAccountId: "acct_sensitive_requester",
    },
    resolveEffectivePrivacy({ dataClass: "support_request", sensitive: true }),
  );

  const serialized = JSON.stringify(payload);
  assert.equal(payload.sensitiveDetailsIncluded, false);
  assert.equal(serialized.includes("acct_sensitive_requester"), false);
  assert.equal(serialized.includes("address"), false);
});

test("support request event payload excludes description and requester identity", () => {
  const payload = buildSupportRequestEventPayload(
    {
      id: "request_sensitive_event",
      requestType: "legal support",
      requestedServices: [{ serviceType: "legal navigation", trustRequirement: "elevated" }],
      urgency: "high",
      privacyLevel: "private",
      description: "Private legal details must stay out of event payloads.",
      submittedByAccountId: "acct_private",
    },
    resolveEffectivePrivacy({ dataClass: "support_request", sensitive: true }),
  );

  const serialized = JSON.stringify(payload);
  assert.equal(payload.sensitiveDetailsIncluded, false);
  assert.equal(serialized.includes("acct_private"), false);
  assert.equal(serialized.includes("Private legal details"), false);
});

test("contribution privacy envelope avoids support request identifiers", () => {
  const envelope = buildContributionPrivacyEnvelope("route_123");
  const serialized = JSON.stringify(envelope);

  assert.equal(envelope.excludesRecipientIdentity, true);
  assert.equal(serialized.includes("supportRequestId"), false);
});