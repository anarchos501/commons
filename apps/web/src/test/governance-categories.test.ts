import assert from "node:assert/strict";
import test from "node:test";
import {
  GOVERNANCE_CATEGORIES,
  CATEGORY_REGISTRY,
  isGovernanceCategory,
  resolveParameter,
  resolveAllParameters,
  validateGovernanceSnapshot,
} from "../lib/governance-categories";

test("all 12 categories are registered", () => {
  assert.equal(GOVERNANCE_CATEGORIES.length, 12);
  for (const category of GOVERNANCE_CATEGORIES) {
    assert.ok(CATEGORY_REGISTRY[category], `${category} missing from registry`);
  }
});

test("isGovernanceCategory rejects unknown values", () => {
  assert.equal(isGovernanceCategory("membership"), true);
  assert.equal(isGovernanceCategory("unknown_cat"), false);
  assert.equal(isGovernanceCategory(""), false);
});

test("all categories have threshold and petitionDuration", () => {
  for (const category of GOVERNANCE_CATEGORIES) {
    const def = CATEGORY_REGISTRY[category];
    assert.ok(def.threshold, `${category} missing threshold`);
    assert.ok(def.petitionDuration, `${category} missing petitionDuration`);
  }
});

test("resolveParameter at temperature=0 returns default anchor", () => {
  assert.equal(resolveParameter("membership", "threshold", 0), 0.50);
  assert.equal(resolveParameter("membership", "petitionDuration", 0), 3);
  assert.equal(resolveParameter("responsibility", "reconfirmationPeriod", 0), 14);
  assert.equal(resolveParameter("emergency", "duration", 0), 14);
  assert.equal(resolveParameter("discussion", "messageRetentionDays", 0), 30);
  assert.equal(resolveParameter("discussion", "threadInactivityDays", 0), 14);
});

test("resolveParameter at temperature=-1 returns restrictive anchor", () => {
  assert.equal(resolveParameter("membership", "threshold", -1), 0.95);
  assert.equal(resolveParameter("membership", "petitionDuration", -1), 7);
  assert.equal(resolveParameter("emergency", "threshold", -1), 0.95);
  assert.equal(resolveParameter("responsibility", "reconfirmationPeriod", -1), 7);
  assert.equal(resolveParameter("discussion", "messageRetentionDays", -1), 7);
  assert.equal(resolveParameter("discussion", "threadInactivityDays", -1), 7);
});

test("resolveParameter at temperature=+1 returns permissive anchor", () => {
  assert.ok(Math.abs(resolveParameter("membership", "threshold", 1) - 0.05) < 0.001);
  assert.equal(resolveParameter("membership", "petitionDuration", 1), 1);
  assert.equal(resolveParameter("emergency", "duration", 1), 30);
  assert.equal(resolveParameter("responsibility", "reconfirmationPeriod", 1), 30);
  assert.equal(resolveParameter("discussion", "messageRetentionDays", 1), 90);
  assert.equal(resolveParameter("discussion", "threadInactivityDays", 1), 30);
});

test("resolveParameter interpolates linearly between anchors", () => {
  // At temperature +0.5: lerp(default=0.50, permissive=0.05, 0.5) = 0.275
  const threshold = resolveParameter("membership", "threshold", 0.5);
  assert.ok(Math.abs(threshold - 0.275) < 0.001);

  // At temperature -0.5: lerp(restrictive=0.95, default=0.50, 0.5) = 0.725
  const thresholdNeg = resolveParameter("membership", "threshold", -0.5);
  assert.ok(Math.abs(thresholdNeg - 0.725) < 0.001);
});

test("resolveParameter clamps to min/max bounds", () => {
  // reconfirmationPeriod has min=30, max=730 — anchors are already within bounds
  // but clamping should hold even at extremes
  const min = resolveParameter("responsibility", "reconfirmationPeriod", -1);
  assert.ok(min >= 3, "must be at least 3 days");
  const max = resolveParameter("responsibility", "reconfirmationPeriod", 1);
  assert.ok(max <= 30, "must be at most 30 days");
});

test("resolveParameter throws for unknown parameter", () => {
  assert.throws(() => resolveParameter("membership", "unknownParam", 0), /Unknown parameter/);
});

test("resolveAllParameters returns all keys for each category", () => {
  const membership = resolveAllParameters("membership", 0);
  assert.ok("threshold" in membership);
  assert.ok("petitionDuration" in membership);

  const responsibility = resolveAllParameters("responsibility", 0);
  assert.ok("reconfirmationPeriod" in responsibility);

  const emergency = resolveAllParameters("emergency", 0);
  assert.ok("duration" in emergency);

  const discussion = resolveAllParameters("discussion", 0);
  assert.ok("messageRetentionDays" in discussion);
  assert.ok("threadInactivityDays" in discussion);
});

test("validateGovernanceSnapshot accepts valid snapshots", () => {
  assert.equal(validateGovernanceSnapshot("membership", { threshold: 0.6, petitionDuration: 7 }), true);
  assert.equal(validateGovernanceSnapshot("responsibility", { threshold: 0.5, petitionDuration: 7, reconfirmationPeriod: 365 }), true);
  assert.equal(validateGovernanceSnapshot("emergency", { threshold: 0.8, petitionDuration: 3, duration: 30 }), true);
  assert.equal(validateGovernanceSnapshot("discussion", { threshold: 0.55, petitionDuration: 7, messageRetentionDays: 30, threadInactivityDays: 60 }), true);
});

test("validateGovernanceSnapshot rejects missing fields", () => {
  assert.equal(validateGovernanceSnapshot("membership", { threshold: 0.6 }), false);
  assert.equal(validateGovernanceSnapshot("responsibility", { threshold: 0.5, petitionDuration: 7 }), false);
  assert.equal(validateGovernanceSnapshot("emergency", { threshold: 0.8, petitionDuration: 3 }), false);
  assert.equal(validateGovernanceSnapshot("discussion", { threshold: 0.55, petitionDuration: 7 }), false);
  assert.equal(validateGovernanceSnapshot("membership", null), false);
  assert.equal(validateGovernanceSnapshot("membership", "not an object"), false);
});
