import { createHash, randomUUID } from "node:crypto";
import { verifyWithPublicKeyPem } from "./node-keys";
import { hashSignedEventPayload, stableStringify, type SignedEventPayload, type SigningProvider } from "./signed-events";

export const FEDERATION_PROTOCOL_VERSION = 1;

// Wire event types are a plain string union, deliberately NOT the Prisma
// SignedEventType enum: new event types must not require a migration. The
// union is for senders; receivers dispatch on the raw string and record
// unknown types as rejected (register F-4: the surface stays narrow).
export type FederationWireEventType =
  | "federation_ping"
  | "federation_proposal_opened"
  | "federation_proposal_decision"
  | "federation_agreement_ended"
  | "federation_suspension_notice";

export type FederationEnvelope = {
  version: number;
  eventId: string;
  eventType: string;
  origin: { domain: string; keyId: string };
  createdAt: string;
  expiresAt: string | null;
  payload: SignedEventPayload;
  payloadHash: string;
  signature: string;
};

// The signature covers every routing/identity field plus the payload (via its
// hash), so nothing verifiable can be swapped after signing.
function envelopeCore(envelope: Omit<FederationEnvelope, "signature">): string {
  return stableStringify({
    version: envelope.version,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    origin: { domain: envelope.origin.domain, keyId: envelope.origin.keyId },
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    payloadHash: envelope.payloadHash,
  });
}

export function envelopeSigningHash(envelope: Omit<FederationEnvelope, "signature">): string {
  return createHash("sha256").update(envelopeCore(envelope)).digest("hex");
}

export function createFederationEnvelope(input: {
  eventType: FederationWireEventType | string;
  payload: SignedEventPayload;
  originDomain: string;
  keyId: string;
  signer: SigningProvider;
  publicKey: string;
  eventId?: string;
  createdAt?: Date;
  expiresAt?: Date | null;
}): FederationEnvelope {
  const unsigned: Omit<FederationEnvelope, "signature"> = {
    version: FEDERATION_PROTOCOL_VERSION,
    eventId: input.eventId ?? randomUUID(),
    eventType: input.eventType,
    origin: { domain: input.originDomain, keyId: input.keyId },
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    payload: input.payload,
    payloadHash: hashSignedEventPayload(input.payload),
  };

  return { ...unsigned, signature: input.signer.sign(envelopeSigningHash(unsigned), input.publicKey) };
}

// Generous at beta: the outbox retries asynchronously, so legitimate
// deliveries arrive late. F5 tightens this per event type.
export const DEFAULT_MAX_ENVELOPE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFederationEnvelope(value: unknown): FederationEnvelope | null {
  if (!isPlainObject(value)) return null;
  const origin = value.origin;
  if (
    typeof value.version !== "number" ||
    typeof value.eventId !== "string" ||
    !value.eventId ||
    typeof value.eventType !== "string" ||
    !value.eventType ||
    !isPlainObject(origin) ||
    typeof origin.domain !== "string" ||
    !origin.domain ||
    typeof origin.keyId !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.expiresAt !== null && typeof value.expiresAt !== "string") ||
    !isPlainObject(value.payload) ||
    typeof value.payloadHash !== "string" ||
    typeof value.signature !== "string"
  ) {
    return null;
  }

  return {
    version: value.version,
    eventId: value.eventId,
    eventType: value.eventType,
    origin: { domain: origin.domain, keyId: origin.keyId },
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    payload: value.payload as SignedEventPayload,
    payloadHash: value.payloadHash,
    signature: value.signature,
  };
}

export type VerifyFederationEnvelopeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unsupported_version" | "payload_hash_mismatch" | "bad_signature" | "stale" | "expired";
    };

export function verifyFederationEnvelope(
  envelope: FederationEnvelope,
  pinnedPublicKeyPem: string,
  options: { now?: Date; maxAgeMs?: number } = {},
): VerifyFederationEnvelopeResult {
  if (envelope.version !== FEDERATION_PROTOCOL_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  if (hashSignedEventPayload(envelope.payload) !== envelope.payloadHash) {
    return { ok: false, reason: "payload_hash_mismatch" };
  }

  const { signature, ...unsigned } = envelope;
  if (!verifyWithPublicKeyPem(pinnedPublicKeyPem, envelopeSigningHash(unsigned), signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  const now = options.now ?? new Date();
  const createdAt = Date.parse(envelope.createdAt);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_ENVELOPE_AGE_MS;
  if (Number.isNaN(createdAt) || createdAt > now.getTime() + MAX_FUTURE_SKEW_MS || now.getTime() - createdAt > maxAgeMs) {
    return { ok: false, reason: "stale" };
  }
  if (envelope.expiresAt !== null) {
    const expiresAt = Date.parse(envelope.expiresAt);
    if (Number.isNaN(expiresAt) || now.getTime() > expiresAt) {
      return { ok: false, reason: "expired" };
    }
  }

  return { ok: true };
}
