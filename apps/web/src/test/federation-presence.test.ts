import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { createFederationEnvelope } from "../lib/federation-envelope";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import { establishPresence, presenceClaim, revokePresence } from "../lib/federation-presence";
import { generateEd25519KeyPairPem, nodeSigningProvider, signWithPrivateKeyPem } from "../lib/node-keys";
import { didKeyFromPublicKeyPem } from "../lib/portable-identity";
import { createPrismaClient } from "../lib/prisma";
import { hashSignedEventPayload } from "../lib/signed-events";
import { cleanupSide, createFederatedPair, ensureSecondDatabase } from "./federation-fixtures";

let prismaA: PrismaClient;
let prismaB: PrismaClient;

before(async () => {
  const secondUrl = await ensureSecondDatabase();
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
});

test("presence establishes across nodes and revokes; both sides mirror it", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "pres_happy", { activate: true });
  try {
    const established = await establishPresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.equal(established.ok, true);
    await pair.pump();

    // Remote side: identity + presence exist, vouched by the home domain.
    const identityOnB = await prismaB.portableIdentity.findFirstOrThrow({
      where: { linkedNodePresences: { some: { nodeId: pair.b.node.id } } },
    });
    assert.ok(identityOnB.did.startsWith("did:key:z6Mk"));
    const presenceOnB = await prismaB.linkedNodePresence.findUniqueOrThrow({
      where: {
        portableIdentityId_nodeId: { portableIdentityId: identityOnB.id, nodeId: pair.b.node.id },
      },
    });
    assert.equal(presenceOnB.status, "active");
    assert.equal(presenceOnB.homeNodeDomain, pair.a.domain);

    // Home side: mirror row + the durable identity-signed SignedEvent.
    const mirror = await prismaA.linkedNodePresence.findFirstOrThrow({
      where: { node: { domain: pair.b.domain } },
    });
    assert.equal(mirror.status, "active");
    const signedEvents = await prismaA.signedEvent.count({
      where: { eventType: "identity_presence_updated", actorAccountId: pair.a.stewardAccountId },
    });
    assert.ok(signedEvents >= 1);

    // Revocation propagates.
    const revoked = await revokePresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.equal(revoked.ok, true);
    await pair.pump();
    const presenceAfter = await prismaB.linkedNodePresence.findUniqueOrThrow({
      where: {
        portableIdentityId_nodeId: { portableIdentityId: identityOnB.id, nodeId: pair.b.node.id },
      },
    });
    assert.equal(presenceAfter.status, "revoked");
    const mirrorAfter = await prismaA.linkedNodePresence.findFirstOrThrow({
      where: { node: { domain: pair.b.domain } },
    });
    assert.equal(mirrorAfter.status, "revoked");
  } finally {
    await cleanupSide(prismaA, "pres_happy");
    await cleanupSide(prismaB, "pres_happy");
  }
});

test("presence requires an ACTIVE agreement (register D-3: linked_node_presence class)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "pres_gate"); // peers stay proposed
  try {
    const refused = await establishPresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.deepEqual(refused, { ok: false, reason: "not_federable" });
  } finally {
    await cleanupSide(prismaA, "pres_gate");
    await cleanupSide(prismaB, "pres_gate");
  }
});

test("a home node cannot vouch for another domain's members (home spoof)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "pres_spoof", { activate: true });
  try {
    const memberKeys = generateEd25519KeyPairPem();
    const did = didKeyFromPublicKeyPem(memberKeys.publicKeyPem);
    const claim = presenceClaim({
      purpose: "presence_establish",
      did,
      handle: "Spoofed",
      homeNodeDomain: "elsewhere.example", // not the sending node's domain
      displayName: "Spoofed",
      nonce: "spoof-nonce",
    });
    const signerA = await nodeSigningProvider(prismaA, pair.a.node.id);
    const envelope = createFederationEnvelope({
      eventType: "presence_establish",
      payload: {
        did,
        publicKey: memberKeys.publicKeyPem,
        handle: "Spoofed",
        displayName: "Spoofed",
        homeNodeDomain: "elsewhere.example",
        nonce: "spoof-nonce",
        actorSignature: signWithPrivateKeyPem(memberKeys.privateKeyPem, hashSignedEventPayload(claim)),
      },
      originDomain: pair.a.domain,
      keyId: signerA.keyId,
      signer: signerA.provider,
      publicKey: signerA.publicKey,
    });

    const outcome = await receiveFederationEnvelope(prismaB, JSON.parse(JSON.stringify(envelope)), {
      localNode: pair.b.node,
    });
    assert.deepEqual(outcome, { outcome: "rejected", reason: "home_mismatch" });
  } finally {
    await cleanupSide(prismaA, "pres_spoof");
    await cleanupSide(prismaB, "pres_spoof");
  }
});

test("a known DID presenting a different key is refused (identity keys pin)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "pres_pin", { activate: true });
  try {
    const established = await establishPresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.equal(established.ok, true);
    await pair.pump();

    const identityOnB = await prismaB.portableIdentity.findFirstOrThrow({
      where: { linkedNodePresences: { some: { nodeId: pair.b.node.id } } },
    });

    // Same DID string, different key: did/key self-certification must refuse
    // it before any pinning question even arises.
    const otherKeys = generateEd25519KeyPairPem();
    const claim = presenceClaim({
      purpose: "presence_establish",
      did: identityOnB.did,
      handle: "Imposter",
      homeNodeDomain: pair.a.domain,
      displayName: "Imposter",
      nonce: "imposter-nonce",
    });
    const signerA = await nodeSigningProvider(prismaA, pair.a.node.id);
    const envelope = createFederationEnvelope({
      eventType: "presence_establish",
      payload: {
        did: identityOnB.did,
        publicKey: otherKeys.publicKeyPem,
        handle: "Imposter",
        displayName: "Imposter",
        homeNodeDomain: pair.a.domain,
        nonce: "imposter-nonce",
        actorSignature: signWithPrivateKeyPem(otherKeys.privateKeyPem, hashSignedEventPayload(claim)),
      },
      originDomain: pair.a.domain,
      keyId: signerA.keyId,
      signer: signerA.provider,
      publicKey: signerA.publicKey,
    });
    const outcome = await receiveFederationEnvelope(prismaB, JSON.parse(JSON.stringify(envelope)), {
      localNode: pair.b.node,
    });
    assert.deepEqual(outcome, { outcome: "rejected", reason: "did_key_mismatch" });
  } finally {
    await cleanupSide(prismaA, "pres_pin");
    await cleanupSide(prismaB, "pres_pin");
  }
});
