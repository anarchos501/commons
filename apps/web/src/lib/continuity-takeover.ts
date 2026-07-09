import type { BackupReplica, Prisma, PrismaClient } from "../generated/prisma/client";
import { latestContact, resolveWriteAuthority } from "./continuity";
import { CONTINUITY_DATA_CLASS } from "./continuity-establishment";
import type { FederationInboxHandler } from "./federation-inbox";
import { enqueueFederationEvent } from "./federation-outbox";
import { getPeerByDomain } from "./federation-peers";
import { enqueueSignedNodeEvent } from "./federations";
import { joinOpenGroup } from "./group-membership";
import { nodeSigningProvider, verifyWithPublicKeyPem } from "./node-keys";
import { openPetition, requireApprovedPetition } from "./petitions";
import { publicKeyPemFromDidKey } from "./portable-identity";
import { createFederationEnvelope } from "./federation-envelope";
import { hashSignedEventPayload, stableStringify, type SignedEventPayload } from "./signed-events";

// F3.5 Phase 4 — Tier 2, LOG-ONLY (ratified; register F-8/F-9, D-5).
//
// A takeover materializes NOTHING: no Group rows, no memberships, no
// denominators — the replica gains an append-only, node-signed action log
// with a two-verb vocabulary, and that is the whole of Tier 2. What this
// buys (and why it was ratified knowingly): a contested window is LOSSLESS
// — the annex log replays cleanly at the home, in order, idempotently —
// which is the property "fills its place" could never have. The honest
// posture is "actable for discussion", not "usually actable"; the D-6
// banner wording ships on the replica page.
//
// Petitions freeze on both sides during takeover: on the backup it is
// structurally impossible (there are no petition rows to act on); on the
// home the Phase-3 resolver gate holds them open. Replayed join intents
// follow F2 discipline — failover imports no weight (register D-5).

// ── The two-verb vocabulary (the mediated-action registry move) ─────────────

type TakeoverActionValidator = (action: Record<string, unknown>) => { ok: true } | { ok: false; reason: string };

export const TAKEOVER_ACTION_HANDLERS: Record<string, TakeoverActionValidator> = {
  takeover_post_message: (action) => {
    const body = action.body;
    if (typeof body !== "string" || body.trim().length === 0) return { ok: false, reason: "empty_body" };
    if (body.length > 4000) return { ok: false, reason: "body_too_long" };
    return { ok: true };
  },
  takeover_join_open_group: (action) => {
    const note = action.note;
    if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
      return { ok: false, reason: "invalid_note" };
    }
    return { ok: true };
  },
};

export type PerformTakeoverActionResult =
  | { ok: true; seq: number }
  | { ok: false; reason: "not_found" | "not_takeover_active" | "unknown_action_type" | "no_local_node" | string };

