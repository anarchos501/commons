import assert from "node:assert/strict";
import test from "node:test";
import { resolveGroupView, computeForeground, type GroupViewInputs, type GroupSearchSignals } from "../lib/group-view";
import { BASELINE_MODULES, MODULE_IDS, type ModuleId } from "../lib/group-modules";
import type { UiDisclosurePrefs } from "../lib/ui-disclosure";
import type { ViewerSpaces } from "../lib/events";

// Pure-function guardrail tests — no DB needed.

const emptyViewer = (accountId = "a1"): ViewerSpaces => ({
  accountId,
  groupIds: new Set(),
  projectIds: new Set(),
  coalitionIds: new Set(),
  responsibilityIds: new Set(),
});

function inputs(over: Partial<GroupViewInputs> = {}): GroupViewInputs {
  return {
    groupId: "g1",
    standing: "member",
    participation: "active",
    viewer: emptyViewer(),
    groupResponsibilityIds: new Set(),
    groupProjectIds: new Set(),
    groupCoalitionIds: new Set(),
    hasReviewerRole: false,
    filedConcern: false,
    partyToOpenPetition: false,
    authoredDiscussionThread: false,
    hasCategories: false,
    hasTrustedProviders: false,
    hasLibraryContent: false,
    isNodeSteward: false,
    ...over,
  };
}
const NO_SIGNALS: GroupSearchSignals = {};
const NO_PREFS: UiDisclosurePrefs = { revealAll: false, overrides: {} };

test("guardrail: baseline cluster is always foreground, regardless of footprint", () => {
  const fg = computeForeground(inputs(), NO_SIGNALS);
  for (const b of BASELINE_MODULES) assert.ok(fg.has(b), `${b} must be foreground`);
  // and a totally empty-footprint member still gets the doors to power
  for (const door of ["governance", "petitions", "concerns", "responsibilities"] as const) assert.ok(fg.has(door));
});

test("guardrail: participation never changes possible or foreground (eligibility only)", () => {
  const base = inputs({ participation: "active" });
  const quiet = inputs({ participation: "quiet" });
  const dormant = inputs({ participation: "dormant" });
  const fgA = [...computeForeground(base, NO_SIGNALS)].sort();
  const fgQ = [...computeForeground(quiet, NO_SIGNALS)].sort();
  const fgD = [...computeForeground(dormant, NO_SIGNALS)].sort();
  assert.deepEqual(fgA, fgQ);
  assert.deepEqual(fgA, fgD);
  const vA = resolveGroupView(base, NO_SIGNALS, NO_PREFS);
  const vD = resolveGroupView(dormant, NO_SIGNALS, NO_PREFS);
  assert.deepEqual([...vA.possible], [...vD.possible]);
  assert.deepEqual([...vA.present].sort(), [...vD.present].sort());
});

test("guardrail: every module is possible for a member (the map is whole), incl. latent node-stewardship", () => {
  const v = resolveGroupView(inputs(), NO_SIGNALS, NO_PREFS);
  assert.deepEqual([...v.possible].sort(), [...MODULE_IDS].sort());
  assert.ok(v.possible.includes("node-stewardship")); // latent stewardship visible before held
  assert.equal(v.cards.length, MODULE_IDS.length);
});

test("contextual modules foreground from relational footprint and group-state", () => {
  const v = resolveGroupView(
    inputs({
      groupProjectIds: new Set(["p1"]),
      groupCoalitionIds: new Set(["c1"]),
      hasCategories: true,
      hasTrustedProviders: true,
      hasLibraryContent: true,
      isNodeSteward: true,
      authoredDiscussionThread: true,
    }),
    NO_SIGNALS,
    NO_PREFS,
  );
  for (const id of ["projects", "coalitions", "contribution-categories", "trusted-providers", "library", "node-stewardship", "discussion"] as ModuleId[]) {
    assert.ok(v.present.has(id), `${id} should be present`);
  }
  // a bare group: contextual ones are NOT foreground, but still possible (in the map)
  const bare = resolveGroupView(inputs(), NO_SIGNALS, NO_PREFS);
  assert.ok(!bare.present.has("coalitions"));
  assert.ok(bare.possible.includes("coalitions"));
});

test("sub-route depth: ?discussionThread/?petitionFilter/?section foreground their module", () => {
  assert.ok(computeForeground(inputs(), { discussionThread: "t1" }).has("discussion"));
  assert.ok(computeForeground(inputs(), { section: "trusted-providers" }).has("trusted-providers"));
  assert.ok(!computeForeground(inputs(), { section: "not-a-module" }).has("trusted-providers" as ModuleId));
});

test("switches: a user can hide a baseline card; it leaves the page but stays possible/in the map", () => {
  const prefs: UiDisclosurePrefs = { revealAll: false, overrides: { g1: { governance: "hide" } } };
  const v = resolveGroupView(inputs(), NO_SIGNALS, prefs);
  assert.ok(!v.present.has("governance"), "hidden baseline card not present");
  assert.ok(v.possible.includes("governance"), "but still possible (re-addable from the map)");
  const card = v.cards.find((c) => c.id === "governance")!;
  assert.equal(card.present, false);
});

test("switches: ?section presents a hidden card transiently without changing the stored hide", () => {
  const prefs: UiDisclosurePrefs = { revealAll: false, overrides: { g1: { library: "hide" } } };
  const hidden = resolveGroupView(inputs(), NO_SIGNALS, prefs);
  assert.ok(!hidden.present.has("library"));
  const viaLink = resolveGroupView(inputs(), { section: "library" }, prefs);
  assert.ok(viaLink.present.has("library"), "deep link presents it (no silent no-op)");
  // the stored pref is unchanged (still a hide) — resolver is pure, prefs object untouched
  assert.equal(prefs.overrides.g1?.library, "hide");
});

test("revealAll shows all possible (still overridable per module)", () => {
  const prefs: UiDisclosurePrefs = { revealAll: true, overrides: { g1: { "trusted-providers": "hide" } } };
  const v = resolveGroupView(inputs(), NO_SIGNALS, prefs);
  assert.ok(v.present.has("coalitions"), "revealAll shows a contextual card");
  assert.ok(!v.present.has("trusted-providers"), "explicit hide still wins over revealAll");
});
