import {
  HOME_MODULE_IDS,
  HOME_BASELINE_MODULES,
  HOME_MODULE_LABELS,
  homeModuleTier,
  isHomeModuleId,
  type HomeModuleId,
} from "./home-modules";
import { type UiDisclosurePrefs } from "./ui-disclosure";
import { computePresentAndCards, type DisclosureCard } from "./disclosure-view-core";
import type { ViewerSpaces } from "./events";

// Pure resolver for the person-centric home (/dashboard). The same separation as the group resolver:
// *what can exist* (possible — always the whole set; the map is whole), *what's foreground by default*
// (the baseline floor + your relational footprint across spaces + sub-route depth), and *what's
// actually present* (override ?? foreground, with ?section presenting transiently). Reads ONLY
// relational facts + route signals + the user's switches — never participation, never any behavioral
// log. Lifts resolveGroupView's machinery up a level: spaces become a layer, you are the subject.

export type HomeViewInputs = {
  viewer: ViewerSpaces; // the viewer's cross-space footprint (group/project/coalition/seat id sets)
  // Cheap existence facts for the contextual thread modules (batched in getHomeCore):
  hasMadeRequests: boolean; // made ≥1 support request OR has accepted routes
  partyToPetition: boolean; // created/supported/node-supported ≥1 petition
  filedConcern: boolean; // filed ≥1 report (reportedByAccountId)
  hasPendingApplications: boolean; // ≥1 pending group/project application
  hasCatchUp: boolean; // the cheap hasCatchUpSince proxy — any space has activity since lastSeenAt
};

export type HomeSearchSignals = {
  section?: string | null; // ?section=<homeModuleId> deep-link → present that card
};

export type HomeView = {
  possible: readonly HomeModuleId[]; // always the full set → the home map is whole
  foreground: ReadonlySet<HomeModuleId>; // surfaced by default (no overrides applied)
  present: ReadonlySet<HomeModuleId>; // effective: override ?? foreground, with ?section transient
  cards: DisclosureCard<HomeModuleId>[]; // for the home map: every capability + its current presence
};

/**
 * The default home foreground: the baseline cluster (always) plus the contextual thread modules
 * surfaced by the viewer's relational footprint across spaces or a targeting search param. Crucially
 * does NOT read participation — your standing in any space changes eligibility, never findability.
 */
export function computeHomeForeground(inputs: HomeViewInputs, signals: HomeSearchSignals): Set<HomeModuleId> {
  const fg = new Set<HomeModuleId>(HOME_BASELINE_MODULES);

  // Relational footprint across spaces → your thread modules.
  if (inputs.viewer.projectIds.size > 0) fg.add("my-projects");
  if (inputs.hasMadeRequests) fg.add("my-requests");
  if (inputs.partyToPetition) fg.add("my-petitions");
  if (inputs.filedConcern) fg.add("my-concerns");
  if (inputs.viewer.responsibilityIds.size > 0) fg.add("my-seats");
  if (inputs.hasPendingApplications) fg.add("applications");
  if (inputs.hasCatchUp) fg.add("catch-up");

  // Sub-route depth (server-readable signal only).
  if (signals.section && isHomeModuleId(signals.section)) fg.add(signals.section);

  return fg;
}

export function resolveHomeView(inputs: HomeViewInputs, signals: HomeSearchSignals, prefs: UiDisclosurePrefs): HomeView {
  const possible = HOME_MODULE_IDS;
  const foreground = computeHomeForeground(inputs, signals);
  const { present, cards } = computePresentAndCards(
    HOME_MODULE_IDS,
    "home",
    foreground,
    prefs,
    signals.section,
    HOME_MODULE_LABELS,
    homeModuleTier,
  );
  return { possible, foreground, present, cards };
}
