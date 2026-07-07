import type { DataClass } from "./replication-policies";

// register D-3: all cross-node data movement passes mayFederate, which denies
// by default and structurally excludes the vulnerability class under every
// agreement. Same architectural move as canViewConcern: one predicate, every
// path. Outbound enqueue is the enforcement point (federation-outbox.ts).

// Extends the device/sync DataClass vocabulary with the wire-level classes
// federation introduces. Every class MUST appear in FEDERATION_CLASS_RULES —
// the exhaustive Record makes an unclassified addition a type error.
export type FederationDataClass =
  | DataClass
  | "concern_record"
  | "federation_governance"
  | "federation_ping"
  | "cross_node_action"
  | "coalition_coordination"
  | "refuge_structural"
  | "refuge_content_blob";

// never           — structurally excluded; no agreement state or flag can pass it.
// protocol        — the handshake itself (proposals, decisions, pings): flows to
//                   proposed peers too, because it is how agreements form and
//                   carries no member data.
// active_agreement — requires an active agreement.
// ciphertext_only — requires an active agreement AND the payload already
//                   encrypted to member-held keys (F4 refuge blobs).
export type FederationClassRule = "never" | "protocol" | "active_agreement" | "ciphertext_only";

export const FEDERATION_CLASS_RULES: Record<FederationDataClass, FederationClassRule> = {
  // Device-local classes never cross the wire between nodes.
  offline_draft: "never",
  personal_note: "never",
  local_reminder: "never",
  private_availability: "never",
  cached_coordination_history: "never",
  sync_queue_item: "never",

  // The vulnerability class (hybrid-architecture.md; register D-3): request
  // content, offers with contact details, concern narratives. Never plaintext
  // federation payloads, under any agreement.
  support_request: "never",
  offer: "never",
  concern_record: "never",

  // Contribution/coordination records may federate (principle 3).
  contribution: "active_agreement",
  proposal: "active_agreement",
  governance_preference: "active_agreement",
  portable_identity: "active_agreement",
  linked_node_presence: "active_agreement",
  // Pattern-1 mediated actions (F2). The wire class covers the mediation
  // envelope; what an action may DO is bounded by the receiver's action
  // registry (federation-actions.ts) and its local authorization — the
  // vulnerability class cannot ride this because no registered action
  // carries it.
  cross_node_action: "active_agreement",
  coalition_coordination: "active_agreement",
  refuge_structural: "active_agreement",

  // Refuge content replicates only as ciphertext members hold the keys to (F4).
  refuge_content_blob: "ciphertext_only",

  // The handshake layer.
  federation_governance: "protocol",
  federation_ping: "protocol",
};

export const FEDERATION_DATA_CLASSES = Object.keys(FEDERATION_CLASS_RULES) as FederationDataClass[];

export function federationClassRule(dataClass: FederationDataClass): FederationClassRule {
  return FEDERATION_CLASS_RULES[dataClass] ?? "never";
}

// The peer/agreement context: at F0 this is the FederatedNode row; F1's
// Federation agreement wraps the same shape.
export type FederationPeerContext = { status: string };

export function mayFederate(
  dataClass: FederationDataClass,
  agreement: FederationPeerContext | null | undefined,
  options: { ciphertext?: boolean } = {},
): boolean {
  const rule = FEDERATION_CLASS_RULES[dataClass];
  if (!rule || rule === "never") return false;

  const status = agreement?.status;
  if (rule === "protocol") return status === "proposed" || status === "active";
  if (status !== "active") return false;
  if (rule === "ciphertext_only") return options.ciphertext === true;
  return true;
}
