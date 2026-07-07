import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FederatedNode } from "../generated/prisma/client";
import { createFederationEnvelope, type FederationEnvelope } from "../lib/federation-envelope";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import {
  createInMemoryFederationTransport,
  deliverPendingFederationEvents,
  enqueueFederationEvent,
} from "../lib/federation-outbox";
import { generateEd25519KeyPairPem, signWithPrivateKeyPem } from "../lib/node-keys";
import { createPrismaClient } from "../lib/prisma";
import type { SigningProvider } from "../lib/signed-events";

const prisma = createPrismaClient();
const createdPeerIds: string[] = [];

test.after(async () => {
  await prisma.federatedNode.deleteMany({ where: { id: { in: createdPeerIds } } });
  await prisma.$disconnect();
});

type Origin = {
  peer: FederatedNode;
  signer: SigningProvider;
  publicKeyPem: string;
};

// A pinned origin: the receiver's record of the sending node, holding the key
// envelopes are verified against.
async function createPinnedOrigin(status = "proposed"): Promise<Origin> {
  const { publicKeyPem, privateKeyPem } = generateEd25519KeyPairPem();
  const peer = await prisma.federatedNode.create({
    data: { domain: `origin-${randomUUID()}.example`, publicKey: publicKeyPem, status },
  });
  createdPeerIds.push(peer.id);
  return { peer, publicKeyPem, signer: { sign: (hash) => signWithPrivateKeyPem(privateKeyPem, hash) } };
}

function envelopeFrom(origin: Origin, overrides: { eventType?: string } = {}): FederationEnvelope {
  return createFederationEnvelope({
    eventType: overrides.eventType ?? "federation_ping",
    payload: { ping: randomUUID() },
    originDomain: origin.peer.domain,
    keyId: "key_1",
    signer: origin.signer,
    publicKey: origin.publicKeyPem,
  });
}

