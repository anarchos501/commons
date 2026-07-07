import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { generateEd25519KeyPairPem } from "../lib/node-keys";
import {
  base58btcEncode,
  didKeyFromPublicKeyPem,
  didMatchesPublicKey,
  ensurePortableIdentity,
  identitySigningProvider,
} from "../lib/portable-identity";
import { createPrismaClient } from "../lib/prisma";
import { hashSignedEventPayload } from "../lib/signed-events";

const prisma = createPrismaClient();
const createdAccountIds: string[] = [];
const createdNodeIds: string[] = [];

test.after(async () => {
  await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
  await prisma.portableIdentity.deleteMany({ where: { accounts: { none: {} }, linkedNodePresences: { none: {} } } });
  await prisma.node.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.$disconnect();
});

async function createAccount(): Promise<string> {
  const nodeId = `pid_node_${randomUUID().slice(0, 8)}`;
  const node = await prisma.node.create({
    data: { id: nodeId, name: "pid test node", domain: `${nodeId}.example` },
  });
  createdNodeIds.push(node.id);
  const account = await prisma.account.create({
    data: {
      id: `pid_account_${randomUUID().slice(0, 8)}`,
      homeNodeId: node.id,
      displayName: "Identity Tester",
      accountType: "participant",
    },
  });
  createdAccountIds.push(account.id);
  return account.id;
}

test("base58btc encodes with leading-zero preservation", () => {
  assert.equal(base58btcEncode(Uint8Array.from([0])), "1");
  assert.equal(base58btcEncode(Uint8Array.from([0, 0, 1])), "112");
  assert.equal(base58btcEncode(Uint8Array.from([58])), "21");
});

test("did:key derivation is deterministic and carries the Ed25519 multicodec prefix", () => {
  const { publicKeyPem } = generateEd25519KeyPairPem();
  const did = didKeyFromPublicKeyPem(publicKeyPem);
  // Ed25519 did:key always starts z6Mk — the multicodec prefix is part of
  // the encoding, so this is a structural property, not a convention.
  assert.ok(did.startsWith("did:key:z6Mk"), did);
  assert.equal(didKeyFromPublicKeyPem(publicKeyPem), did);
  assert.equal(didMatchesPublicKey(did, publicKeyPem), true);

  const other = generateEd25519KeyPairPem();
  assert.equal(didMatchesPublicKey(did, other.publicKeyPem), false);
});

test("ensurePortableIdentity is idempotent and provisions custody with both keypairs", async () => {
  const accountId = await createAccount();
  const first = await ensurePortableIdentity(prisma, accountId);
  assert.equal(first.created, true);
  assert.ok(first.identity.did.startsWith("did:key:z6Mk"));

  const second = await ensurePortableIdentity(prisma, accountId);
  assert.equal(second.created, false);
  assert.equal(second.identity.id, first.identity.id);

  const custody = await prisma.identityKeyCustody.findUniqueOrThrow({
    where: { portableIdentityId: first.identity.id },
  });
  assert.ok(custody.signingPrivateKeyPem.includes("PRIVATE KEY"));
  // X25519 provisioned now so F4 needs no re-keying (register D-8).
  assert.ok(custody.encryptionPublicKey?.includes("PUBLIC KEY"));
  assert.ok(custody.encryptionPrivateKeyPem?.includes("PRIVATE KEY"));
});

test("the identity signer roundtrips and its signatures verify against the identity key", async () => {
  const accountId = await createAccount();
  const { identity } = await ensurePortableIdentity(prisma, accountId);
  const signer = await identitySigningProvider(prisma, identity.id);
  assert.equal(signer.did, identity.did);

  const hash = hashSignedEventPayload({ hello: "world" });
  const signature = signer.provider.sign(hash, signer.publicKey);
  assert.equal(signer.provider.verify?.(hash, signature, identity.publicKey), true);
  assert.equal(signer.provider.verify?.(hashSignedEventPayload({ hello: "tampered" }), signature, identity.publicKey), false);
});
