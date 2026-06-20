// Canonical capability-module identifiers for the group workspace. Pure constants/types so both
// the disclosure lib (src/lib/ui-disclosure.ts) and the app-side module registry can share them
// without an app→lib import cycle.

export const MODULE_IDS = [
  "overview",
  "members",
  "governance",
  "calendar",
  "petitions",
  "responsibilities",
  "concerns",
  "discussion",
  "library",
  "projects",
  "coalitions",
  "node-stewardship",
  "contribution-categories",
  "trusted-providers",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleTier = "baseline" | "contextual";

// Baseline cluster: the egalitarian floor + the doors to power and sanction. Present by default for
// every member regardless of footprint (never trigger-gated); a user may still hide one via their
// own switch, but it always stays listed in the RoomsMap.
export const BASELINE_MODULES: readonly ModuleId[] = [
  "overview",
  "members",
  "governance",
  "calendar",
  "petitions",
  "responsibilities",
  "concerns",
] as const;

export const CONTEXTUAL_MODULES: readonly ModuleId[] = MODULE_IDS.filter(
  (id) => !BASELINE_MODULES.includes(id),
);

export function moduleTier(id: ModuleId): ModuleTier {
  return BASELINE_MODULES.includes(id) ? "baseline" : "contextual";
}

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

// Human labels for the RoomsMap and any module headers.
export const MODULE_LABELS: Record<ModuleId, string> = {
  overview: "Overview",
  members: "Members",
  governance: "Governance",
  calendar: "Calendar",
  petitions: "Petitions",
  responsibilities: "Responsibilities",
  concerns: "Concerns",
  discussion: "Discussion",
  library: "Library",
  projects: "Projects",
  coalitions: "Coalitions",
  "node-stewardship": "Node governance",
  "contribution-categories": "Contribution categories",
  "trusted-providers": "Trusted providers",
};