test("a verified ping is applied and recorded; replaying it is a deduped no-op", async () => {
  const origin = await createPinnedOrigin();
  const envelope = envelopeFrom(origin);

  const first = await receiveFederationEnvelope(prisma, envelope);
  assert.deepEqual(first, { outcome: "applied", eventId: envelope.eventId });

  const replay = await receiveFederationEnvelope(prisma, JSON.parse(JSON.stringify(envelope)));
  assert.deepEqual(replay, { outcome: "duplicate", eventId: envelope.eventId });

  const rows = await prisma.federationInboundEvent.findMany({
    where: { originNodeId: origin.peer.id, remoteEventId: envelope.eventId },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "applied");
  assert.ok(rows[0].processedAt);

  const touched = await prisma.federatedNode.findUniqueOrThrow({ where: { id: origin.peer.id } });
  assert.ok(touched.lastSeenAt, "receipt should update lastSeenAt");
});

test("an envelope from an unpinned origin is rejected", async () => {
  const origin = await createPinnedOrigin();
  const envelope = envelopeFrom(origin);
  await prisma.federatedNode.delete({ where: { id: origin.peer.id } });
  createdPeerIds.splice(createdPeerIds.indexOf(origin.peer.id), 1);

  assert.deepEqual(await receiveFederationEnvelope(prisma, envelope), {
    outcome: "rejected",
    reason: "unknown_origin",
  });
});

test("a tampered or foreign-signed envelope is rejected without a recorded event", async () => {
  const origin = await createPinnedOrigin();
  const envelope = envelopeFrom(origin);

  const tampered = { ...envelope, payload: { ping: "swapped" } };
  assert.deepEqual(await receiveFederationEnvelope(prisma, tampered), {
    outcome: "rejected",
    reason: "payload_hash_mismatch",
  });

  const other = await createPinnedOrigin();
  const impersonation = { ...envelopeFrom(other), origin: { domain: origin.peer.domain, keyId: "key_1" } };
  const verdict = await receiveFederationEnvelope(prisma, impersonation);
  assert.equal(verdict.outcome, "rejected");

  const rows = await prisma.federationInboundEvent.findMany({ where: { originNodeId: origin.peer.id } });
  assert.equal(rows.length, 0, "rejected envelopes must not consume dedupe slots");
});

test("suspended and ended origins are refused", async () => {
  for (const status of ["suspended", "ended"]) {
    const origin = await createPinnedOrigin(status);
    assert.deepEqual(await receiveFederationEnvelope(prisma, envelopeFrom(origin)), {
      outcome: "rejected",
      reason: `origin_${status}`,
    });
  }
});

test("an unknown event type is rejected but recorded, so redelivery dedupes", async () => {
  const origin = await createPinnedOrigin();
  const envelope = envelopeFrom(origin, { eventType: "federation_mystery" });

  assert.deepEqual(await receiveFederationEnvelope(prisma, envelope), {
    outcome: "rejected",
    reason: "unknown_event_type",
  });
  assert.deepEqual(await receiveFederationEnvelope(prisma, envelope), {
    outcome: "duplicate",
    eventId: envelope.eventId,
  });

  const row = await prisma.federationInboundEvent.findUniqueOrThrow({
    where: {
      originNodeId_remoteEventId: { originNodeId: origin.peer.id, remoteEventId: envelope.eventId },
    },
  });
  assert.equal(row.outcome, "rejected");
  assert.equal(row.error, "unknown_event_type");
});

// The production replay case: two identical envelopes arriving at once (e.g.
// a retry racing a slow first delivery). The DB unique constraint — not
// application logic — decides the winner; the handler's effects and the
// dedupe row commit in the same transaction, so a crash between them cannot
// replay the effect.
test("concurrent identical envelopes: exactly one applies, the other dedupes", async () => {
  const origin = await createPinnedOrigin();
  const envelope = envelopeFrom(origin);

  const [first, second] = await Promise.all([
    receiveFederationEnvelope(prisma, envelope),
    receiveFederationEnvelope(prisma, JSON.parse(JSON.stringify(envelope))),
  ]);

  assert.deepEqual([first.outcome, second.outcome].sort(), ["applied", "duplicate"]);

  const rows = await prisma.federationInboundEvent.findMany({
    where: { originNodeId: origin.peer.id, remoteEventId: envelope.eventId },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "applied");
});

test("malformed bodies are rejected as malformed", async () => {
  assert.deepEqual(await receiveFederationEnvelope(prisma, { not: "an envelope" }), {
    outcome: "rejected",
    reason: "malformed",
  });
});

// The F0 exit criterion, in one process: sender enqueues through the
// chokepoint, the sweep delivers via the transport seam, the receiver
// verifies, applies, and dedupes the redelivered copy.
test("outbox → transport → inbox roundtrip applies once end-to-end", async () => {
  const origin = await createPinnedOrigin(); // sender, as pinned by the receiver
  const target = await createPinnedOrigin(); // delivery target peer record on the sender side
  const envelope = envelopeFrom(origin);

  const transport = createInMemoryFederationTransport(async (_domain, delivered) => {
    const outcome = await receiveFederationEnvelope(prisma, delivered);
    return outcome.outcome === "applied" || outcome.outcome === "duplicate"
      ? { ok: true }
      : { ok: false, retryable: false, error: outcome.reason };
  });

  const enqueued = await enqueueFederationEvent(prisma, {
    peer: target.peer,
    envelope,
    dataClass: "federation_ping",
  });
  assert.equal(enqueued.ok, true);

  await deliverPendingFederationEvents(prisma, transport);
  const item = await prisma.federationOutboxItem.findUniqueOrThrow({ where: { eventId: envelope.eventId } });
  assert.equal(item.status, "delivered");

  // Redelivery (e.g. after a lost ack) is safe: the receiver dedupes.
  const redelivery = await receiveFederationEnvelope(prisma, envelope);
  assert.equal(redelivery.outcome, "duplicate");

  const rows = await prisma.federationInboundEvent.findMany({
    where: { originNodeId: origin.peer.id, remoteEventId: envelope.eventId },
  });
  assert.equal(rows.length, 1);
});
