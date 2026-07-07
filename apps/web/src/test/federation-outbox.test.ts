import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { FederatedNode } from "../generated/prisma/client";
import { createFederationEnvelope, type FederationEnvelope } from "../lib/federation-envelope";
import {
  createInMemoryFederationTransport,
  deliverPendingFederationEvents,
  enqueueFederationEvent,
  MAX_DELIVERY_ATTEMPTS,
  type FederationTransport,
} from "../lib/federation-outbox";
import { generateEd25519KeyPairPem, signWithPrivateKeyPem } from "../lib/node-keys";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();
const createdPeerIds: string[] = [];

test.after(async () => {
  await prisma.federatedNode.deleteMany({ where: { id: { in: createdPeerIds } } });
  await prisma.$disconnect();
});

async function createPeer(status: string): Promise<FederatedNode> {
  const { publicKeyPem } = generateEd25519KeyPairPem();
  const peer = await prisma.federatedNode.create({
    data: { domain: `peer-${randomUUID()}.example`, publicKey: publicKeyPem, status },
  });
  createdPeerIds.push(peer.id);
  return peer;
}

function pingEnvelope(): FederationEnvelope {
  const { publicKeyPem, privateKeyPem } = generateEd25519KeyPairPem();
  return createFederationEnvelope({
    eventType: "federation_ping",
    payload: { ping: randomUUID() },
    originDomain: "sender.example",
    keyId: "key_1",
    signer: { sign: (hash) => signWithPrivateKeyPem(privateKeyPem, hash) },
    publicKey: publicKeyPem,
  });
}

test("enqueue refuses data classes mayFederate denies (register D-3)", async () => {
  const peer = await createPeer("active");
  const refused = await enqueueFederationEvent(prisma, {
    peer,
    envelope: pingEnvelope(),
    dataClass: "support_request",
  });
  assert.deepEqual(refused, { ok: false, reason: "data_class_not_federable" });

  const notActive = await enqueueFederationEvent(prisma, {
    peer: await createPeer("proposed"),
    envelope: pingEnvelope(),
    dataClass: "contribution",
  });
  assert.deepEqual(notActive, { ok: false, reason: "data_class_not_federable" });
});

test("a ping to a proposed peer is enqueued and delivered through the transport", async () => {
  const peer = await createPeer("proposed");
  const envelope = pingEnvelope();
  const enqueued = await enqueueFederationEvent(prisma, { peer, envelope, dataClass: "federation_ping" });
  assert.equal(enqueued.ok, true);

  const seen: string[] = [];
  const transport = createInMemoryFederationTransport(async (domain, delivered) => {
    seen.push(`${domain}:${delivered.eventId}`);
    return { ok: true };
  });

  const result = await deliverPendingFederationEvents(prisma, transport);
  assert.ok(result.delivered >= 1);
  assert.ok(seen.includes(`${peer.domain}:${envelope.eventId}`));

  const item = await prisma.federationOutboxItem.findUniqueOrThrow({ where: { eventId: envelope.eventId } });
  assert.equal(item.status, "delivered");
  assert.ok(item.deliveredAt);
});

test("retryable failure backs off; non-retryable failure dead-letters", async () => {
  const peer = await createPeer("active");
  const retryableEnvelope = pingEnvelope();
  const fatalEnvelope = pingEnvelope();
  await enqueueFederationEvent(prisma, { peer, envelope: retryableEnvelope, dataClass: "federation_ping" });
  await enqueueFederationEvent(prisma, { peer, envelope: fatalEnvelope, dataClass: "federation_ping" });

  const transport: FederationTransport = {
    deliver: async (_peer, envelope) =>
      envelope.eventId === fatalEnvelope.eventId
        ? { ok: false, retryable: false, error: "http_400" }
        : { ok: false, retryable: true, error: "http_503" },
  };

  const now = new Date();
  await deliverPendingFederationEvents(prisma, transport, { now });

  const retried = await prisma.federationOutboxItem.findUniqueOrThrow({
    where: { eventId: retryableEnvelope.eventId },
  });
  assert.equal(retried.status, "pending");
  assert.equal(retried.attempts, 1);
  assert.equal(retried.lastError, "http_503");
  assert.ok(retried.nextAttemptAt.getTime() > now.getTime());

  const dead = await prisma.federationOutboxItem.findUniqueOrThrow({
    where: { eventId: fatalEnvelope.eventId },
  });
  assert.equal(dead.status, "dead");
  assert.equal(dead.lastError, "http_400");
});

