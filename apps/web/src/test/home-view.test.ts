import assert from "node:assert/strict";
import test from "node:test";
import { resolveHomeView, computeHomeForeground, type HomeViewInputs, type HomeSearchSignals } from "../lib/home-view";
import { HOME_BASELINE_MODULES, HOME_MODULE_IDS, HOME_MODULE_LABELS, type HomeModuleId } from "../lib/home-modules";
import { resolveEffectiveVisibility, type UiDisclosurePrefs } from "../lib/ui-disclosure";
import type { ViewerSpaces } from "../lib/events";

// Pure-function guardrail tests — no DB needed. Parallels group-view.test.ts.

const viewer = (over: Partial<ViewerSpaces> = {}): ViewerSpaces => ({
  accountId: "a1",
  groupIds: new Set(),
  projectIds: new Set(),
  coalitionIds: new Set(),
  responsibilityIds: new Set(),
  ...over,
});

function inputs(over: Partial<HomeViewInputs> = {}): HomeViewInputs {
  return {
    viewer: viewer(),
    hasMadeRequests: false,
    partyToPetition: false,
    filedConcern: false,
    hasPendingApplications: false,
    hasCatchUp: false,
    ...over,
  };
}
const NO_SIGNALS: HomeSearchSignals = {};
const NO_PREFS: UiDisclosurePrefs = { revealAll: false, overrides: {} };

test("guardrail 2: baseline cluster is always foreground, regardless of footprint", () => {
  const fg = computeHomeForeground(inputs(), NO_SIGNALS);
  for (const b of HOME_BASELINE_MODULES) assert.ok(fg.has(b), `${b} must be foreground`);
  // collectives is baseline — a dormant member's way back into their spaces is always present
  assert.ok(fg.has("collectives"));
});

test("guardrail 1: every home module is possible (the map is whole), incl. latent thread modules", () => {
  const v = resolveHomeView(inputs(), NO_SIGNALS, NO_PREFS);
  assert.deepEqual([...v.possible].sort(), [...HOME_MODULE_IDS].sort());
  assert.ok(v.possible.includes("my-petitions")); // latent before held
  assert.equal(v.cards.length, HOME_MODULE_IDS.length);
});

test("guardrail 3: contextual thread modules foreground from cross-space footprint", () => {
  const v = resolveHomeView(
    inputs({
      viewer: viewer({ projectIds: new Set(["p1"]), responsibilityIds: new Set(["r1"]) }),
      hasMadeRequests: true,
      partyToPetition: true,
      filedConcern: true,
      hasPendingApplications: true,
    }),
    NO_SIGNALS,
    NO_PREFS,
  );
  for (const id of ["my-projects", "my-requests", "my-petitions", "my-concerns", "my-seats", "applications"] as HomeModuleId[]) {
    assert.ok(v.present.has(id), `${id} should be present from footprint`);
  }
  // a bare account: contextual ones are NOT foreground, but still possible (in the map)
  const bare = resolveHomeView(inputs(), NO_SIGNALS, NO_PREFS);
  assert.ok(!bare.present.has("my-projects"));
  assert.ok(bare.possible.includes("my-projects"));
});

test("guardrail 7: catch-up foreground follows the hasCatchUp proxy", () => {
  assert.ok(!resolveHomeView(inputs({ hasCatchUp: false }), NO_SIGNALS, NO_PREFS).present.has("catch-up"));
  assert.ok(resolveHomeView(inputs({ hasCatchUp: true }), NO_SIGNALS, NO_PREFS).present.has("catch-up"));
});

test("guardrail 5: ?section foregrounds its module; invalid section ignored", () => {
  assert.ok(computeHomeForeground(inputs(), { section: "my-petitions" }).has("my-petitions"));
  assert.ok(!computeHomeForeground(inputs(), { section: "not-a-module" }).has("my-petitions" as HomeModuleId));
});

