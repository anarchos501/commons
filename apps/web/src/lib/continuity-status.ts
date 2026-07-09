import type { PrismaClient } from "../generated/prisma/client";
import { continuityStatusQueryHash } from "./continuity-boot";
import { getPeerByDomain } from "./federation-peers";
import { nodeSigningProvider, verifyWithPublicKeyPem } from "./node-keys";
import { hashSignedEventPayload } from "./signed-events";

// The backup-side core of the quiet-boot status pull (register F-4 amended —
// Commons' first pull endpoint). Extracted from the route so tests exercise
// the real verification/cede logic against any database; the route is a thin
// HTTP wrapper.

const REQUEST_WINDOW_MS = 24 * 3_600_000; // beta-generous, same as envelopes
const LOG_CHUNK = 100;

export type ContinuityStatusQuery = {
  origin: string;
  entityType: string;
  entityId: string;
  includeLog: string;
  afterSeq: string;
  ts: string;
  sig: string;
};

export type ContinuityStatusServeResult =
  | { status: 200; body: { payload: Record<string, unknown>; signature: string } }
  | { status: 400 | 401 | 500; body: { error: string } };

export async function serveContinuityStatus(
  prisma: PrismaClient,
  query: ContinuityStatusQuery,
  localNode: { id: string } | null,
  options: { now?: Date } = {},
): Promise<ContinuityStatusServeResult> {
  if (!query.origin || !query.entityType || !query.entityId || !query.ts || !query.sig) {
    return { status: 400, body: { error: "missing_params" } };
  }
  const now = options.now ?? new Date();
  const ts = new Date(query.ts);
  if (Number.isNaN(ts.getTime()) || Math.abs(now.getTime() - ts.getTime()) > REQUEST_WINDOW_MS) {
    return { status: 400, body: { error: "stale_request" } };
  }

  const origin = await getPeerByDomain(prisma, query.origin);
  if (!origin) return { status: 401, body: { error: "unknown_origin" } };
  const { sig, ...signedQuery } = query;
  if (!verifyWithPublicKeyPem(origin.publicKey, continuityStatusQueryHash(signedQuery), sig)) {
    return { status: 401, body: { error: "bad_signature" } };
  }

  const replica = await prisma.backupReplica.findUnique({
    where: {
      entityType_entityId_originPeerId: {
        entityType: query.entityType,
        entityId: query.entityId,
        originPeerId: origin.id,
      },
    },
  });

  let status = "unknown";
  let log: Array<{ seq: number; actionType: string; action: unknown; actorLabel: string }> = [];
  let maxSeq = 0;
  if (replica) {
    if (replica.status === "active" || replica.status === "challenge_open") {
      status = "never_activated";
      // The signed request IS proof of life — close any open challenge.
      if (replica.status === "challenge_open") {
        await prisma.backupReplica.update({
          where: { id: replica.id },
          data: { status: "active", lastProofOfLifeAt: now },
        });
      }
    } else if (replica.status === "takeover_active" || replica.status === "ceding") {
      status = replica.status === "ceding" ? "ceding" : "takeover_active";
      // The home is back and asking: stop accepting takeover writes.
      if (replica.status === "takeover_active") {
        await prisma.backupReplica.update({ where: { id: replica.id }, data: { status: "ceding" } });
      }
      const last = await prisma.takeoverLogEntry.findFirst({
        where: { replicaId: replica.id },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      maxSeq = last?.seq ?? 0;
      if (query.includeLog === "1") {
        const afterSeq = Number.parseInt(query.afterSeq, 10) || 0;
        const entries = await prisma.takeoverLogEntry.findMany({
          where: { replicaId: replica.id, seq: { gt: afterSeq } },
          orderBy: { seq: "asc" },
          take: LOG_CHUNK,
        });
        log = entries.map((entry) => ({
          seq: entry.seq,
          actionType: entry.actionType,
          action: entry.action,
          actorLabel: entry.actorLabel,
        }));
      }
    } else {
      status = "ended";
    }
  }

  if (!localNode) return { status: 500, body: { error: "no_local_node" } };
  const payload = {
    entityType: query.entityType,
    entityId: query.entityId,
    status,
    maxSeq,
    log,
    respondedAt: now.toISOString(),
  };
  const signer = await nodeSigningProvider(prisma, localNode.id);
  const signature = signer.provider.sign(
    hashSignedEventPayload(payload as unknown as Parameters<typeof hashSignedEventPayload>[0]),
    signer.publicKey,
  );
  return { status: 200, body: { payload, signature } };
}
