import assert from "node:assert/strict";
import test from "node:test";
import {
  FEDERATION_CLASS_RULES,
  FEDERATION_DATA_CLASSES,
  mayFederate,
  type FederationDataClass,
} from "../lib/federation-data-classes";

const PEER_STATUSES = ["proposed", "active", "suspended", "ended"] as const;

// register D-3: the vulnerability class must never pass, under any agreement
// state, with or without the ciphertext flag.
const VULNERABILITY_CLASSES: FederationDataClass[] = ["support_request", "offer", "concern_record"];

test("vulnerability classes never federate under any agreement state or flag", () => {
  for (const dataClass of VULNERABILITY_CLASSES) {
    assert.equal(FEDERATION_CLASS_RULES[dataClass], "never");
    for (const status of PEER_STATUSES) {
      for (const ciphertext of [true, false]) {
        assert.equal(
          mayFederate(dataClass, { status }, { ciphertext }),
          false,
          `${dataClass} must not federate (status=${status}, ciphertext=${ciphertext})`,
        );
      }
    }
  }
});

test("device-local classes never federate", () => {
  for (const dataClass of [
    "offline_draft",
    "personal_note",
    "local_reminder",
    "private_availability",
    "cached_coordination_history",
    "sync_queue_item",
  ] as FederationDataClass[]) {
    for (const status of PEER_STATUSES) {
      assert.equal(mayFederate(dataClass, { status }), false, `${dataClass} (status=${status})`);
    }
  }
});

test("every class is denied without an agreement context (deny-by-default)", () => {
  for (const dataClass of FEDERATION_DATA_CLASSES) {
    assert.equal(mayFederate(dataClass, null), false, dataClass);
    assert.equal(mayFederate(dataClass, undefined), false, dataClass);
  }
});

test("an unknown class is denied even when the type system is bypassed", () => {
  assert.equal(mayFederate("made_up_class" as FederationDataClass, { status: "active" }), false);
});

test("protocol classes flow to proposed and active peers only", () => {
  for (const dataClass of ["federation_ping", "federation_governance"] as FederationDataClass[]) {
    assert.equal(mayFederate(dataClass, { status: "proposed" }), true);
    assert.equal(mayFederate(dataClass, { status: "active" }), true);
    assert.equal(mayFederate(dataClass, { status: "suspended" }), false);
    assert.equal(mayFederate(dataClass, { status: "ended" }), false);
  }
});

test("coordination classes require an active agreement", () => {
  for (const dataClass of [
    "contribution",
    "proposal",
    "governance_preference",
    "portable_identity",
    "linked_node_presence",
    "coalition_coordination",
    "refuge_structural",
  ] as FederationDataClass[]) {
    assert.equal(mayFederate(dataClass, { status: "active" }), true, dataClass);
    assert.equal(mayFederate(dataClass, { status: "proposed" }), false, dataClass);
    assert.equal(mayFederate(dataClass, { status: "suspended" }), false, dataClass);
  }
});

test("ciphertext-only classes require an active agreement AND the ciphertext flag", () => {
  assert.equal(mayFederate("refuge_content_blob", { status: "active" }), false);
  assert.equal(mayFederate("refuge_content_blob", { status: "active" }, { ciphertext: true }), true);
  assert.equal(mayFederate("refuge_content_blob", { status: "proposed" }, { ciphertext: true }), false);
});

test("every federation data class has an explicit rule", () => {
  for (const dataClass of FEDERATION_DATA_CLASSES) {
    assert.ok(FEDERATION_CLASS_RULES[dataClass], `${dataClass} must be classified`);
  }
});

// register D-3: the protocol tier is deny-by-default's SOLE named exception —
// nothing but protocol-class events may flow to a proposed peer, even with
// the ciphertext flag set. Exhaustive over every class so widening the tier
// fails here before it fails in the field.
test("a proposed peer receives nothing but protocol-class events", () => {
  for (const dataClass of FEDERATION_DATA_CLASSES) {
    const expected = FEDERATION_CLASS_RULES[dataClass] === "protocol";
    assert.equal(
      mayFederate(dataClass, { status: "proposed" }, { ciphertext: true }),
      expected,
      `${dataClass} pre-active: expected ${expected}`,
    );
  }
});
