import type { PrismaClient } from "../generated/prisma/client";
import { CONTINUITY_DATA_CLASS, selfNodeForEntity } from "./continuity-establishment";
import { ensureAnnexAuthor, TAKEOVER_REPLAY_HANDLERS, type TakeoverLogRecord } from "./continuity-takeover";
import { enqueueSignedNodeEvent } from "./federations";
import { nodeSigningProvider, verifyWithPublicKeyPem } from "./node-keys";
import { hashSignedEventPayload } from "./signed-events";

// F3.5 Phase 4 — quiet-boot (register F-9; first pull endpoint, F-4 amended).
//
// A node that just started CANNOT trust its own database: a takeover may
// have happened while it was down and its rows say "everything is fine".
// markUnverifiedAtBoot runs FIRST in instrumentation.register(): verifiedAt
// NULL fails every backed-up entity closed (the resolver returns
// "unverified") — no boot barrier needed, because authority is a per-request
// DB check; serving starts instantly and is simply read-only until verified.
// Multi-instance safe for the same reason.
//
// Verification is a SIGNED HTTP PULL — Commons' first pull endpoint — not an
// outbox envelope: boot verification needs a bounded synchronous answer to
// leave read-only, and the outbox's async-with-backoff contract is wrong for
// a step that deliberately blocks local writes. The signed request is itself
// proof of life (the backup closes any open challenge on receiving it); the
// signed response verifies against the PINNED peer key — the URL stays
// untrusted routing (F-4 discipline). Unreachable ⇒ stays unverified,
// read-only, retried next tick: the documented safety posture.
//
// Ops note (docs/local-environment.md, DEPLOYMENT.md): every deploy/restart
// therefore causes a seconds-long read-only blip for backed-up entities
// until this round-trips. Fail-safe, intended — never a bug.

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export async function markUnverifiedAtBoot(prisma: PrismaClient): Promise<number> {
  const marked = await prisma.entityBackup.updateMany({
    where: { status: "active" },
    data: { verifiedAt: null },
  });
  return marked.count;
}

export function continuityStatusQueryHash(query: {
  origin: string;
  entityType: string;
  entityId: string;
  includeLog: string;
  afterSeq: string;
  ts: string;
}): string {
  return hashSignedEventPayload(query);
}

type StatusResponse = {
  payload: {
    entityType: string;
    entityId: string;
    status: string;
    maxSeq: number;
    log: TakeoverLogRecord[];
    respondedAt: string;
  };
  signature: string;
};

export type QuietBootResult = { verified: number; caughtUp: number; unreachable: number };

export async function runQuietBootVerification(
  prisma: PrismaClient,
  options: { fetchImpl?: FetchLike; now?: Date; baseUrl?: (domain: string) => string } = {},
): Promise<QuietBootResult> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const toBase = options.baseUrl ?? ((domain: string) => `https://${domain}`);
  const result: QuietBootResult = { verified: 0, caughtUp: 0, unreachable: 0 };

  const pending = await prisma.entityBackup.findMany({
    where: { status: "active", verifiedAt: null },
    include: { peer: true },
  });
  for (const backup of pending) {
    try {
      const selfNode = await selfNodeForEntity(prisma, backup.entityType, backup.entityId);
      if (!selfNode) continue;
      const signer = await nodeSigningProvider(prisma, selfNode.id);
      const pull = async (afterSeq: number, includeLog: boolean): Promise<StatusResponse["payload"]> => {
        const query = {
          origin: selfNode.domain,
          entityType: backup.entityType,
          entityId: backup.entityId,
          includeLog: includeLog ? "1" : "0",
          afterSeq: String(afterSeq),
          ts: (options.now ?? new Date()).toISOString(),
        };
        const sig = signer.provider.sign(continuityStatusQueryHash(query), signer.publicKey);
        const params = new URLSearchParams({ ...query, sig });
        const response = await fetchImpl(`${toBase(backup.peer.domain)}/api/federation/continuity-status?${params}`);
        if (!response.ok) throw new Error("status_pull_failed");
        const body = (await response.json()) as StatusResponse;
        // The response is trusted because it verifies against the PINNED
        // peer key — never because of where the URL pointed.
        const verified = verifyWithPublicKeyPem(
          backup.peer.publicKey,
          hashSignedEventPayload(body.payload as unknown as Parameters<typeof hashSignedEventPayload>[0]),
          body.signature,
        );
        if (!verified) throw new Error("status_response_bad_signature");
        if (body.payload.entityType !== backup.entityType || body.payload.entityId !== backup.entityId) {
          throw new Error("status_response_entity_mismatch");
        }
        return body.payload;
      };

      const status = await pull(backup.lastAppliedSeq, false);
      if (status.status === "never_activated" || status.status === "unknown") {
        await prisma.entityBackup.update({
          where: { id: backup.id },
          data: { verifiedAt: options.now ?? new Date(), takeoverState: "none" },
        });
        result.verified += 1;
        continue;
      }

      // A takeover happened while we were down: read-only stands (the
      // resolver sees takeoverState) while the annex log replays — in
      // order, idempotent by lastAppliedSeq, chunked ≤100.
      await prisma.entityBackup.update({ where: { id: backup.id }, data: { takeoverState: "remote_active" } });
      let appliedThrough = backup.lastAppliedSeq;
      for (;;) {
        const chunk = await pull(appliedThrough, true);
        const entries = chunk.log.filter((entry) => entry.seq > appliedThrough).sort((a, b) => a.seq - b.seq);
        for (const entry of entries) {
          await prisma.$transaction(async (tx) => {
            const handler = TAKEOVER_REPLAY_HANDLERS[entry.actionType];
            const spaceType = backup.entityType as "group" | "project" | "coalition";
            if (handler && ["group", "project", "coalition"].includes(spaceType)) {
              const fallbackAuthorId = await ensureAnnexAuthor(tx, selfNode.id);
              await handler(tx, { spaceType, spaceId: backup.entityId, entry, fallbackAuthorId });
            }
            appliedThrough = entry.seq;
            await tx.entityBackup.update({ where: { id: backup.id }, data: { lastAppliedSeq: entry.seq } });
          });
        }
        if (entries.length === 0 || appliedThrough >= chunk.maxSeq) break;
      }

      await enqueueSignedNodeEvent(
        prisma,
        selfNode,
        backup.peer.domain,
        "catch_up_applied",
        { entityType: backup.entityType, entityId: backup.entityId, appliedThroughSeq: appliedThrough },
        CONTINUITY_DATA_CLASS,
      );
      await prisma.entityBackup.update({
        where: { id: backup.id },
        data: { verifiedAt: options.now ?? new Date(), takeoverState: "none" },
      });
      result.caughtUp += 1;
    } catch {
      // Unreachable or unverifiable: stay unverified (read-only), retry
      // next tick — the documented safety posture, never an error state.
      result.unreachable += 1;
    }
  }
  return result;
}
