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
  | "discussion";

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
] as const;

export function isGovernanceCategory(value: string): value is GovernanceCategory {
  return (GOVERNANCE_CATEGORIES as readonly string[]).includes(value);
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
    threshold: { anchors: [0.80, 0.60, 0.40] },
    petitionDuration: { anchors: [14, 7, 3] },
  },
  project: {
    threshold: { anchors: [0.80, 0.60, 0.40] },
    petitionDuration: { anchors: [28, 14, 7] },
  },
  responsibility: {
    threshold: { anchors: [0.70, 0.50, 0.30] },
    petitionDuration: { anchors: [14, 7, 3] },
    // Restrictive = shorter terms (more oversight); permissive = longer terms (more trust)
    reconfirmationPeriod: { anchors: [90, 365, 730], min: 30, max: 730 },
  },
  accountability: {
    threshold: { anchors: [0.85, 0.70, 0.55] },
    petitionDuration: { anchors: [21, 14, 7] },
  },
  living_document: {
    threshold: { anchors: [0.80, 0.60, 0.40] },
    petitionDuration: { anchors: [21, 14, 7] },
  },
  archival: {
    threshold: { anchors: [0.80, 0.60, 0.40] },
    petitionDuration: { anchors: [14, 7, 3] },
  },
  support_request: {
    threshold: { anchors: [0.70, 0.50, 0.30] },
    petitionDuration: { anchors: [14, 7, 3] },
  },
  contribution_offer: {
    threshold: { anchors: [0.70, 0.50, 0.30] },
    petitionDuration: { anchors: [14, 7, 3] },
  },
  emergency: {
    threshold: { anchors: [0.90, 0.80, 0.65] },
    petitionDuration: { anchors: [5, 3, 1] },
    // Restrictive = shorter emergencies (high-friction prefers quick resolution)
    // Permissive = longer emergencies (sustained activation tolerated)
    duration: { anchors: [14, 30, 60] },
  },
  discussion: {
    threshold: { anchors: [0.75, 0.55, 0.35] },
    petitionDuration: { anchors: [14, 7, 3] },
    // Discussion retention is bounded: governance can shorten/lengthen, never disable expiration.
    messageRetentionDays: { anchors: [7, 30, 90], min: 1, max: 90 },
    threadInactivityDays: { anchors: [14, 60, 180], min: 1, max: 180 },
  },
};

export type ResolvedCategoryParams = {
  threshold: number;
  petitionDuration: number;
  reconfirmationPeriod?: number;
  duration?: number;
  messageRetentionDays?: number;
  threadInactivityDays?: number;
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
  const categoryDef = CATEGORY_REGISTRY[category];
  const result: Record<string, number> = {};
  for (const [param, def] of Object.entries(categoryDef)) {
    const raw = interpolate(def.anchors, temperature);
    const clamped = def.min !== undefined ? Math.max(def.min, raw) : raw;
    result[param] = def.max !== undefined ? Math.min(def.max, clamped) : clamped;
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
  return true;
}