// Any authenticated local backup account may act in the annex; actors that
// completed stranded login carry their escrow-verified DID — the upgrade
// from loosely-labeled to verified (register D-8/F-9).
export async function performTakeoverAction(
  prisma: PrismaClient,
  input: {
    replicaId: string;
    actionType: string;
    action: Record<string, unknown>;
    actorLabel: string;
    actorAccountId?: string;
    actorDid?: string;
  },
): Promise<PerformTakeoverActionResult> {
  const validator = TAKEOVER_ACTION_HANDLERS[input.actionType];
  if (!validator) return { ok: false, reason: "unknown_action_type" };
  const valid = validator(input.action);
  if (!valid.ok) return { ok: false, reason: valid.reason };

  const replica = await prisma.backupReplica.findUnique({ where: { id: input.replicaId } });
  if (!replica) return { ok: false, reason: "not_found" };
  if (replica.status !== "takeover_active") return { ok: false, reason: "not_takeover_active" };

  const selfNode = await prisma.node.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!selfNode) return { ok: false, reason: "no_local_node" };

  return prisma.$transaction(async (tx) => {
    const last = await tx.takeoverLogEntry.findFirst({
      where: { replicaId: replica.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    const action = input.actorDid ? { ...input.action, actorDid: input.actorDid } : input.action;
    const signedBody = stableStringify({
      replicaId: replica.id,
      seq,
      actionType: input.actionType,
      action,
      actorLabel: input.actorLabel,
    } as unknown as SignedEventPayload);
    const signer = await nodeSigningProvider(tx, selfNode.id);
    const digest = hashSignedEventPayload({ body: signedBody });
    await tx.takeoverLogEntry.create({
      data: {
        replicaId: replica.id,
        seq,
        actionType: input.actionType,
        action: action as Prisma.InputJsonValue,
        actorLabel: input.actorLabel,
        actorAccountId: input.actorAccountId ?? null,
        signature: signer.provider.sign(digest, signer.publicKey),
      },
    });
    return { ok: true as const, seq };
  });
}

// ── Stranded login primitive (register D-8) ─────────────────────────────────
//
// The member's password unwraps their escrowed identity key CLIENT-SIDE (the
// server-discipline test pins that unwrapEscrowedIdentityKey never runs in
// server code); the recovered key signs a challenge, and THIS verifies the
// signature against the DID from the replica's escrow entries — no identity
// row, no home node needed. The browser unwrap bundle matures at F4; the
// primitive and its roundtrip test pin the design now.
export type StrandedVerifyResult =
  | { ok: true; did: string; handle: string }
  | { ok: false; reason: "not_found" | "unknown_did" | "bad_signature" };

export async function verifyStrandedIdentity(
  prisma: PrismaClient,
  input: { replicaId: string; did: string; challenge: string; signature: string },
): Promise<StrandedVerifyResult> {
  const replica = await prisma.backupReplica.findUnique({
    where: { id: input.replicaId },
    select: { escrowEntries: true },
  });
  if (!replica) return { ok: false, reason: "not_found" };
  const entries = (replica.escrowEntries as Array<{ handle: string; did: string }> | null) ?? [];
  const entry = entries.find((candidate) => candidate.did === input.did);
  if (!entry) return { ok: false, reason: "unknown_did" };
  let publicKeyPem: string;
  try {
    publicKeyPem = publicKeyPemFromDidKey(input.did);
  } catch {
    return { ok: false, reason: "unknown_did" };
  }
  const digest = hashSignedEventPayload({ challenge: input.challenge });
  if (!verifyWithPublicKeyPem(publicKeyPem, digest, input.signature)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, did: input.did, handle: entry.handle };
}

// ── Activation sweep (backup side, federation tick) ─────────────────────────

export type ActivationSweepResult = { activated: number; implicitLife: number };

export async function runTakeoverActivationSweep(
  prisma: PrismaClient,
  options: { now?: Date } = {},
): Promise<ActivationSweepResult> {
  const now = options.now ?? new Date();
  const result: ActivationSweepResult = { activated: 0, implicitLife: 0 };
  const open = await prisma.backupReplica.findMany({
    where: { status: "challenge_open" },
    include: { origin: true },
  });
  for (const replica of open) {
    try {
      if (!replica.challengeOpenedAt) continue;
      // Implicit life (zero hot-path cost): ANY contact with the home since
      // the challenge opened closes it — the activation sweep is also the
      // implicit proof-of-life sweep.
      const contact = latestContact([replica.origin]);
      if (contact && contact > replica.challengeOpenedAt) {
        await prisma.backupReplica.update({
          where: { id: replica.id },
          data: { status: "active", lastProofOfLifeAt: contact },
        });
        result.implicitLife += 1;
        continue;
      }
      // Life recorded since open (direct/relayed/witnessed) already closed
      // the challenge in its handler; this guard is belt-and-braces.
      if (replica.lastProofOfLifeAt && replica.lastProofOfLifeAt > replica.challengeOpenedAt) continue;

      // W elapsed — or the backup-steward expedite petition approved WHILE a
      // challenge is open (it can accelerate W, never skip the challenge).
      const windowElapsed = now.getTime() - replica.challengeOpenedAt.getTime() >= replica.windowHours * 3_600_000;
      const expedited = Boolean(replica.expediteApprovedAt && replica.expediteApprovedAt > replica.challengeOpenedAt);
      if (!windowElapsed && !expedited) continue;

      await activateTakeover(prisma, replica, now);
      result.activated += 1;
    } catch (err) {
      console.error(`[continuity] activation sweep failed for replica ${replica.id}`, err);
    }
  }
  return result;
}

async function activateTakeover(
  prisma: PrismaClient,
  replica: BackupReplica & { origin: { id: string; domain: string } },
  now: Date,
): Promise<void> {
  const selfNode = await prisma.node.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, domain: true } });
  if (!selfNode) return;
  await prisma.$transaction(async (tx) => {
    await tx.backupReplica.update({
      where: { id: replica.id },
      data: { status: "takeover_active", activatedAt: now },
    });
    // THE legible transfer event: a local node-signed record that write
    // authority was assumed here, and when, and on what silence.
    const payload = {
      authority: "takeover_active",
      previousAuthority: "challenge_open",
      entityType: replica.entityType,
      entityId: replica.entityId,
      originDomain: replica.origin.domain,
      challengeOpenedAt: replica.challengeOpenedAt?.toISOString() ?? null,
      at: now.toISOString(),
    };
    const payloadHash = hashSignedEventPayload(payload);
    const signer = await nodeSigningProvider(tx, selfNode.id);
    await tx.signedEvent.create({
      data: {
        eventType: "continuity_authority_changed",
        subjectType: "backup_replica",
        subjectId: `${replica.entityType}:${replica.entityId}`,
        nodeId: selfNode.id,
        payload,
        payloadHash,
        signature: signer.provider.sign(payloadHash, signer.publicKey),
        publicKey: signer.publicKey,
      },
    });
    // Broadcast: to the home (queued in the outbox for its return — that
    // arrival is itself contact) and to every other peer (legibility).
    const peers = await tx.federatedNode.findMany({ where: { status: "active" } });
    for (const peer of peers) {
      await enqueueSignedNodeEvent(
        tx,
        selfNode,
        peer.domain,
        "takeover_activated",
        { entityType: replica.entityType, entityId: replica.entityId, activatedAt: now.toISOString() },
        CONTINUITY_DATA_CLASS,
      );
    }
  });
}

