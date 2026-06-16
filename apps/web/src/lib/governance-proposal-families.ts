import type { GovernanceCategory } from "./governance-categories";

export type ProposalFamily =
  | "membership_request"
  | "project_proposal"
  | "project_hosting_withdrawal"
  | "project_hosting_offer"
  | "project_hosting_acceptance"
  | "coalition_formation"
  | "coalition_join"
  | "coalition_departure"
  | "coalition_removal"
  | "node_steward_group_nomination"
  | "node_steward_candidate_consent"
  | "node_steward_appointment"
  | "node_steward_no_confidence_initiation"
  | "node_steward_no_confidence"
  | "node_steward_resignation"
  | "responsibility_proposal"
  | "responsibility_creation_proposal"
  | "accountability_action"
  | "living_document_revision"
  // Fix 2: archive_proposal split into target-typed families so the approved handler
  // is unambiguous even when IDs are not globally unique across content tables.
  | "bulletin_archive"
  | "publication_archive"
  | "publication_entry_archive"
  | "living_document_archive"
  | "emergency_declaration"
  | "discussion_thread_close"
  | "collective_support_request"
  | "collective_contribution_offer"
  // RFC: Contribution Categories & Trusted Provider Status
  | "contribution_category_proposal"
  | "contribution_category_archive"
  | "trusted_provider_proposal"
  | "trusted_provider_revocation"
  // RFC: Private-By-Default Groups
  | "group_visibility_proposal"
  // RFC: Governed Publishing
  | "bulletin_creation"
  | "publication_creation"
  | "publication_entry_creation"
  | "living_document_creation"
  // RFC-008: Coordination Events & Shared Calendars
  | "event_authorization";

const FAMILY_TO_CATEGORY: Record<ProposalFamily, GovernanceCategory> = {
  membership_request: "membership",
  project_proposal: "project",
  project_hosting_withdrawal: "project",
  project_hosting_offer: "project",
  project_hosting_acceptance: "project",
  coalition_formation: "group_settings",
  coalition_join: "group_settings",
  coalition_departure: "group_settings",
  coalition_removal: "group_settings",
  node_steward_group_nomination: "node_stewardship",
  node_steward_candidate_consent: "node_stewardship",
  node_steward_appointment: "node_stewardship",
  node_steward_no_confidence_initiation: "node_stewardship",
  node_steward_no_confidence: "node_stewardship",
  node_steward_resignation: "node_stewardship",
  responsibility_proposal: "responsibility",
  responsibility_creation_proposal: "responsibility",
  accountability_action: "accountability",
  living_document_revision: "living_document",
  bulletin_archive: "archival",
  publication_archive: "archival",
  publication_entry_archive: "archival",
  living_document_archive: "archival",
  emergency_declaration: "emergency",
  discussion_thread_close: "discussion",
  collective_support_request: "support_request",
  collective_contribution_offer: "contribution_offer",
  contribution_category_proposal: "contribution_category",
  contribution_category_archive: "contribution_category",
  trusted_provider_proposal: "trusted_provider",
  trusted_provider_revocation: "trusted_provider",
  group_visibility_proposal: "group_settings",
  bulletin_creation: "publishing",
  publication_creation: "publishing",
  publication_entry_creation: "publishing",
  living_document_creation: "publishing",
  event_authorization: "coordination",
};

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
    // Non-competing: idempotent handlers prevent duplicates for categories and trusted provider status
    case "contribution_category_proposal":
    case "contribution_category_archive":
    case "trusted_provider_proposal":
    case "trusted_provider_revocation":
    case "project_hosting_withdrawal":
    case "project_hosting_offer":
    case "project_hosting_acceptance":
    case "coalition_formation":
    case "coalition_join":
    case "coalition_departure":
    case "coalition_removal":
    case "node_steward_group_nomination":
    case "node_steward_candidate_consent":
    case "node_steward_no_confidence_initiation":
    case "node_steward_resignation":
    // Non-competing: making a group public is idempotent; multiple concurrent proposals are allowed
    case "group_visibility_proposal":
    // Non-competing: each event proposal is independent; coalition events open one petition
    // per member group sharing the same subjectId (proposalId) and must not compete.
    case "event_authorization":
      return null;
    case "node_steward_appointment":
      return `${groupId}:node_steward_appointment`;
    case "node_steward_no_confidence":
      return `${groupId}:node_steward_no_confidence:${subjectId}`;
    // All others: groupId:family:subjectId is unique per decision within a group
    default:
      return `${groupId}:${family}:${subjectId}`;
  }
}
