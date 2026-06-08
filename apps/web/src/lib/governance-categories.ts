export type GovernanceCategory =
  | "membership"
  | "project"
  | "responsibility"
  | "accountability"
  | "living_document"
  | "archival"
  | "support_request"
  | "contribution_offer"
  | "emergency"
  | "discussion"
  | "contribution_category"
  | "trusted_provider"
  | "group_settings"
  | "publishing"
  | "participation"
  | "node_stewardship";

export const GOVERNANCE_CATEGORIES: readonly GovernanceCategory[] = [
  "membership",
  "project",
  "responsibility",
  "accountability",
  "living_document",
  "archival",
  "support_request",
  "contribution_offer",
  "emergency",
  "discussion",
  "contribution_category",
  "trusted_provider",
  "group_settings",
  "publishing",
  "participation",
  "node_stewardship",
] as const;

export function isGovernanceCategory(value: string): value is GovernanceCategory {
  return (GOVERNANCE_CATEGORIES as readonly string[]).includes(value);
}

export const GOVERNANCE_CATEGORY_DESCRIPTIONS: Record<GovernanceCategory, string> = {
  membership: "Affects petitions to approve new members when a collective requires membership approval.",
  project: "Affects project creation, host withdrawal, and proposals for a collective to begin or accept hosting a project.",
  responsibility: "Affects creating responsibilities, confirming volunteers, and how often responsibility holders must be reconfirmed.",
  accountability: "Affects petitions proposing actions in response to substantiated accountability concerns.",
  living_document: "Affects approval of revisions to existing living documents.",
  archival: "Affects petitions to archive bulletins, publications, publication entries, and living documents.",
  support_request: "Affects collective decisions to open or approve governed support requests.",
  contribution_offer: "Affects collective decisions to open or approve governed offers of contribution.",
  emergency: "Affects emergency declarations, including their approval threshold, petition window, and duration.",
  discussion: "Affects closing discussion threads and how long messages and inactive threads are retained.",
  contribution_category: "Affects creating and archiving the categories used to organize contributions and support.",
  trusted_provider: "Affects recognizing or revoking trusted-provider status for contribution categories.",
  group_settings: "Affects collective-wide settings such as public visibility, coalition formation, and coalition membership changes.",
  publishing: "Affects approval of new bulletins, publications, publication entries, and living documents.",
  participation: "Affects when inactive members become quiet or dormant and therefore stop counting toward active work.",
  node_stewardship: "Affects steward nomination, appointment, resignation, and no-confidence decisions. It does not govern node hosts.",
};

export function governanceCategoryDescription(category: GovernanceCategory): string {
  return GOVERNANCE_CATEGORY_DESCRIPTIONS[category];
}

// Parameter anchors: [restrictive (-1), default (0), permissive (+1)]
type NumericAnchors = [number, number, number];

type ParameterDefinition = {
  anchors: NumericAnchors;
  // Absolute bounds enforced at registry level regardless of temperature
  min?: number;
  max?: number;
};

type CategoryRegistry = {
  [C in GovernanceCategory]: Record<string, ParameterDefinition>;
};

export const CATEGORY_REGISTRY: CategoryRegistry = {
  membership: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  project: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  responsibility: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
    // Restrictive = shorter terms (more oversight); permissive = longer terms (more trust)
    reconfirmationPeriod: { anchors: [7, 14, 30], min: 3, max: 30 },
  },
  accountability: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  living_document: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  archival: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  support_request: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  contribution_offer: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  emergency: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [3, 1, 0.125] },
    // Restrictive = shorter emergencies (high-friction prefers quick resolution)
    // Permissive = longer emergencies (sustained activation tolerated)
    duration: { anchors: [7, 14, 30] },
  },
  discussion: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
    // Discussion retention is bounded: governance can shorten/lengthen, never disable expiration.
    messageRetentionDays: { anchors: [7, 30, 90], min: 1, max: 90 },
    threadInactivityDays: { anchors: [7, 14, 30], min: 1, max: 30 },
  },
  // RFC: Contribution Categories & Trusted Provider Status
  contribution_category: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  trusted_provider: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  // RFC: Private-By-Default Groups
  group_settings: {
    threshold: { anchors: [0.95, 0.50, 0.05] },
    petitionDuration: { anchors: [7, 3, 1] },
  },
  publishing: {
    threshold: { anchors: [0.95, 0.50, 0.05], min: 0.1, max: 1.0 },
    petitionDuration: { anchors: [7, 3, 1], min: 1, max: 30 },
  },
  participation: {
    threshold: { anchors: [0.95, 0.50, 0.05], min: 0.1, max: 1.0 },
    petitionDuration: { anchors: [7, 3, 1], min: 1, max: 30 },
    quietThresholdDays: { anchors: [30, 90, 180], min: 14, max: 365 },
    dormantThresholdDays: { anchors: [180, 365, 730], min: 90, max: 1825 },
  },
  node_stewardship: {
    threshold: { anchors: [0.95, 0.50, 0.05], min: 0.05, max: 1.0 },
    petitionDuration: { anchors: [7, 3, 1], min: 1, max: 30 },
    noConfidenceThreshold: { anchors: [0.95, 0.667, 0.50], min: 0.50, max: 1.0 },
  },
};

