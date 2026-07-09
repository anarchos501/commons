import type { FederatedNode, FederationOutboxItem, Prisma, PrismaClient } from "../generated/prisma/client";
import { mayFederate, type FederationDataClass } from "./federation-data-classes";
import type { FederationEnvelope } from "./federation-envelope";
import { peerBaseUrl } from "./federation-peers";

export type FederationDeliveryResult = { ok: true } | { ok: false; retryable: boolean; error: string };

// The transport seam: the HTTPS implementation is production; tests inject an
// in-memory implementation and run both "nodes" in one process.
//
// register D-3: the transport is architecturally private to the outbox —
// deliver() is called ONLY from deliverPendingFederationEvents, so nothing
// reaches the wire except items that passed the enqueue chokepoint. Do not
// call a transport directly from feature code (a "resend" path, a helper);
// enqueue instead. federation-outbox.test.ts asserts this by scanning src/.
export type FederationTransport = {
  deliver(peer: Pick<FederatedNode, "domain" | "inboxUrl">, envelope: FederationEnvelope): Promise<FederationDeliveryResult>;
};

export function httpsFederationTransport(fetchImpl: typeof fetch = fetch): FederationTransport {
  return {
    async deliver(peer, envelope) {
      const url = peer.inboxUrl ?? `${peerBaseUrl(peer.domain)}/api/federation/inbox`;
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
        });
        if (response.ok) return { ok: true };
        const retryable = response.status === 429 || response.status >= 500;
        return { ok: false, retryable, error: `http_${response.status}` };
      } catch (error) {
        return { ok: false, retryable: true, error: error instanceof Error ? error.message : "network_error" };
      }
    },
  };
}

export function createInMemoryFederationTransport(
  receive: (peerDomain: string, envelope: FederationEnvelope) => Promise<FederationDeliveryResult>,
): FederationTransport {
  return {
    deliver: (peer, envelope) => receive(peer.domain, envelope),
  };
}

export type EnqueueFederationEventResult =
  | { ok: true; outboxItemId: string }
  | { ok: false; reason: "data_class_not_federable" };

// register D-3: the outbound half of the chokepoint. Nothing reaches the wire
// except through this enqueue, and this enqueue refuses anything mayFederate
// denies — vulnerability classes structurally cannot be queued.
export async function enqueueFederationEvent(
  client: Prisma.TransactionClient | PrismaClient,
  input: {
    peer: Pick<FederatedNode, "id" | "status">;
    envelope: FederationEnvelope;
    dataClass: FederationDataClass;
    ciphertext?: boolean;
  },
): Promise<EnqueueFederationEventResult> {
  if (!mayFederate(input.dataClass, input.peer, { ciphertext: input.ciphertext })) {
    return { ok: false, reason: "data_class_not_federable" };
  }

  const item = await client.federationOutboxItem.create({
    data: {
      eventId: input.envelope.eventId,
      peerId: input.peer.id,
      eventType: input.envelope.eventType,
      envelope: input.envelope as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, outboxItemId: item.id };
}

export const MAX_DELIVERY_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
}

export type DeliverPendingResult = { attempted: number; delivered: number; retried: number; dead: number };

// Sibling of resolveExpiredPetitions: batch, per-item try/catch, counters.
// Runs from the instrumentation sweep — a dead peer degrades cross-node
// delivery, never local operation.
export async function deliverPendingFederationEvents(
  prisma: PrismaClient,
  transport: FederationTransport,
  options: { now?: Date; batchSize?: number } = {},
): Promise<DeliverPendingResult> {
  const now = options.now ?? new Date();
  const items = await prisma.federationOutboxItem.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    include: { peer: true },
    orderBy: { createdAt: "asc" },
    take: options.batchSize ?? 50,
  });

  const result: DeliverPendingResult = { attempted: 0, delivered: 0, retried: 0, dead: 0 };

  for (const item of items) {
    result.attempted += 1;

    // A suspended peer pauses delivery (items stay pending, retried later);
    // an ended peer dead-letters them.
    if (item.peer.status === "suspended") {
      result.retried += 1;
      continue;
    }
    if (item.peer.status === "ended") {
      await markDead(prisma, item, "peer_ended");
      result.dead += 1;
      continue;
    }

    let delivery: FederationDeliveryResult;
    try {
      delivery = await transport.deliver(item.peer, item.envelope as unknown as FederationEnvelope);
    } catch (error) {
      delivery = { ok: false, retryable: true, error: error instanceof Error ? error.message : "transport_error" };
    }

    if (delivery.ok) {
      await prisma.federationOutboxItem.update({
        where: { id: item.id },
        data: { status: "delivered", deliveredAt: new Date(), attempts: item.attempts + 1, lastError: null },
      });
      // Lease visibility (register F-9): a successful outbound delivery is
      // federation contact — max(lastSeenAt, lastOutboundOkAt) feeds the
      // write-authority clock in resolveWriteAuthority.
      await prisma.federatedNode.update({
        where: { id: item.peerId },
        data: { lastOutboundOkAt: now },
      });
      result.delivered += 1;
      continue;
    }

    const attempts = item.attempts + 1;
    if (!delivery.retryable || attempts >= MAX_DELIVERY_ATTEMPTS) {
      await markDead(prisma, item, delivery.error, attempts);
      result.dead += 1;
    } else {
      await prisma.federationOutboxItem.update({
        where: { id: item.id },
        data: {
          attempts,
          lastError: delivery.error,
          nextAttemptAt: new Date(now.getTime() + nextBackoffMs(attempts)),
        },
      });
      result.retried += 1;
    }
  }

  return result;
}

async function markDead(
  prisma: PrismaClient,
  item: FederationOutboxItem,
  error: string,
  attempts?: number,
): Promise<void> {
  await prisma.federationOutboxItem.update({
    where: { id: item.id },
    data: { status: "dead", lastError: error, attempts: attempts ?? item.attempts },
  });
}
