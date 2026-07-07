import { MODULE_IDS, BASELINE_MODULES, MODULE_LABELS, moduleTier, isModuleId, type ModuleId, type ModuleTier } from "./group-modules";
import { type UiDisclosurePrefs } from "./ui-disclosure";
import { computePresentAndCards } from "./disclosure-view-core";
import type { ViewerSpaces } from "./events";

// Pure resolver for the group workspace's progressive disclosure. Separates *what can exist*
// (possible), *what's foreground by default* (relational footprint + sub-route depth), and *what's
// actually present* (override ?? foreground, with ?section presenting transiently). It reads only
// relational facts + route signals + the user's switches — NEVER participation (eligibility only)
// and NEVER any behavioral log.

export type GroupStanding = "member"; // guest | applicant are future (the page is members-only today)

export type GroupViewInputs = {
  groupId: string;
  standing: GroupStanding;
  participation: "active" | "quiet" | "dormant"; // carried for write-affordance gating ONLY
  viewer: ViewerSpaces; // the viewer's own membership/seat/coalition/project id sets
  // This-group existence + relational facts (cheap, batched in getGroupCore):
  groupResponsibilityIds: ReadonlySet<string>;
  groupProjectIds: ReadonlySet<string>; // active hosted projects of this group
  groupCoalitionIds: ReadonlySet<string>; // active coalitions this group belongs to
  hasReviewerRole: boolean;
  filedConcern: boolean;
  partyToOpenPetition: boolean;
  authoredDiscussionThread: boolean;
  hasCategories: boolean;
  hasTrustedProviders: boolean;
  hasLibraryContent: boolean;
  isNodeSteward: boolean; // nodeState.stewardGroupId === groupId
  hasFederatedPeers: boolean; // any FederatedNode rows exist for this node
};

export type GroupSearchSignals = {
  section?: string | null;
  discussionThread?: string | null;
  petitionFilter?: string | null;
};

export type CapabilityCard = { id: ModuleId; label: string; tier: ModuleTier; present: boolean };

export type GroupView = {
  standing: GroupStanding;
  participation: GroupViewInputs["participation"];
  possible: readonly ModuleId[]; // always the full set for a member → the RoomsMap is whole
  foreground: ReadonlySet<ModuleId>; // surfaced by default (no overrides applied)
  present: ReadonlySet<ModuleId>; // effective: override ?? foreground, with ?section transient
  cards: CapabilityCard[]; // for the RoomsMap: every possible capability + its current presence
};

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/**
 * The default foreground: the baseline cluster (always) plus contextual modules surfaced by the
 * viewer's relational footprint or a targeting search param. Crucially does NOT read participation.
 */
export function computeForeground(inputs: GroupViewInputs, signals: GroupSearchSignals): Set<ModuleId> {
  const fg = new Set<ModuleId>(BASELINE_MODULES);

  // Relational footprint → contextual modules.
  if (inputs.groupProjectIds.size > 0 || intersects(inputs.viewer.projectIds, inputs.groupProjectIds)) fg.add("projects");
  if (inputs.groupCoalitionIds.size > 0 || intersects(inputs.viewer.coalitionIds, inputs.groupCoalitionIds)) fg.add("coalitions");
  if (inputs.authoredDiscussionThread) fg.add("discussion");
  if (inputs.hasLibraryContent) fg.add("library");
  if (inputs.isNodeSteward) fg.add("node-stewardship");
  if (inputs.hasFederatedPeers) fg.add("federation");
  if (inputs.hasCategories) fg.add("contribution-categories");
  if (inputs.hasTrustedProviders) fg.add("trusted-providers");
  // (responsibilities/concerns/petitions are baseline — always present regardless of footprint.)

  // Sub-route depth (server-readable signals only).
  if (signals.discussionThread) fg.add("discussion");
  if (signals.petitionFilter) fg.add("petitions");
  if (signals.section && isModuleId(signals.section)) fg.add(signals.section);

  return fg;
}

export function resolveGroupView(inputs: GroupViewInputs, signals: GroupSearchSignals, prefs: UiDisclosurePrefs): GroupView {
  // Members-only today: every module is possible (the project/coalition *list* is gated inside the
  // module, but the module — and its propose affordance — is always offerable in the map).
  const possible = MODULE_IDS;
  const foreground = computeForeground(inputs, signals);
  const { present, cards } = computePresentAndCards(
    MODULE_IDS,
    inputs.groupId,
    foreground,
    prefs,
    signals.section,
    MODULE_LABELS,
    moduleTier,
  );
  return { standing: inputs.standing, participation: inputs.participation, possible, foreground, present, cards };
}
