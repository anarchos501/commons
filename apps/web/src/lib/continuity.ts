import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { selfNodeForGroup } from "./continuity-establishment";
import { enqueueSignedNodeEvent } from "./federations";
import { nodeSigningProvider } from "./node-keys";
import { hashSignedEventPayload } from "./signed-events";

// F3.5 Phase 3 — the lease clock (register F-8, F-9).
//
// Write authority over a backed-up entity is a LEASE held by staying
// federation-visible. resolveWriteAuthority is the canViewConcern move: one
// STATELESS predicate on every write path, a pure function of persisted
// timestamps — no demotion daemon, no in-memory state, no race; every
// instance of this node computes the same answer from the same DB rows.
//
// The mirror rule is what makes split-brain impossible BY CONSTRUCTION: the
// primary demotes itself by its OWN clock after windowHours of federation
// silence — the same silence the backup must observe (plus a challenge) to
// activate. Two simultaneous writers would require both sides to see
// contact and silence at once. W ≥ 1h dwarfs any real clock skew.
//
// Never "optimize" this into memory (the standing risk note): verifiedAt
// and the contact timestamps are DB-persisted precisely so restarts and
// multi-instance deployments stay fail-closed.

export type WriteAuthority = "writable" | "read_only" | "unverified";

export function latestContact(peers: Array<{ lastSeenAt: Date | null; lastOutboundOkAt: Date | null }>): Date | null {
  let latest: Date | null = null;
  for (const peer of peers) {
    for (const stamp of [peer.lastSeenAt, peer.lastOutboundOkAt]) {
      if (stamp && (!latest || stamp > latest)) latest = stamp;
    }
  }
  return latest;
}

export async function resolveWriteAuthority(
  client: Prisma.TransactionClient | PrismaClient,
  ref: { entityType: string; entityId: string },
  options: { now?: Date } = {},
): Promise<WriteAuthority> {
  // State 1 (home-no-backup): one indexed miss, zero machinery.
  const backup = await client.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: ref.entityType, entityId: ref.entityId } },
    select: { status: true, windowHours: true, verifiedAt: true, takeoverState: true },
  });
  if (!backup || backup.status !== "active") return "writable";

  // Quiet-boot (register F-9): verifiedAt NULL means this node cannot yet
  // trust its own DB about what happened while it was down.
  if (!backup.verifiedAt) return "unverified";

  // A known remote takeover (or cede in progress) is read-only until caught up.
  if (backup.takeoverState !== "none") return "read_only";

  // Mirror self-demotion: federation-isolated past W ⇒ read-only by our own
  // clock, regardless of what the backup is doing.
  const now = options.now ?? new Date();
  const peers = await client.federatedNode.findMany({
    where: { status: "active" },
    select: { lastSeenAt: true, lastOutboundOkAt: true },
  });
  const contact = latestContact(peers);
  if (!contact) return "read_only";
  const ageMs = now.getTime() - contact.getTime();
  return ageMs > backup.windowHours * 3_600_000 ? "read_only" : "writable";
}

export type HeartbeatResult = { pinged: number; transitionsLogged: number };

// Lease heartbeat + legibility sweep, on the federation tick. Runs ONLY when
// at least one active EntityBackup exists (state-1 honesty: no backups, no
// heartbeat). Pings keep lastOutboundOkAt fresh through quiet periods; the
// legibility log records authority transitions as SignedEvents — a record,
// never an authority (the resolver alone decides, per request).
export async function runContinuityHeartbeat(
  prisma: PrismaClient,
  options: { now?: Date } = {},
): Promise<HeartbeatResult> {
  const result: HeartbeatResult = { pinged: 0, transitionsLogged: 0 };
  const backups = await prisma.entityBackup.findMany({
    where: { status: "active" },
    select: { entityType: true, entityId: true, windowHours: true },
  });
  if (backups.length === 0) return result;
  const now = options.now ?? new Date();

  const minWindowMs = Math.min(...backups.map((backup) => backup.windowHours)) * 3_600_000;
  const staleBefore = new Date(now.getTime() - minWindowMs / 6);

  // Sign pings as the backed-up entities' own node (normally the only node
  // in this database — but never guess by row age).
  const selfNodes = new Map<string, { id: string; domain: string }>();
  for (const backup of backups) {
    if (backup.entityType !== "group") continue;
    const selfNode = await selfNodeForGroup(prisma, backup.entityId);
    if (selfNode) selfNodes.set(selfNode.id, selfNode);
  }
  const firstSelf = [...selfNodes.values()][0];
  if (!firstSelf) return result;

  const peers = await prisma.federatedNode.findMany({ where: { status: "active" } });
  for (const peer of peers) {
    const contact = latestContact([peer]);
    if (contact && contact > staleBefore) continue;
    try {
      const sent = await enqueueSignedNodeEvent(prisma, firstSelf, peer.domain, "federation_ping", {}, "federation_ping");
      if (sent) result.pinged += 1;
    } catch (err) {
      console.error(`[continuity] heartbeat ping to ${peer.domain} failed`, err);
    }
  }

  for (const backup of backups) {
    try {
      const authority = await resolveWriteAuthority(prisma, backup, { now });
      const subjectId = `${backup.entityType}:${backup.entityId}`;
      const previous = await prisma.signedEvent.findFirst({
        where: { eventType: "continuity_authority_changed", subjectId },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      const previousAuthority = (previous?.payload as { authority?: string } | null)?.authority ?? "writable";
      if (previousAuthority === authority) continue;
      const payload = { authority, previousAuthority, at: now.toISOString() };
      const payloadHash = hashSignedEventPayload(payload);
      const signer = await nodeSigningProvider(prisma, firstSelf.id);
      await prisma.signedEvent.create({
        data: {
          eventType: "continuity_authority_changed",
          subjectType: "entity_backup",
          subjectId,
          nodeId: firstSelf.id,
          payload,
          payloadHash,
          signature: signer.provider.sign(payloadHash, signer.publicKey),
          publicKey: signer.publicKey,
        },
      });
      result.transitionsLogged += 1;
    } catch (err) {
      console.error(`[continuity] authority legibility log failed for ${backup.entityId}`, err);
    }
  }

  return result;
}
