import { Prisma, type FederatedNode, type PrismaClient } from "../generated/prisma/client";
import {
  parseFederationEnvelope,
  verifyFederationEnvelope,
  type FederationEnvelope,
} from "./federation-envelope";

export type FederationInboxHandlerResult = { ok: true } | { ok: false; reason: string };

// Handlers run inside the same transaction that records the inbound event, so
// dedupe and effects commit atomically. Semantics: return {ok:false} for a
// permanent refusal (recorded, dedupe stops reprocessing); THROW for a
// transient failure (transaction rolls back, no row is kept, the sender's
// outbox redelivers).
export type FederationInboxHandler = (
  tx: Prisma.TransactionClient,
  context: { origin: FederatedNode; envelope: FederationEnvelope },
) => Promise<FederationInboxHandlerResult>;

// Static registry, one entry per wire event type (the PETITION_DETAIL_BUILDERS
// pattern). F1 adds federation_proposal_opened / _decision / agreement_ended /
// suspension_notice here.
const INBOX_HANDLERS: Record<string, FederationInboxHandler> = {
  federation_ping: async () => ({ ok: true }),
};

export const KNOWN_INBOX_EVENT_TYPES = Object.keys(INBOX_HANDLERS);

export type ReceiveFederationEnvelopeResult =
  | { outcome: "applied"; eventId: string }
  | { outcome: "duplicate"; eventId: string }
  | { outcome: "rejected"; reason: string };

export async function receiveFederationEnvelope(
  prisma: PrismaClient,
  body: unknown,
  options: { now?: Date } = {},
): Promise<ReceiveFederationEnvelopeResult> {
  const envelope = parseFederationEnvelope(body);
  if (!envelope) return { outcome: "rejected", reason: "malformed" };

  // Identity lookup is by origin.domain — the pinned identity — never by any
  // delivery address (register F-4: inboxUrl is untrusted routing metadata).
  const origin = await prisma.federatedNode.findUnique({ where: { domain: envelope.origin.domain } });
  if (!origin) return { outcome: "rejected", reason: "unknown_origin" };
  if (origin.status === "suspended" || origin.status === "ended") {
    return { outcome: "rejected", reason: `origin_${origin.status}` };
  }

  const verdict = verifyFederationEnvelope(envelope, origin.publicKey, { now: options.now });
  if (!verdict.ok) return { outcome: "rejected", reason: verdict.reason };

  const handler = INBOX_HANDLERS[envelope.eventType];

  let result: ReceiveFederationEnvelopeResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Insert-first replay guard: the unique(originNodeId, remoteEventId)
      // violation below is the duplicate signal (register F-4).
      const inbound = await tx.federationInboundEvent.create({
        data: {
          originNodeId: origin.id,
          remoteEventId: envelope.eventId,
          eventType: envelope.eventType,
          envelope: envelope as unknown as Prisma.InputJsonValue,
        },
      });

      if (!handler) {
        await tx.federationInboundEvent.update({
          where: { id: inbound.id },
          data: { outcome: "rejected", error: "unknown_event_type", processedAt: new Date() },
        });
        return { outcome: "rejected" as const, reason: "unknown_event_type" };
      }

      const handled = await handler(tx, { origin, envelope });
      await tx.federationInboundEvent.update({
        where: { id: inbound.id },
        data: {
          outcome: handled.ok ? "applied" : "rejected",
          error: handled.ok ? null : handled.reason,
          processedAt: new Date(),
        },
      });
      return handled.ok
        ? { outcome: "applied" as const, eventId: envelope.eventId }
        : { outcome: "rejected" as const, reason: handled.reason };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "duplicate", eventId: envelope.eventId };
    }
    throw error;
  }

  // Best-effort liveness marker; never blocks the verdict.
  try {
    await prisma.federatedNode.update({ where: { id: origin.id }, data: { lastSeenAt: new Date() } });
  } catch {
    // ignore
  }

  return result;
}
