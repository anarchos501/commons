import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { createFederationEnvelope, type FederationEnvelope } from "./federation-envelope";
import type { FederationInboxHandler } from "./federation-inbox";
import { enqueueFederationEvent } from "./federation-outbox";
import { getPeerByDomain } from "./federation-peers";
import { enqueueSignedNodeEvent } from "./federations";
import { nodeSigningProvider } from "./node-keys";
import { latestContact } from "./continuity";

// F3.5 Phase 3 — challenge / proof-of-life (register F-9).
//
// The asymmetry that keeps this safe: LIFE IS PROVABLE, DEATH IS NOT. A
// challenge only ever opens a window in which the home may prove life —
// directly, relayed through any peer, or vouched by a witness who has heard
// from it. One witness of life blocks; witnesses can only DELAY activation,
// never cause it (a lying peer forces Tier-1 read-only at worst — the safe
// direction, never split-brain). The member's one-click "can't reach home"
// lights the fuse and can never be skipped; window W prices sustained TOTAL
// silence, nothing less.
//
// Relay answers shared-peer unknowability by broadcast: the backup cannot
// know which peers the home shares, so the relay request goes to ALL of its
// active peers, each forwarding the INNER envelope verbatim iff it has the
// target pinned. The trust anchor never moves to the relay — a forwarded
// proof still verifies against the PINNED home key at the backup's inbox.

const CONTINUITY_PROTOCOL_CLASS = "continuity_protocol" as const;
const CHALLENGE_COOLDOWN_MS = 60 * 60 * 1000;

export type OpenChallengeResult =
  | { ok: true; alreadyOpen: boolean }
  | { ok: false; reason: "not_found" | "replica_not_active" | "cooldown" | "no_local_node" };

// Any authenticated local account may pull the alarm — reporting "I can't
// reach this community's home" is not a governance act. Idempotent while a
// challenge is open; 1h cooldown after one closes.
export async function openTakeoverChallenge(
  prisma: PrismaClient,
  { replicaId, now }: { replicaId: string; now?: Date },
): Promise<OpenChallengeResult> {
  const at = now ?? new Date();
  const replica = await prisma.backupReplica.findUnique({
    where: { id: replicaId },
    include: { origin: true },
  });
  if (!replica) return { ok: false, reason: "not_found" };
  if (replica.status === "challenge_open") return { ok: true, alreadyOpen: true };
  if (replica.status !== "active") return { ok: false, reason: "replica_not_active" };
  if (replica.challengeOpenedAt && at.getTime() - replica.challengeOpenedAt.getTime() < CHALLENGE_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  const selfNode = await prisma.node.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, domain: true } });
  if (!selfNode) return { ok: false, reason: "no_local_node" };

  await prisma.$transaction(async (tx) => {
    await tx.backupReplica.update({
      where: { id: replica.id },
      data: { status: "challenge_open", challengeOpenedAt: at },
    });

    // ONE signed challenge envelope: sent direct AND wrapped for every relay
    // path. Same eventId everywhere, so the home's inbox dedupe applies it
    // once no matter how many roads deliver it.
    const signer = await nodeSigningProvider(tx, selfNode.id);
    const inner = createFederationEnvelope({
      eventType: "takeover_challenge",
      payload: {
        entityType: replica.entityType,
        entityId: replica.entityId,
        backupDomain: selfNode.domain,
        challengeOpenedAt: at.toISOString(),
      },
      originDomain: selfNode.domain,
      keyId: signer.keyId,
      signer: signer.provider,
      publicKey: signer.publicKey,
    });
    await enqueueFederationEvent(tx, { peer: replica.origin, envelope: inner, dataClass: CONTINUITY_PROTOCOL_CLASS });

    const relayPeers = await tx.federatedNode.findMany({
      where: { status: "active", id: { not: replica.originPeerId } },
    });
    for (const peer of relayPeers) {
      await enqueueSignedNodeEvent(
        tx,
        selfNode,
        peer.domain,
        "challenge_relay_request",
        { targetDomain: replica.origin.domain, inner: inner as unknown as Record<string, unknown> },
        CONTINUITY_PROTOCOL_CLASS,
      );
    }
  });
  return { ok: true, alreadyOpen: false };
}

// ── Inbox handlers ────────────────────────────────────────────────────────────

// Home side: a backup doubts us. Prove life — direct, plus mirror fan-out
// through our own peers (the direct road may be exactly what's cut).
export const handleTakeoverChallenge: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  if (!localNode) return { ok: false, reason: "no_local_node" };

  const backup = await tx.entityBackup.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { id: true, peerId: true },
  });
  // Challenges about entities we don't back up here are noise, not errors —
  // and only the designated backup peer may challenge.
  if (!backup || backup.peerId !== origin.id) return { ok: true };

  const signer = await nodeSigningProvider(tx, localNode.id);
  const proof = createFederationEnvelope({
    eventType: "proof_of_life",
    payload: { entityType, entityId, at: new Date().toISOString() },
    originDomain: localNode.domain,
    keyId: signer.keyId,
    signer: signer.provider,
    publicKey: signer.publicKey,
  });
  await enqueueFederationEvent(tx, { peer: origin, envelope: proof, dataClass: CONTINUITY_PROTOCOL_CLASS });

  const relayPeers = await tx.federatedNode.findMany({ where: { status: "active", id: { not: origin.id } } });
  for (const peer of relayPeers) {
    await enqueueSignedNodeEvent(
      tx,
      { id: localNode.id, domain: localNode.domain },
      peer.domain,
      "challenge_relay_request",
      { targetDomain: origin.domain, inner: proof as unknown as Record<string, unknown> },
      CONTINUITY_PROTOCOL_CLASS,
    );
  }
  return { ok: true };
};

