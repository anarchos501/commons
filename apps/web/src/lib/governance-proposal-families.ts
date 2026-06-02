import type { GovernanceCategory } from "./governance-categories";

export type ProposalFamily =
  | "membership_request"
  | "project_proposal"
  | "responsibility_proposal"
  | "accountability_action"
  | "living_document_revision"
  // Fix 2: archive_proposal split into target-typed families so the approved handler
  // is unambiguous even when IDs are not globally unique across content tables.
  | "bulletin_archive"
  | "publication_archive"
  | "publication_entry_archive"
  | "living_document_archive"
  | "emergency_declaration"
  | "collective_support_request"
  | "collective_contribution_offer";

const FAMILY_TO_CATEGORY: Record<ProposalFamily, GovernanceCategory> = {
  membership_request: "membership",
  project_proposal: "project",
  responsibility_proposal: "responsibility",
  accountability_action: "accountability",
  living_document_revision: "living_document",
  bulletin_archive: "archival",
  publication_archive: "archival",
  publication_entry_archive: "archival",
  living_document_archive: "archival",
  emergency_declaration: "emergency",
  collective_support_request: "support_request",
  collective_contribution_offer: "contribution_offer",
};

const ALL_FAMILIES = Object.keys(FAMILY_TO_CATEGORY) as ProposalFamily[];

export function isProposalFamily(value: string): value is ProposalFamily {
  return value in FAMILY_TO_CATEGORY;
}

export function categoryForFamily(family: ProposalFamily): GovernanceCategory {
  return FAMILY_TO_CATEGORY[family];
}

// Fix 1: competitionKey includes groupId to prevent petitions in different groups
// from competing with each other via a shared subjectId.
// Returns null for non-competing families (responsibility, emergency).
export function deriveCompetitionKey(
  family: ProposalFamily,
  subjectId: string,
  groupId: string,
): string | null {
  switch (family) {
    // Non-competing: multiple responsibility confirmations coexist (multi-holder by design)
    case "responsibility_proposal":
    // Non-competing: emergency periods are managed by EmergencyPeriod model, not competition
    case "emergency_declaration":
      return null;
    // All others: groupId:family:subjectId is unique per decision within a group
    default:
      return `${groupId}:${family}:${subjectId}`;
  }
}

export { ALL_FAMILIES };
