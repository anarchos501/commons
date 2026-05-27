export type OfflineDraftKind = "support_request" | "offer" | "contribution" | "personal_note";

export type OfflineDraft = {
  id: string;
  kind: OfflineDraftKind;
  ownerAccountId?: string;
  payload: Record<string, unknown>;
  encrypted: boolean;
  syncBlocked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SyncQueueItem = {
  id: string;
  draftId: string;
  dataClass: OfflineDraftKind;
  status: "pending" | "blocked_for_privacy_review" | "ready_to_sync" | "synced" | "failed";
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type CachedCoordinationView = {
  id: string;
  sourceNodeId: string;
  dataClass: "cached_coordination_history";
  encrypted: boolean;
  expiresAt?: string;
  payload: Record<string, unknown>;
};