const RELAYABLE_INNER_TYPES = new Set(["takeover_challenge", "proof_of_life"]);

// Peer side: forward the inner envelope verbatim iff the target is pinned
// and deliverable — we are a road, not an authority. Plus the witness rule:
// if WE have heard from the challenged node since the challenge opened, say
// so — one witness of life blocks activation (the safe direction).
export const handleChallengeRelayRequest: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  const p = envelope.payload as Record<string, unknown>;
  const targetDomain = typeof p.targetDomain === "string" ? p.targetDomain : null;
  const inner = p.inner as FederationEnvelope | undefined;
  if (!targetDomain || !inner || typeof inner !== "object" || typeof inner.eventType !== "string") {
    return { ok: false, reason: "malformed_payload" };
  }
  if (!RELAYABLE_INNER_TYPES.has(inner.eventType)) return { ok: false, reason: "not_relayable" };

  const target = await getPeerByDomain(tx, targetDomain);
  if (target && (target.status === "active" || target.status === "proposed")) {
    await enqueueFederationEvent(tx, { peer: target, envelope: inner, dataClass: CONTINUITY_PROTOCOL_CLASS });
  }

  if (inner.eventType === "takeover_challenge" && localNode) {
    const innerPayload = inner.payload as Record<string, unknown>;
    const openedAtRaw = typeof innerPayload.challengeOpenedAt === "string" ? innerPayload.challengeOpenedAt : null;
    const openedAt = openedAtRaw ? new Date(openedAtRaw) : null;
    const contact = target ? latestContact([target]) : null;
    if (openedAt && contact && contact > openedAt) {
      await enqueueSignedNodeEvent(
        tx,
        { id: localNode.id, domain: localNode.domain },
        origin.domain,
        "proof_of_life_relay",
        {
          kind: "witness",
          entityType: innerPayload.entityType,
          entityId: innerPayload.entityId,
          targetDomain,
          lastContactAt: contact.toISOString(),
        },
        CONTINUITY_PROTOCOL_CLASS,
      );
    }
  }
  return { ok: true };
};

async function closeChallengeOnLife(
  tx: Prisma.TransactionClient,
  replica: { id: string; status: string; challengeOpenedAt: Date | null },
  lifeAt: Date,
): Promise<void> {
  if (replica.status !== "challenge_open") return;
  if (replica.challengeOpenedAt && lifeAt <= replica.challengeOpenedAt) return;
  await tx.backupReplica.update({
    where: { id: replica.id },
    data: { status: "active", lastProofOfLifeAt: lifeAt },
  });
}

// Backup side: a direct (or peer-forwarded) proof, origin-verified against
// the PINNED home key by the inbox before we ever run.
export const handleProofOfLife: FederationInboxHandler = async (tx, { origin, envelope }) => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  const replica = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: origin.id } },
    select: { id: true, status: true, challengeOpenedAt: true },
  });
  if (!replica) return { ok: true };
  const at = typeof p.at === "string" ? new Date(p.at) : new Date(envelope.createdAt);
  await closeChallengeOnLife(tx, replica, at);
  return { ok: true };
};

// Backup side: a WITNESS vouches it has heard from the home since the
// challenge opened — verified against the WITNESS's key (it speaks for its
// own contact log, never for the home).
export const handleProofOfLifeRelay: FederationInboxHandler = async (tx, { envelope }) => {
  const p = envelope.payload as Record<string, unknown>;
  if (p.kind !== "witness") return { ok: false, reason: "unknown_relay_kind" };
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  const targetDomain = typeof p.targetDomain === "string" ? p.targetDomain : null;
  const lastContactAt = typeof p.lastContactAt === "string" ? new Date(p.lastContactAt) : null;
  if (!entityType || !entityId || !targetDomain || !lastContactAt || Number.isNaN(lastContactAt.getTime())) {
    return { ok: false, reason: "malformed_payload" };
  }
  const homePeer = await getPeerByDomain(tx, targetDomain);
  if (!homePeer) return { ok: true };
  const replica = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: homePeer.id } },
    select: { id: true, status: true, challengeOpenedAt: true },
  });
  if (!replica) return { ok: true };
  // The witness (the envelope's verified origin) speaks only for its own
  // contact log, and its word only ever delays — challenge back to Tier-1.
  await closeChallengeOnLife(tx, replica, lastContactAt);
  return { ok: true };
};