test("guardrail 2: a user can hide a baseline card; it leaves the page but stays possible/in the map", () => {
  const prefs: UiDisclosurePrefs = { revealAll: false, overrides: { home: { calendar: "hide" } } };
  const v = resolveHomeView(inputs(), NO_SIGNALS, prefs);
  assert.ok(!v.present.has("calendar"), "hidden baseline card not present");
  assert.ok(v.possible.includes("calendar"), "but still possible (re-addable from the map)");
  assert.equal(v.cards.find((c) => c.id === "calendar")!.present, false);
});

test("guardrail 5: ?section presents a hidden card transiently without changing the stored hide", () => {
  const prefs: UiDisclosurePrefs = { revealAll: false, overrides: { home: { "my-projects": "hide" } } };
  const hidden = resolveHomeView(inputs({ viewer: viewer({ projectIds: new Set(["p1"]) }) }), NO_SIGNALS, prefs);
  assert.ok(!hidden.present.has("my-projects"));
  const viaLink = resolveHomeView(inputs({ viewer: viewer({ projectIds: new Set(["p1"]) }) }), { section: "my-projects" }, prefs);
  assert.ok(viaLink.present.has("my-projects"), "deep link presents it (no silent no-op)");
  assert.equal(prefs.overrides.home?.["my-projects"], "hide", "stored hide unchanged (pure resolver)");
});

test("guardrail 6: override precedence — home scope wins over global, then revealAll", () => {
  // home "hide" beats global "show"
  const p1: UiDisclosurePrefs = { revealAll: false, overrides: { home: { "my-seats": "hide" }, global: { "my-seats": "show" } } };
  assert.ok(!resolveHomeView(inputs({ viewer: viewer({ responsibilityIds: new Set(["r1"]) }) }), NO_SIGNALS, p1).present.has("my-seats"));
  // global "hide" with no home override hides a baseline card
  const p2: UiDisclosurePrefs = { revealAll: false, overrides: { global: { notifications: "hide" } } };
  assert.ok(!resolveHomeView(inputs(), NO_SIGNALS, p2).present.has("notifications"));
  // revealAll shows a contextual card, but an explicit home hide still wins
  const p3: UiDisclosurePrefs = { revealAll: true, overrides: { home: { "my-concerns": "hide" } } };
  const v3 = resolveHomeView(inputs(), NO_SIGNALS, p3);
  assert.ok(v3.present.has("my-petitions"), "revealAll shows a contextual card");
  assert.ok(!v3.present.has("my-concerns"), "explicit hide beats revealAll");
});

test("guardrail 4: no gamification — home labels carry no unlock/progress/streak wording", () => {
  const banned = /unlock|progress|streak|level|badge|points|achiev|reward|xp\b/i;
  for (const id of HOME_MODULE_IDS) {
    assert.ok(!banned.test(HOME_MODULE_LABELS[id]), `label for ${id} ("${HOME_MODULE_LABELS[id]}") must not gamify`);
  }
});

test("guardrail 8: obligation guard — the Active strip label carries no debt/waiting wording", () => {
  const obligation = /wait|owe|overdue|\bdue\b|debt|behind|on you|required|must\b/i;
  assert.ok(!obligation.test(HOME_MODULE_LABELS["active-threads"]), "the Active strip must not read as an obligation");
  assert.equal(HOME_MODULE_LABELS["active-threads"], "Active");
});

test("guardrail 6: foreground is a pure function of footprint + signals (no behavioral input)", () => {
  const a = [...computeHomeForeground(inputs({ hasMadeRequests: true }), NO_SIGNALS)].sort();
  const b = [...computeHomeForeground(inputs({ hasMadeRequests: true }), NO_SIGNALS)].sort();
  assert.deepEqual(a, b);
  // and the transient-flag formula the loader uses: a ?section-shown hidden card resolves to "hide"
  // without the section param (so it is detectably hidden-in-settings)
  const prefs: UiDisclosurePrefs = { revealAll: false, overrides: { home: { "my-projects": "hide" } } };
  const fg = computeHomeForeground(inputs(), { section: "my-projects" });
  assert.equal(resolveEffectiveVisibility("my-projects", "home", fg, prefs), "hide");
});
