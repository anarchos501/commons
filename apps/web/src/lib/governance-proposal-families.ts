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
  // Inter-node federation (register F-5): agreement + policy families are
  // steward-group petitions; termination/disable are the node-wide STOP valves.
  | "federation_formation"
  | "federation_join"
  | "federation_departure"
  | "federation_removal"
  | "federation_policy_change"
  | "federation_termination"
  | "federation_disable"
  | "node_steward_group_nomination"
  | "node_steward_candidate_consent"
  | "node_steward_appointment"
  | "node_steward_no_confidence_initiation"
  | "node_steward_no_confidence"
  | "node_steward_resignation"
  | "node_name_change_proposal"
  | "node_name_change"
  | "responsibility_proposal"
  | "responsibility_creation_proposal"
  | "responsibility_recall"
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
  // RFC-009: per-(collective, peer-node) federated visibility grants (register D-4)
  | "federated_visibility_change"
  // F3.5 Phase 0 (C0 core): who may join the node is constitutional (node-rename precedent)
  | "registration_mode_change"
  // F3.5 continuity (register F-8/F-10): designation is the entity's own petition;
  // consent/end are steward petitions on the backup node; threshold is node-wide.
  | "backup_designation"
  | "backup_hosting_consent"
  | "backup_hosting_end"
  | "backup_size_threshold_change"
  | "backup_hosting_policy_change"
  | "backup_takeover_expedite"
  // Collective-wide settings that must be petitioned rather than flipped by one member.
  | "custom_support_requests_toggle"
  | "membership_policy_change"
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
  // Steward-group petitions ride the steward group's own group_settings
  // params, exactly like coalition_* — deliberately NOT a new constitutional
  // category (register F-5: starting is delegated, only stopping is node-wide).
  federation_formation: "group_settings",
  federation_join: "group_settings",
  federation_departure: "group_settings",
  federation_removal: "group_settings",
  federation_policy_change: "group_settings",
  // Node-wide STOP valves follow the node_name_change precedent.
  federation_termination: "node_stewardship",
  federation_disable: "node_stewardship",
  node_steward_group_nomination: "node_stewardship",
  node_steward_candidate_consent: "node_stewardship",
  node_steward_appointment: "node_stewardship",
  node_steward_no_confidence_initiation: "node_stewardship",
  node_steward_no_confidence: "node_stewardship",
  node_steward_resignation: "node_stewardship",
  node_name_change_proposal: "node_stewardship",
  node_name_change: "node_stewardship",
  responsibility_proposal: "responsibility",
  responsibility_creation_proposal: "responsibility",
  responsibility_recall: "responsibility",
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
  federated_visibility_change: "group_settings",
  registration_mode_change: "node_stewardship",
  backup_designation: "group_settings",
  backup_hosting_consent: "group_settings",
  backup_hosting_end: "group_settings",
  backup_size_threshold_change: "node_stewardship",
  backup_hosting_policy_change: "group_settings",
  backup_takeover_expedite: "group_settings",
  custom_support_requests_toggle: "group_settings",
  // Changing the membership model is a membership-weight decision, so it inherits the
  // group's membership thresholds/duration (per feedback #2).
  membership_policy_change: "membership",
  bulletin_creation: "publishing",
  publication_creation: "publishing",
  publication_entry_creation: "publishing",
  living_document_creation: "publishing",
  event_authorization: "coordination",
};

// Runtime enumeration of every ProposalFamily. Derived from FAMILY_TO_CATEGORY, which
// TypeScript already forces to be exhaustive over the union — so this list cannot drift
// from the type. Used by the petition-detail coverage test.
export const PROPOSAL_FAMILIES = Object.keys(FAMILY_TO_CATEGORY) as ProposalFamily[];

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
    // Non-competing like coalition_*: each federation proposal is independent
    // and the cross-node decisions map (not competition) resolves conflicts.
    case "federation_formation":
    case "federation_join":
    case "federation_departure":
    case "federation_removal":
    case "node_steward_group_nomination":
    case "node_steward_candidate_consent":
    case "node_steward_no_confidence_initiation":
    case "node_steward_resignation":
    // Non-competing: any group may internally propose a node name; they escalate independently.
    case "node_name_change_proposal":
    // Non-competing: making a group public is idempotent; multiple concurrent proposals are allowed
    case "group_visibility_proposal":
    // Non-competing AND reversible: these settings flip back and forth over a group's life. A
    // non-null key would make resolveCompetingPetitions treat a previously-approved toggle as a
    // permanent "existing winner" and auto-reject every future opposite-direction petition without
    // counting votes — locking the setting forever. The partial unique indexes
    // (Petition_custom_requests_toggle_open_unique / Petition_membership_policy_change_open_unique)
    // already enforce "only one open at a time", so no competition key is needed.
    case "custom_support_requests_toggle":
    case "membership_policy_change":
    // Non-competing AND reversible (same rationale as its neighbors): stances
    // flip over a group's life; the partial unique index
    // Petition_federated_visibility_open_unique enforces one open petition per
    // (group, peer) instead of a competition key (register F-7: that index IS
    // the single-open invariant).
    case "federated_visibility_change":
    // Non-competing AND reversible, same rationale: single-open enforced by
    // DB partial indexes (register F-7), never competition keys.
    case "backup_designation":
    case "backup_hosting_consent":
    case "backup_hosting_end":
    case "backup_hosting_policy_change":
    case "backup_takeover_expedite": // single-open per replica is a DB partial index (F-7)
    // Non-competing AND reversible like the two settings above; the partial
    // unique index Petition_federation_policy_change_open_unique enforces
    // one-open-at-a-time instead of a competition key.
    case "federation_policy_change":
    // Non-competing: each event proposal is independent; coalition events open one petition
    // per member group sharing the same subjectId (proposalId) and must not compete.
    case "event_authorization":
      return null;
    case "node_steward_appointment":
      return `${groupId}:node_steward_appointment`;
    // One node-wide rename vote at a time (groupId carries the nodeId for node-scoped petitions).
    case "node_name_change":
      return `${groupId}:node_name_change`;
    // One node-wide registration-mode vote at a time (same precedent).
    case "registration_mode_change":
      return `${groupId}:registration_mode_change`;
    // One node-wide threshold vote at a time (same precedent; DB partial index
    // is the real single-open invariant — register F-7).
    case "backup_size_threshold_change":
      return `${groupId}:backup_size_threshold_change`;
    case "node_steward_no_confidence":
      return `${groupId}:node_steward_no_confidence:${subjectId}`;
    // One node-wide termination vote per agreement, one disable vote per node
    // at a time (groupId carries the nodeId for node-scoped petitions).
    case "federation_termination":
      return `${groupId}:federation_termination:${subjectId}`;
    case "federation_disable":
      return `${groupId}:federation_disable`;
    // All others: groupId:family:subjectId is unique per decision within a group
    default:
      return `${groupId}:${family}:${subjectId}`;
  }
}
