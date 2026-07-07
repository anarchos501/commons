import { randomUUID } from "node:crypto";
import type { FederatedNode, Node, Prisma, PrismaClient } from "../generated/prisma/client";
import type { FederationEnvelope } from "./federation-envelope";
import { ensurePeerNodeRow, getPeerByDomain } from "./federation-peers";
import { enqueueSignedNodeEvent } from "./federations";
import { didMatchesPublicKey, ensurePortableIdentity, identitySigningProvider } from "./portable-identity";
import { hashSignedEventPayload, type SignedEventPayload } from "./signed-events";
import { verifyWithPublicKeyPem } from "./node-keys";

// Presences: "identity did:… from node A is present on node B as handle X."
// A presence carries no password, no session, no local authority — it is a
// reference plus whatever standing the local community grants it (plan §3).
// The person authenticates only ever to their home node; the home node
// vouches cryptographically (Pattern 1). Rows are symmetric: each side's
// LinkedNodePresence.nodeId is the node WHERE the presence exists.

export type PresenceClaimPurpose = "presence_establish" | "presence_revoke";

// The identity-signed claim binds purpose + identity + home domain, so a
// captured establish signature cannot be replayed as a revocation or
// re-scoped to another home. The nonce makes every signed claim single-intent
// (register D-8): once keys are client-held (Rung 2), a home node must not be
// able to re-envelope an old member signature as a fresh act — and it keeps
// deterministic Ed25519 signatures from colliding in the SignedEvent ledger.
export function presenceClaim(input: {
  purpose: PresenceClaimPurpose;
  did: string;
  handle: string;
  homeNodeDomain: string;
  displayName: string | null;
  nonce: string;
}): SignedEventPayload {
  return {
    purpose: input.purpose,
    did: input.did,
    handle: input.handle,
    homeNodeDomain: input.homeNodeDomain,
    displayName: input.displayName,
    nonce: input.nonce,
  };
}

export type EstablishPresenceResult =
  | { ok: true; presenceId: string }
  | { ok: false; reason: "account_not_found" | "peer_not_found" | "not_federable" };

export async function establishPresence(
  prisma: PrismaClient,
  { accountId, peerDomain }: { accountId: string; peerDomain: string },
): Promise<EstablishPresenceResult> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, displayName: true, homeNode: { select: { id: true, domain: true } } },
  });
  if (!account) return { ok: false, reason: "account_not_found" };
  const peer = await getPeerByDomain(prisma, peerDomain);
  if (!peer) return { ok: false, reason: "peer_not_found" };

  const { identity } = await ensurePortableIdentity(prisma, accountId);
  const signer = await identitySigningProvider(prisma, identity.id);
  const nonce = randomUUID();
  const claim = presenceClaim({
    purpose: "presence_establish",
    did: identity.did,
    handle: account.displayName,
    homeNodeDomain: account.homeNode.domain,
    displayName: account.displayName,
    nonce,
  });
  const actorSignature = signer.provider.sign(hashSignedEventPayload(claim), signer.publicKey);

  // The identity signs the claim; the node signs the envelope (doubly
  // signed). linked_node_presence requires an ACTIVE agreement (D-3).
  const delivered = await enqueueSignedNodeEvent(
    prisma,
    account.homeNode,
    peer.domain,
    "presence_establish",
    {
      did: identity.did,
      publicKey: identity.publicKey,
      handle: account.displayName,
      displayName: account.displayName,
      homeNodeDomain: account.homeNode.domain,
      nonce,
      actorSignature,
    },
    "linked_node_presence",
  );
  if (!delivered) return { ok: false, reason: "not_federable" };

  // Activate the schema-only SignedEvent model: the home node's durable,
  // identity-signed record of the vouching act.
  await prisma.signedEvent.create({
    data: {
      eventType: "identity_presence_updated",
      subjectType: "linked_node_presence",
      subjectId: identity.did,
      actorAccountId: accountId,
      portableIdentityId: identity.id,
      nodeId: account.homeNode.id,
      payload: claim as Prisma.InputJsonValue,
      payloadHash: hashSignedEventPayload(claim),
      signature: actorSignature,
      publicKey: identity.publicKey,
    },
  });

  // Home-side mirror: "this member is present on peer X."
  const peerNode = await ensurePeerNodeRow(prisma, { domain: peer.domain, name: peer.displayName });
  const presence = await prisma.linkedNodePresence.upsert({
    where: { portableIdentityId_nodeId: { portableIdentityId: identity.id, nodeId: peerNode.id } },
    update: { status: "active", handle: account.displayName, displayName: account.displayName, lastSeenAt: new Date() },
    create: {
      portableIdentityId: identity.id,
      nodeId: peerNode.id,
      handle: account.displayName,
      displayName: account.displayName,
      homeNodeDomain: account.homeNode.domain,
      status: "active",
    },
  });
  return { ok: true, presenceId: presence.id };
}

export type RevokePresenceResult =
  | { ok: true }
  | { ok: false; reason: "account_not_found" | "no_identity" | "peer_not_found" | "not_federable" };

