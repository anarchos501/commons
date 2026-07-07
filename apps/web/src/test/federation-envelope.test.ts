import assert from "node:assert/strict";
import test from "node:test";
import {
  createFederationEnvelope,
  parseFederationEnvelope,
  verifyFederationEnvelope,
  DEFAULT_MAX_ENVELOPE_AGE_MS,
} from "../lib/federation-envelope";
import { generateEd25519KeyPairPem, signWithPrivateKeyPem } from "../lib/node-keys";
import type { SigningProvider } from "../lib/signed-events";

function testSigner(): { publicKeyPem: string; signer: SigningProvider } {
  const { publicKeyPem, privateKeyPem } = generateEd25519KeyPairPem();
  return { publicKeyPem, signer: { sign: (hash) => signWithPrivateKeyPem(privateKeyPem, hash) } };
}

function makeEnvelope(overrides: { createdAt?: Date; expiresAt?: Date | null } = {}) {
  const { publicKeyPem, signer } = testSigner();
  const envelope = createFederationEnvelope({
    eventType: "federation_ping",
    payload: { hello: "node-b", n: 1 },
    originDomain: "node-a.example",
    keyId: "key_1",
    signer,
    publicKey: publicKeyPem,
    createdAt: overrides.createdAt,
    expiresAt: overrides.expiresAt,
  });
  return { envelope, publicKeyPem };
}

test("envelope signs and verifies roundtrip", () => {
  const { envelope, publicKeyPem } = makeEnvelope();
  assert.deepEqual(verifyFederationEnvelope(envelope, publicKeyPem), { ok: true });
});

test("payload tampering is detected via the payload hash", () => {
  const { envelope, publicKeyPem } = makeEnvelope();
  const tampered = { ...envelope, payload: { hello: "attacker", n: 1 } };
  assert.deepEqual(verifyFederationEnvelope(tampered, publicKeyPem), {
    ok: false,
    reason: "payload_hash_mismatch",
  });
});

test("core-field tampering (eventType, eventId, origin) breaks the signature", () => {
  const { envelope, publicKeyPem } = makeEnvelope();
  for (const tampered of [
    { ...envelope, eventType: "federation_other" },
    { ...envelope, eventId: "spoofed-id" },
    { ...envelope, origin: { ...envelope.origin, domain: "evil.example" } },
  ]) {
    assert.deepEqual(verifyFederationEnvelope(tampered, publicKeyPem), {
      ok: false,
      reason: "bad_signature",
    });
  }
});

test("verification against a different pinned key fails", () => {
  const { envelope } = makeEnvelope();
  const other = generateEd25519KeyPairPem();
  assert.deepEqual(verifyFederationEnvelope(envelope, other.publicKeyPem), {
    ok: false,
    reason: "bad_signature",
  });
});

test("envelopes older than the max age are stale; far-future timestamps too", () => {
  const old = makeEnvelope({ createdAt: new Date(Date.now() - DEFAULT_MAX_ENVELOPE_AGE_MS - 60_000) });
  assert.deepEqual(verifyFederationEnvelope(old.envelope, old.publicKeyPem), { ok: false, reason: "stale" });

  const future = makeEnvelope({ createdAt: new Date(Date.now() + 10 * 60_000) });
  assert.deepEqual(verifyFederationEnvelope(future.envelope, future.publicKeyPem), {
    ok: false,
    reason: "stale",
  });
});

test("an expired envelope is refused even when fresh enough", () => {
  const { envelope, publicKeyPem } = makeEnvelope({ expiresAt: new Date(Date.now() - 1000) });
  assert.deepEqual(verifyFederationEnvelope(envelope, publicKeyPem), { ok: false, reason: "expired" });
});

test("parseFederationEnvelope refuses malformed shapes and accepts its own output", () => {
  const { envelope } = makeEnvelope();
  assert.deepEqual(parseFederationEnvelope(JSON.parse(JSON.stringify(envelope))), envelope);

  for (const malformed of [
    null,
    "string",
    {},
    { ...envelope, eventId: "" },
    { ...envelope, origin: { domain: "" } },
    { ...envelope, payload: "not-an-object" },
    { ...envelope, signature: 42 },
  ]) {
    assert.equal(parseFederationEnvelope(malformed), null, JSON.stringify(malformed)?.slice(0, 60));
  }
});
