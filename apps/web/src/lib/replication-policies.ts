export type DataClass =
  | "offline_draft"
  | "personal_note"
  | "local_reminder"
  | "private_availability"
  | "cached_coordination_history"
  | "sync_queue_item"
  | "support_request"
  | "offer"
  | "contribution"
  | "proposal"
  | "governance_preference"
  | "portable_identity"
  | "linked_node_presence";

export type ReplicationPolicy = {
  dataClass: DataClass;
  nodeStorage: "none" | "temporary" | "canonical" | "reference";
  localStorage: "none" | "cache" | "draft" | "private_data" | "sync_queue";
  federationAllowed: boolean;
  p2pAllowed: boolean;
  retentionDays: number | null;
  requiresEncryption: boolean;
  userExportAllowed: boolean;
  userDeletionAllowed: boolean;
  syncRequiresConsent: boolean;
};

export const defaultReplicationPolicies: ReplicationPolicy[] = [
  {
    dataClass: "offline_draft",
    nodeStorage: "none",
    localStorage: "draft",
    federationAllowed: false,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: true,
    userExportAllowed: true,
    userDeletionAllowed: true,
    syncRequiresConsent: true,
  },
  {
    dataClass: "personal_note",
    nodeStorage: "none",
    localStorage: "private_data",
    federationAllowed: false,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: true,
    userExportAllowed: true,
    userDeletionAllowed: true,
    syncRequiresConsent: true,
  },
  {
    dataClass: "support_request",
    nodeStorage: "temporary",
    localStorage: "draft",
    federationAllowed: false,
    p2pAllowed: false,
    retentionDays: 30,
    requiresEncryption: true,
    userExportAllowed: true,
    userDeletionAllowed: true,
    syncRequiresConsent: true,
  },
  {
    dataClass: "proposal",
    nodeStorage: "canonical",
    localStorage: "cache",
    federationAllowed: true,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: false,
    userExportAllowed: true,
    userDeletionAllowed: false,
    syncRequiresConsent: false,
  },
  {
    dataClass: "governance_preference",
    nodeStorage: "canonical",
    localStorage: "cache",
    federationAllowed: true,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: false,
    userExportAllowed: true,
    userDeletionAllowed: false,
    syncRequiresConsent: false,
  },
  {
    dataClass: "contribution",
    nodeStorage: "canonical",
    localStorage: "cache",
    federationAllowed: true,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: false,
    userExportAllowed: true,
    userDeletionAllowed: false,
    syncRequiresConsent: false,
  },
  {
    dataClass: "portable_identity",
    nodeStorage: "reference",
    localStorage: "private_data",
    federationAllowed: true,
    p2pAllowed: false,
    retentionDays: null,
    requiresEncryption: true,
    userExportAllowed: true,
    userDeletionAllowed: true,
    syncRequiresConsent: true,
  },
];

export function getDefaultReplicationPolicy(dataClass: DataClass): ReplicationPolicy | undefined {
  return defaultReplicationPolicies.find((policy) => policy.dataClass === dataClass);
}

export function canSyncByDefault(dataClass: DataClass): boolean {
  const policy = getDefaultReplicationPolicy(dataClass);
  return Boolean(policy && policy.nodeStorage !== "none" && !policy.syncRequiresConsent);
}

export function requiresPrivacyReviewBeforeSync(dataClass: DataClass): boolean {
  const policy = getDefaultReplicationPolicy(dataClass);
  return Boolean(policy?.syncRequiresConsent || policy?.requiresEncryption);
}