// ── Expedite petition (backup-steward accelerator, never a gate) ────────────
//
// Approval counts as W-elapsed IFF a challenge is open — it can compress the
// window, never skip the challenge (the member click stays the only fuse).

export async function proposeTakeoverExpedite(
  prisma: PrismaClient,
  { replicaId, createdByMembershipId }: { replicaId: string; createdByMembershipId: string },
): Promise<
  | Awaited<ReturnType<typeof openPetition>>
  | { ok: false; reason: "not_found" | "no_open_challenge" | "no_steward_group" }
> {
  const replica = await prisma.backupReplica.findUnique({ where: { id: replicaId }, select: { status: true } });
  if (!replica) return { ok: false, reason: "not_found" };
  if (replica.status !== "challenge_open") return { ok: false, reason: "no_open_challenge" };
  const node = await prisma.node.findFirst({ orderBy: { createdAt: "asc" }, select: { stewardGroupId: true } });
  if (!node?.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  return openPetition(prisma, {
    groupId: node.stewardGroupId,
    category: "group_settings",
    subjectType: "backup_takeover_expedite",
    subjectId: replicaId,
    createdByMembershipId,
  });
}

export async function applyTakeoverExpediteFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "backup_takeover_expedite");
  const replica = await tx.backupReplica.findUnique({
    where: { id: petition.subjectId },
    select: { id: true, status: true },
  });
  // Staleness re-check: the challenge may have closed (life arrived) while
  // the petition ran — an expedite without an open challenge does nothing.
  if (!replica || replica.status !== "challenge_open") return;
  await tx.backupReplica.update({ where: { id: replica.id }, data: { expediteApprovedAt: new Date() } });
}

// ── Graceful handoff (home-initiated accelerator, never a gate) ─────────────

export async function initiateGracefulHandoff(
  prisma: PrismaClient,
  ref: { entityType: string; entityId: string },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "no_local_node" }> {
  const backup = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: ref.entityType, entityId: ref.entityId } },
    include: { peer: true },
  });
  if (!backup || backup.status !== "active") return { ok: false, reason: "not_found" };
  const selfNode = await prisma.node.findUnique({
    where: { id: (await prisma.group.findUniqueOrThrow({ where: { id: ref.entityId }, select: { nodeId: true } })).nodeId },
    select: { id: true, domain: true },
  });
  if (!selfNode) return { ok: false, reason: "no_local_node" };
  await prisma.$transaction(async (tx) => {
    // Self-demote THIS entity immediately — the handoff is instant.
    await tx.entityBackup.update({ where: { id: backup.id }, data: { takeoverState: "remote_active" } });
    await enqueueSignedNodeEvent(
      tx,
      selfNode,
      backup.peer.domain,
      "takeover_handoff",
      { entityType: ref.entityType, entityId: ref.entityId },
      CONTINUITY_DATA_CLASS,
    );
  });
  return { ok: true };
}