export async function revokePresence(
  prisma: PrismaClient,
  { accountId, peerDomain }: { accountId: string; peerDomain: string },
): Promise<RevokePresenceResult> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      displayName: true,
      homeNode: { select: { id: true, domain: true } },
      portableIdentity: true,
    },
  });
  if (!account) return { ok: false, reason: "account_not_found" };
  if (!account.portableIdentity) return { ok: false, reason: "no_identity" };
  const peer = await getPeerByDomain(prisma, peerDomain);
  if (!peer) return { ok: false, reason: "peer_not_found" };

  const identity = account.portableIdentity;
  const signer = await identitySigningProvider(prisma, identity.id);
  const nonce = randomUUID();
  const claim = presenceClaim({
    purpose: "presence_revoke",
    did: identity.did,
    handle: account.displayName,
    homeNodeDomain: account.homeNode.domain,
    displayName: null,
    nonce,
  });
  const actorSignature = signer.provider.sign(hashSignedEventPayload(claim), signer.publicKey);

  const delivered = await enqueueSignedNodeEvent(
    prisma,
    account.homeNode,
    peer.domain,
    "presence_revoke",
    { did: identity.did, handle: account.displayName, nonce, actorSignature },
    "linked_node_presence",
  );
  if (!delivered) return { ok: false, reason: "not_federable" };

  await prisma.signedEvent.create({
    data: {
      eventType: "identity_presence_updated",
      subjectType: "linked_node_presence",
      subjectId: identity.did,
      actorAccountId: accountId,
      portableIdentityId: identity.id,
      nodeId: account.homeNode.id,
      payload: claim as Prisma.InputJsonValue,
      payloadHash: hashSignedEventPayload(claim),
      signature: actorSignature,
      publicKey: identity.publicKey,
    },
  });

  const peerNode = await ensurePeerNodeRow(prisma, { domain: peer.domain, name: peer.displayName });
  await prisma.linkedNodePresence.updateMany({
    where: { portableIdentityId: identity.id, nodeId: peerNode.id },
    data: { status: "revoked" },
  });
  return { ok: true };
}

// ── Remote-side handlers (invoked from federation-inbox) ─────────────────────

type HandlerResult = { ok: true } | { ok: false; reason: string };
type HandlerContext = { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null };

export async function applyPresenceEstablish(
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: HandlerContext,
): Promise<HandlerResult> {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const did = typeof p.did === "string" ? p.did : null;
  const publicKey = typeof p.publicKey === "string" ? p.publicKey : null;
  const handle = typeof p.handle === "string" ? p.handle : null;
  const displayName = typeof p.displayName === "string" ? p.displayName : null;
  const homeNodeDomain = typeof p.homeNodeDomain === "string" ? p.homeNodeDomain : null;
  const nonce = typeof p.nonce === "string" ? p.nonce : null;
  const actorSignature = typeof p.actorSignature === "string" ? p.actorSignature : null;
  if (!did || !publicKey || !handle || !homeNodeDomain || !nonce || !actorSignature) {
    return { ok: false, reason: "malformed_payload" };
  }

  // A home node vouches only for its own members.
  if (homeNodeDomain !== origin.domain) return { ok: false, reason: "home_mismatch" };
  // Self-certifying binding: the DID must derive from the presented key.
  if (!didMatchesPublicKey(did, publicKey)) return { ok: false, reason: "did_key_mismatch" };

  const claim = presenceClaim({ purpose: "presence_establish", did, handle, homeNodeDomain, displayName, nonce });
  if (!verifyWithPublicKeyPem(publicKey, hashSignedEventPayload(claim), actorSignature)) {
    return { ok: false, reason: "bad_actor_signature" };
  }

  // Identity keys pin exactly like node keys (register F-3): a known DID
  // presenting a different key is refused, never silently repinned.
  const existing = await tx.portableIdentity.findUnique({ where: { did } });
  if (existing && existing.publicKey !== publicKey) {
    return { ok: false, reason: "identity_key_mismatch" };
  }
  const identity =
    existing ?? (await tx.portableIdentity.create({ data: { did, publicKey } }));

  await tx.linkedNodePresence.upsert({
    where: { portableIdentityId_nodeId: { portableIdentityId: identity.id, nodeId: localNode.id } },
    update: { status: "active", handle, displayName, homeNodeDomain, lastSeenAt: new Date() },
    create: {
      portableIdentityId: identity.id,
      nodeId: localNode.id,
      handle,
      displayName,
      homeNodeDomain,
      status: "active",
    },
  });
  return { ok: true };
}

export async function applyPresenceRevoke(
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: HandlerContext,
): Promise<HandlerResult> {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const did = typeof p.did === "string" ? p.did : null;
  const handle = typeof p.handle === "string" ? p.handle : null;
  const nonce = typeof p.nonce === "string" ? p.nonce : null;
  const actorSignature = typeof p.actorSignature === "string" ? p.actorSignature : null;
  if (!did || !handle || !nonce || !actorSignature) return { ok: false, reason: "malformed_payload" };

  const identity = await tx.portableIdentity.findUnique({ where: { did } });
  if (!identity) return { ok: true }; // never knew them: revocation is a no-op
  const presence = await tx.linkedNodePresence.findUnique({
    where: { portableIdentityId_nodeId: { portableIdentityId: identity.id, nodeId: localNode.id } },
  });
  if (!presence) return { ok: true };
  if (presence.homeNodeDomain && presence.homeNodeDomain !== origin.domain) {
    return { ok: false, reason: "home_mismatch" };
  }

  const claim = presenceClaim({
    purpose: "presence_revoke",
    did,
    handle,
    homeNodeDomain: origin.domain,
    displayName: null,
    nonce,
  });
  if (!verifyWithPublicKeyPem(identity.publicKey, hashSignedEventPayload(claim), actorSignature)) {
    return { ok: false, reason: "bad_actor_signature" };
  }

  await tx.linkedNodePresence.update({ where: { id: presence.id }, data: { status: "revoked" } });
  return { ok: true };
}
