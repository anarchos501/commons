import { Prisma, type FederatedNode, type Node, type PrismaClient } from "../generated/prisma/client";
import { CONTINUITY_DATA_CLASS, countLocalMembers, selfNodeForGroup } from "./continuity-establishment";
import type { FederationEnvelope } from "./federation-envelope";
import { enqueueSignedNodeEvent } from "./federations";
import { buildEscrowEntries } from "./identity-escrow";
import { stableStringify, type SignedEventPayload } from "./signed-events";

// F3.5 Phase 2 — structural delta replication (register D-10).
//
// Tier A only until F4: the manifest is a PLAINTEXT SKELETON the backup
// operator can read, so it must never carry content. The discipline, at the
// one review-gated function that builds it (register D-10):
//   - counts, not rosters (member COUNT via the locals-only filter);
//   - family labels and states, never petition content or rationales;
//   - calendar timing skeleton, titles only when the event is public.
// Titles are the leak vector. Anything richer waits for the Tier-B ciphertext
// archive (with/after F4). Escrow entries ride alongside but are ciphertext
// by construction — the cannot-read tier, not part of the manifest.
//
// Deltas are WHOLE-MANIFEST replacements keyed by seq (manifests are small;
// JSON-patch is an optimization, not a correctness need). That makes every
// delta self-contained: the backup applies any seq NEWER than what it holds
// and ignores the rest — out-of-order delivery self-heals without a separate
// snapshot type. Bandwidth tracks activity: no change, no bytes.

export type StructuralManifest = {
  v: 1;
  entityType: string;
  entityId: string;
  name: string;
  memberCount: number;
  petitions: Array<{ id: string; familyLabel: string; status: string; closesAt: string }>;
  calendar: Array<{ id: string; startTime: string; title: string | null }>;
};

export async function buildStructuralManifest(
  client: Prisma.TransactionClient | PrismaClient,
  ref: { entityType: string; entityId: string },
): Promise<StructuralManifest | null> {
  if (ref.entityType !== "group") return null; // project/coalition builders land in Phase 5
  const group = await client.group.findUnique({
    where: { id: ref.entityId },
    select: { name: true, archivedAt: true },
  });
  if (!group || group.archivedAt) return null;

  const [memberCount, petitions, events] = await Promise.all([
    countLocalMembers(client, ref.entityId),
    client.petition.findMany({
      where: { scopeType: "group", scopeId: ref.entityId, archivedAt: null },
      select: { id: true, subjectType: true, status: true, closesAt: true },
      orderBy: { opensAt: "desc" },
      take: 50,
    }),
    client.calendarEvent.findMany({
      where: { hostType: "group", hostId: ref.entityId, startTime: { gte: new Date() } },
      select: { id: true, startTime: true, title: true, visibility: true },
      orderBy: { startTime: "asc" },
      take: 50,
    }),
  ]);

  return {
    v: 1,
    entityType: ref.entityType,
    entityId: ref.entityId,
    name: group.name,
    memberCount,
    petitions: petitions.map((petition) => ({
      id: petition.id,
      familyLabel: petition.subjectType, // the family string, never content
      status: petition.status,
      closesAt: petition.closesAt.toISOString(),
    })),
    calendar: events.map((event) => ({
      id: event.id,
      startTime: event.startTime.toISOString(),
      title: event.visibility === "public" ? event.title : null,
    })),
  };
}

export type ReplicationSweepResult = { attempted: number; replicated: number; skipped: number };

// Sibling of deliverPendingFederationEvents: batch, per-item try/catch,
// counters, {now} injection. Runs on the federation tick.
export async function runContinuityReplicationSweep(
  prisma: PrismaClient,
  options: { now?: Date } = {},
): Promise<ReplicationSweepResult> {
  const backups = await prisma.entityBackup.findMany({
    where: { status: "active", takeoverState: "none" },
    include: { peer: true },
  });
  const result: ReplicationSweepResult = { attempted: 0, replicated: 0, skipped: 0 };
  for (const backup of backups) {
    result.attempted += 1;
    try {
      // Sign as the entity's own node — the origin the peer has pinned.
      const selfNode = await selfNodeForGroup(prisma, backup.entityId);
      if (!selfNode) {
        result.skipped += 1;
        continue;
      }
      const manifest = await buildStructuralManifest(prisma, backup);
      if (!manifest) {
        result.skipped += 1;
        continue;
      }
      const escrow = backup.entityType === "group" ? await buildEscrowEntries(prisma, backup.entityId) : [];
      const payload = { manifest, escrow } as unknown as SignedEventPayload;
      const previous = backup.lastManifest ? stableStringify(backup.lastManifest) : null;
      if (previous === stableStringify(payload)) {
        result.skipped += 1; // no change, no bytes
        continue;
      }
      const seq = backup.manifestSeq + 1;
      const delivered = await enqueueSignedNodeEvent(
        prisma,
        selfNode,
        backup.peer.domain,
        "backup_delta",
        { entityType: backup.entityType, entityId: backup.entityId, seq, manifest, escrow },
        CONTINUITY_DATA_CLASS,
      );
      if (!delivered) {
        result.skipped += 1;
        continue;
      }
      await prisma.entityBackup.update({
        where: { id: backup.id },
        data: {
          manifestSeq: seq,
          lastManifest: payload as unknown as Prisma.InputJsonValue,
          lastReplicatedAt: options.now ?? new Date(),
        },
      });
      result.replicated += 1;
    } catch (err) {
      console.error(`[continuity] replication failed for ${backup.entityType}:${backup.entityId}`, err);
    }
  }
  return result;
}

// Backup-side apply: any seq newer than held wins (self-contained deltas).
export const handleBackupDelta = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null },
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  const seq = typeof p.seq === "number" ? p.seq : null;
  if (!entityType || !entityId || seq === null || typeof p.manifest !== "object" || p.manifest === null) {
    return { ok: false, reason: "malformed_payload" };
  }
  const replica = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: origin.id } },
  });
  if (!replica) return { ok: false, reason: "unknown_replica" };
  if (replica.status === "ended" || replica.status === "refused" || replica.status === "pending_consent") {
    return { ok: false, reason: `replica_${replica.status}` };
  }
  if (seq <= replica.manifestSeq) return { ok: true }; // stale/duplicate: idempotent

  const manifest = p.manifest as Record<string, unknown>;
  await tx.backupReplica.update({
    where: { id: replica.id },
    data: {
      manifest: manifest as Prisma.InputJsonValue,
      escrowEntries: (p.escrow ?? []) as Prisma.InputJsonValue,
      manifestSeq: seq,
      entityName: typeof manifest.name === "string" ? manifest.name : replica.entityName,
      memberCount: typeof manifest.memberCount === "number" ? manifest.memberCount : replica.memberCount,
    },
  });
  return { ok: true };
};