test("delivery gives up after the attempt cap", async () => {
  const peer = await createPeer("active");
  const envelope = pingEnvelope();
  await enqueueFederationEvent(prisma, { peer, envelope, dataClass: "federation_ping" });

  const alwaysFail: FederationTransport = {
    deliver: async () => ({ ok: false, retryable: true, error: "network" }),
  };

  // Sweep with a clock far enough ahead each round that backoff never defers.
  for (let round = 0; round < MAX_DELIVERY_ATTEMPTS; round += 1) {
    await deliverPendingFederationEvents(prisma, alwaysFail, {
      now: new Date(Date.now() + (round + 1) * 2 * 60 * 60 * 1000),
    });
  }

  const item = await prisma.federationOutboxItem.findUniqueOrThrow({ where: { eventId: envelope.eventId } });
  assert.equal(item.status, "dead");
  assert.equal(item.attempts, MAX_DELIVERY_ATTEMPTS);
});

// register D-3: "one predicate, every path" holds only if the transport is
// architecturally private to the outbox. This scans application source (not
// tests, not generated code) and fails if any file other than the outbox
// module calls a transport's deliver(), or any file other than the outbox and
// the instrumentation bootstrap references the HTTPS transport constructor.
test("the transport is private to the outbox — no source path bypasses the enqueue chokepoint", () => {
  const srcRoot = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "generated" || entry.name === "node_modules") continue;
        walk(path);
      } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(srcRoot);

  const deliverCallers: string[] = [];
  const transportImporters: string[] = [];
  for (const file of files) {
    const relative = file.slice(srcRoot.length + 1);
    const content = readFileSync(file, "utf8");
    if (/\.deliver\(/.test(content) && relative !== "lib/federation-outbox.ts") {
      deliverCallers.push(relative);
    }
    if (
      content.includes("httpsFederationTransport") &&
      relative !== "lib/federation-outbox.ts" &&
      relative !== "instrumentation.ts"
    ) {
      transportImporters.push(relative);
    }
  }

  assert.deepEqual(deliverCallers, [], `transport.deliver() called outside the outbox: ${deliverCallers.join(", ")}`);
  assert.deepEqual(
    transportImporters,
    [],
    `httpsFederationTransport referenced outside outbox/instrumentation: ${transportImporters.join(", ")}`,
  );
});

test("a suspended peer pauses delivery; an ended peer dead-letters it", async () => {
  const suspended = await createPeer("suspended");
  const ended = await createPeer("ended");
  const suspendedEnvelope = pingEnvelope();
  const endedEnvelope = pingEnvelope();

  // Enqueue while the peers still accept protocol traffic, then flip status —
  // simulating suspension/termination landing after enqueue.
  await prisma.federatedNode.update({ where: { id: suspended.id }, data: { status: "proposed" } });
  await prisma.federatedNode.update({ where: { id: ended.id }, data: { status: "proposed" } });
  await enqueueFederationEvent(prisma, {
    peer: { id: suspended.id, status: "proposed" },
    envelope: suspendedEnvelope,
    dataClass: "federation_ping",
  });
  await enqueueFederationEvent(prisma, {
    peer: { id: ended.id, status: "proposed" },
    envelope: endedEnvelope,
    dataClass: "federation_ping",
  });
  await prisma.federatedNode.update({ where: { id: suspended.id }, data: { status: "suspended" } });
  await prisma.federatedNode.update({ where: { id: ended.id }, data: { status: "ended" } });

  const transport = createInMemoryFederationTransport(async () => ({ ok: true }));
  await deliverPendingFederationEvents(prisma, transport);

  const paused = await prisma.federationOutboxItem.findUniqueOrThrow({
    where: { eventId: suspendedEnvelope.eventId },
  });
  assert.equal(paused.status, "pending");

  const deadLettered = await prisma.federationOutboxItem.findUniqueOrThrow({
    where: { eventId: endedEnvelope.eventId },
  });
  assert.equal(deadLettered.status, "dead");
  assert.equal(deadLettered.lastError, "peer_ended");
});