// ── Inbox handlers ────────────────────────────────────────────────────────────

// Backup side: home hands over gracefully — instant activation, no challenge.
export const handleTakeoverHandoff: FederationInboxHandler = async (tx, { origin, envelope }) => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  const replica = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: origin.id } },
  });
  if (!replica) return { ok: true };
  if (replica.status !== "active" && replica.status !== "challenge_open") return { ok: true };
  await tx.backupReplica.update({
    where: { id: replica.id },
    data: { status: "takeover_active", activatedAt: new Date() },
  });
  return { ok: true };
};

// Home side: the backup says it activated. Contested-activation hardening
// (the asymmetric-partition residual, register F-9): if we are alive and NOT
// self-demoted, we answer with immediate proof of life — the backup cedes on
// contact; log-only Tier-2 makes the short contested window lossless. If our
// own clock already demoted us, we accept the takeover as fact.
export const handleTakeoverActivated: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  const backup = await tx.entityBackup.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { id: true, peerId: true, takeoverState: true },
  });
  // Not ours to accept: an announcement from a non-designated peer (we may
  // merely be a bystander peer hearing the broadcast) records nothing.
  if (!backup || backup.peerId !== origin.id) return { ok: true };
  if (backup.takeoverState !== "none") return { ok: true }; // already known
  // NOTE: an announcement arriving AFTER a pull-based reconciliation already
  // resolved the same takeover (out-of-order delivery) lands in the
  // contested branch below and costs one extra verification round-trip —
  // verifiedAt drops, the next tick's status pull finds the replica ceded,
  // and writes resume. A transient read-only blip in the safe direction,
  // never split-brain.

  const authority = await resolveWriteAuthority(tx, { entityType, entityId });
  if (authority === "writable" && localNode) {
    // Contested: we are alive and hold the lease by our own clock. Answer
    // with proof of life (direct + mirror fan-out) instead of accepting —
    // AND drop to unverified: an annex log exists somewhere, so we freeze
    // writes until the quiet-boot pull reconciles it (the same machinery,
    // no special contested path; unreachable backup ⇒ stay read-only —
    // always the safe direction). Log-only Tier-2 makes this lossless.
    await tx.entityBackup.update({ where: { id: backup.id }, data: { verifiedAt: null } });
    const signer = await nodeSigningProvider(tx, localNode.id);
    const proof = createFederationEnvelope({
      eventType: "proof_of_life",
      payload: { entityType, entityId, at: new Date().toISOString() },
      originDomain: localNode.domain,
      keyId: signer.keyId,
      signer: signer.provider,
      publicKey: signer.publicKey,
    });
    await enqueueFederationEvent(tx, { peer: origin, envelope: proof, dataClass: "continuity_protocol" });
    const relayPeers = await tx.federatedNode.findMany({ where: { status: "active", id: { not: origin.id } } });
    for (const peer of relayPeers) {
      await enqueueSignedNodeEvent(
        tx,
        { id: localNode.id, domain: localNode.domain },
        peer.domain,
        "challenge_relay_request",
        { targetDomain: origin.domain, inner: proof as unknown as Record<string, unknown> },
        "continuity_protocol",
      );
    }
    return { ok: true };
  }

  await tx.entityBackup.update({ where: { id: backup.id }, data: { takeoverState: "remote_active" } });
  return { ok: true };
};

// Backup side: the home confirms it replayed our annex log — the cede
// completes; the replica is inert again.
export const handleCatchUpApplied: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  const replica = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: origin.id } },
  });
  if (!replica) return { ok: true };
  if (replica.status !== "takeover_active" && replica.status !== "ceding") return { ok: true };
  const now = new Date();
  await tx.backupReplica.update({
    where: { id: replica.id },
    data: { status: "active", cededAt: now, lastProofOfLifeAt: now },
  });
  if (localNode) {
    await enqueueSignedNodeEvent(
      tx,
      { id: localNode.id, domain: localNode.domain },
      origin.domain,
      "takeover_ceded",
      { entityType, entityId, cededAt: now.toISOString() },
      CONTINUITY_DATA_CLASS,
    );
  }
  return { ok: true };
};

