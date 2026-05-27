import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentSignature, createSignedEventRecord, hashSignedEventPayload, stableStringify } from "../lib/signed-events";

test("stableStringify sorts object keys recursively", () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
});

test("payload hashes are stable regardless of key order", () => {
  const left = hashSignedEventPayload({ subject: "proposal", values: { b: true, a: 1 } });
  const right = hashSignedEventPayload({ values: { a: 1, b: true }, subject: "proposal" });

  assert.equal(left, right);
});

test("development signatures bind payload hash to public key", () => {
  const hash = hashSignedEventPayload({ id: "proposal_support_retention_30_days" });

  assert.equal(createDevelopmentSignature(hash, "key-a"), createDevelopmentSignature(hash, "key-a"));
  assert.notEqual(createDevelopmentSignature(hash, "key-a"), createDevelopmentSignature(hash, "key-b"));
});

test("createSignedEventRecord prepares a lightweight event record", () => {
  const createdAt = new Date("2026-05-27T12:00:00.000Z");
  const event = createSignedEventRecord({
    eventType: "proposal_created",
    subjectType: "Proposal",
    subjectId: "proposal_support_retention_30_days",
    actorAccountId: "acct_zora",
    portableIdentityId: "pid_zora",
    nodeId: "node_northside_commons",
    groupId: "group_gotham_mutual_aid",
    payload: { title: "Keep support request retention to 30 days" },
    publicKey: "dev-public-key-zora",
    createdAt,
  });

  assert.equal(event.createdAt, createdAt);
  assert.equal(event.payloadHash.length, 64);
  assert.equal(event.signature.length, 64);
  assert.equal(event.subjectType, "Proposal");
});