export function isGovernanceParameter(category: GovernanceCategory, parameter: string): boolean {
  return parameter === "_" || parameter in CATEGORY_REGISTRY[category];
}

export type ResolvedCategoryParams = {
  threshold: number;
  petitionDuration: number;
  reconfirmationPeriod?: number;
  duration?: number;
  messageRetentionDays?: number;
  threadInactivityDays?: number;
  quietThresholdDays?: number;
  dormantThresholdDays?: number;
  noConfidenceThreshold?: number;
};

// Piecewise linear interpolation between three anchor points.
// At temp=0 returns default; at temp=-1 returns restrictive; at temp=+1 returns permissive.
function interpolate(anchors: NumericAnchors, temperature: number): number {
  const [restrictive, defaultVal, permissive] = anchors;
  const t = Math.max(-1, Math.min(1, temperature));
  if (t >= 0) {
    return defaultVal + t * (permissive - defaultVal);
  } else {
    return restrictive + (t + 1) * (defaultVal - restrictive);
  }
}

export function resolveParameter(
  category: GovernanceCategory,
  parameter: string,
  temperature: number,
): number {
  const categoryDef = CATEGORY_REGISTRY[category];
  const paramDef = categoryDef[parameter];
  if (!paramDef) {
    throw new Error(`Unknown parameter "${parameter}" for category "${category}"`);
  }
  const raw = interpolate(paramDef.anchors, temperature);
  const clamped = paramDef.min !== undefined ? Math.max(paramDef.min, raw) : raw;
  return paramDef.max !== undefined ? Math.min(paramDef.max, clamped) : clamped;
}

export function resolveAllParameters(
  category: GovernanceCategory,
  temperature: number,
): ResolvedCategoryParams {
  return resolveAllParametersWithIndividualTemps(category, new Map([["_", temperature]]));
}

export function resolveAllParametersWithIndividualTemps(
  category: GovernanceCategory,
  temperatures: Map<string, number>,
): ResolvedCategoryParams {
  const categoryDef = CATEGORY_REGISTRY[category];
  const result: Record<string, number> = {};
  const categoryTemperature = temperatures.get("_") ?? 0;
  for (const param of Object.keys(categoryDef)) {
    result[param] = resolveParameter(category, param, temperatures.get(param) ?? categoryTemperature);
  }
  return result as unknown as ResolvedCategoryParams;
}

// Validates that a parsed governanceSnapshot JSON has the required shape for a category.
export function validateGovernanceSnapshot(
  category: GovernanceCategory,
  snapshot: unknown,
): snapshot is ResolvedCategoryParams {
  if (!snapshot || typeof snapshot !== "object") return false;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.threshold !== "number" || typeof s.petitionDuration !== "number") return false;
  if (category === "responsibility" && typeof s.reconfirmationPeriod !== "number") return false;
  if (category === "emergency" && typeof s.duration !== "number") return false;
  if (
    category === "discussion" &&
    (typeof s.messageRetentionDays !== "number" || typeof s.threadInactivityDays !== "number")
  ) return false;
  if (category === "node_stewardship" && typeof s.noConfidenceThreshold !== "number") return false;
  return true;
}