// Home side: the backup's cede acknowledgement — the inbound row is the
// durable record; nothing further to apply.
export const handleTakeoverCeded: FederationInboxHandler = async () => ({ ok: true });

// ── Replay (home side, during quiet-boot catch-up) ──────────────────────────
//
// Idempotent by lastAppliedSeq; author fidelity by escrow-verified DID where
// present. Register D-5: replayed intents import NO weight — an unverified
// join replays as a labeled annex message (a recorded request), never a
// membership; a verified join goes through the ordinary open-join door as
// the member's own account.

export type TakeoverLogRecord = {
  seq: number;
  actionType: string;
  action: Record<string, unknown>;
  actorLabel: string;
};

const ANNEX_MESSAGE_TTL_MS = 180 * 24 * 3_600_000;

async function ensureAnnexThread(
  tx: Prisma.TransactionClient,
  groupId: string,
  authorAccountId: string,
): Promise<string> {
  const existing = await tx.discussionThread.findFirst({
    where: { spaceType: "group", spaceId: groupId, title: "Failover annex" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const thread = await tx.discussionThread.create({
    data: { spaceType: "group", spaceId: groupId, title: "Failover annex", createdByAccountId: authorAccountId },
    select: { id: true },
  });
  return thread.id;
}

type ReplayHandler = (
  tx: Prisma.TransactionClient,
  input: { groupId: string; entry: TakeoverLogRecord; fallbackAuthorId: string },
) => Promise<void>;

export const TAKEOVER_REPLAY_HANDLERS: Record<string, ReplayHandler> = {
  takeover_post_message: async (tx, { groupId, entry, fallbackAuthorId }) => {
    const body = typeof entry.action.body === "string" ? entry.action.body : "";
    if (!body) return;
    const did = typeof entry.action.actorDid === "string" ? entry.action.actorDid : null;
    const verified = did
      ? await tx.account.findFirst({ where: { portableIdentity: { did } }, select: { id: true } })
      : null;
    const authorId = verified?.id ?? fallbackAuthorId;
    const threadId = await ensureAnnexThread(tx, groupId, authorId);
    await tx.discussionMessage.create({
      data: {
        threadId,
        authorId,
        body: verified ? body : `${entry.actorLabel}: ${body}`,
        expiresAt: new Date(Date.now() + ANNEX_MESSAGE_TTL_MS),
      },
    });
    await tx.discussionThread.update({
      where: { id: threadId },
      data: { lastActivityAt: new Date(), messageCount: { increment: 1 } },
    });
  },
  takeover_join_open_group: async (tx, { groupId, entry, fallbackAuthorId }) => {
    const did = typeof entry.action.actorDid === "string" ? entry.action.actorDid : null;
    const verified = did
      ? await tx.account.findFirst({ where: { portableIdentity: { did } }, select: { id: true } })
      : null;
    if (verified) {
      // A known member of this node rejoining through the annex: the
      // ordinary open-join door, as themselves.
      await joinOpenGroup(tx as unknown as PrismaClient, verified.id, groupId);
      return;
    }
    // Unverified: record the intent legibly, import no one (register D-5).
    const threadId = await ensureAnnexThread(tx, groupId, fallbackAuthorId);
    await tx.discussionMessage.create({
      data: {
        threadId,
        authorId: fallbackAuthorId,
        body: `${entry.actorLabel} asked to join this collective during failover.`,
        expiresAt: new Date(Date.now() + ANNEX_MESSAGE_TTL_MS),
      },
    });
    await tx.discussionThread.update({
      where: { id: threadId },
      data: { lastActivityAt: new Date(), messageCount: { increment: 1 } },
    });
  },
};

// The fallback author for annex records: a membership-less local system
// account (it belongs to no group, votes in nothing, counts in no
// denominator — weight-free by construction).
export async function ensureAnnexAuthor(tx: Prisma.TransactionClient, nodeId: string): Promise<string> {
  const existing = await tx.account.findFirst({
    where: { homeNodeId: nodeId, displayName: "Failover annex" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const account = await tx.account.create({
    data: { homeNodeId: nodeId, displayName: "Failover annex", accountType: "participant" },
    select: { id: true },
  });
  return account.id;
}

// Peer lookup passthrough used by the boot module (keeps its imports narrow).
export { getPeerByDomain };
