import { createHash } from "node:crypto";

export type SignedEventJsonValue = string | number | boolean | null | SignedEventJsonObject | SignedEventJsonValue[];
export type SignedEventJsonObject = { [key: string]: SignedEventJsonValue };
export type SignedEventPayload = SignedEventJsonObject;

export type SignedEventInput = {
  eventType:
    | "proposal_created"
    | "support_request_submitted"
    | "contribution_logged"
    | "identity_presence_updated"
    | "governance_preference_changed"
    | "migration_prepared";
  subjectType: string;
  subjectId: string;
  actorAccountId?: string | null;
  portableIdentityId?: string | null;
  nodeId?: string | null;
  groupId?: string | null;
  projectId?: string | null;
  payload: SignedEventPayload;
  publicKey: string;
  createdAt?: Date;
};

export type SignedEventRecord = SignedEventInput & {
  payloadHash: string;
  signature: string;
  createdAt: Date;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function hashSignedEventPayload(payload: SignedEventPayload): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export type SigningProvider = {
  sign(payloadHash: string, publicKey: string): string;
  verify?(payloadHash: string, signature: string, publicKey: string): boolean;
};

export function createDevelopmentSignature(payloadHash: string, publicKey: string): string {
  return createHash("sha256").update(`commons-dev-signature:${publicKey}:${payloadHash}`).digest("hex");
}

export const developmentSigningProvider: SigningProvider = {
  sign: createDevelopmentSignature,
};

export function createSignedEventRecord(
  input: SignedEventInput,
  signer: SigningProvider = developmentSigningProvider,
): SignedEventRecord {
  const payloadHash = hashSignedEventPayload(input.payload);

  return {
    ...input,
    payloadHash,
    signature: signer.sign(payloadHash, input.publicKey),
    createdAt: input.createdAt ?? new Date(),
  };
}