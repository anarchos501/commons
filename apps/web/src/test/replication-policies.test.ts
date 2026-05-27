import assert from "node:assert/strict";
import test from "node:test";
import { canSyncByDefault, getDefaultReplicationPolicy, requiresPrivacyReviewBeforeSync } from "../lib/replication-policies";

test("personal drafts do not sync by default", () => {
  const policy = getDefaultReplicationPolicy("offline_draft");

  assert.equal(policy?.nodeStorage, "none");
  assert.equal(policy?.localStorage, "draft");
  assert.equal(policy?.federationAllowed, false);
  assert.equal(canSyncByDefault("offline_draft"), false);
});

test("support requests require privacy review before node submission", () => {
  const policy = getDefaultReplicationPolicy("support_request");

  assert.equal(policy?.nodeStorage, "temporary");
  assert.equal(policy?.requiresEncryption, true);
  assert.equal(policy?.syncRequiresConsent, true);
  assert.equal(requiresPrivacyReviewBeforeSync("support_request"), true);
});

test("proposals are node-canonical and federation-ready", () => {
  const policy = getDefaultReplicationPolicy("proposal");

  assert.equal(policy?.nodeStorage, "canonical");
  assert.equal(policy?.federationAllowed, true);
  assert.equal(policy?.p2pAllowed, false);
  assert.equal(canSyncByDefault("proposal"), true);
});

test("personal notes are local-only and encrypted", () => {
  const policy = getDefaultReplicationPolicy("personal_note");

  assert.equal(policy?.nodeStorage, "none");
  assert.equal(policy?.requiresEncryption, true);
  assert.equal(policy?.userDeletionAllowed, true);
});

test("contribution defaults avoid sensitive recipient history", () => {
  const policy = getDefaultReplicationPolicy("contribution");

  assert.equal(policy?.nodeStorage, "canonical");
  assert.equal(policy?.localStorage, "cache");
  assert.equal(policy?.userDeletionAllowed, false);
});