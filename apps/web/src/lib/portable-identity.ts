import { createPublicKey, generateKeyPairSync } from "node:crypto";
import type { PortableIdentity, Prisma, PrismaClient } from "../generated/prisma/client";
import { signWithPrivateKeyPem, verifyWithPublicKeyPem } from "./node-keys";
import type { SigningProvider } from "./signed-events";

type DbClient = Prisma.TransactionClient | PrismaClient;

// did:key for portable identities (program decision): self-certifying — the
// DID is derived from the public key itself, so it survives node death and
// re-homing; did:web would chain identity to a domain, contradicting refuges.

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BIG_ZERO = BigInt(0);
const BIG_EIGHT = BigInt(8);
const BIG_58 = BigInt(58);

export function base58btcEncode(bytes: Uint8Array): string {
  let value = BIG_ZERO;
  for (const byte of bytes) value = (value << BIG_EIGHT) | BigInt(byte);
  let encoded = "";
  while (value > BIG_ZERO) {
    encoded = BASE58_ALPHABET[Number(value % BIG_58)] + encoded;
    value /= BIG_58;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

export function base58btcDecode(encoded: string): Uint8Array {
  let value = BIG_ZERO;
  for (const char of encoded) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("invalid base58btc character");
    value = value * BIG_58 + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > BIG_ZERO) {
    bytes.unshift(Number(value & BigInt(0xff)));
    value >>= BIG_EIGHT;
  }
  for (const char of encoded) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// Multicodec prefix for ed25519-pub (0xed, varint-encoded as 0xed 0x01).
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

export function didKeyFromPublicKeyPem(publicKeyPem: string): string {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new Error("did:key derivation requires an Ed25519 public key");
  }
  const raw = Buffer.from(jwk.x, "base64url");
  const prefixed = Buffer.concat([ED25519_MULTICODEC, raw]);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

// Inverse of didKeyFromPublicKeyPem — recovers the Ed25519 public key from a
// self-certifying DID. This is what lets a BACKUP node verify a stranded
// member's signature with nothing but the DID from the replica's escrow
// entries (F3.5): no identity row, no home node, no trust in the relay.
export function publicKeyPemFromDidKey(did: string): string {
  if (!did.startsWith("did:key:z")) throw new Error("unsupported DID method");
  const prefixed = base58btcDecode(did.slice("did:key:z".length));
  if (prefixed.length !== 34 || prefixed[0] !== 0xed || prefixed[1] !== 0x01) {
    throw new Error("did:key is not an Ed25519 key");
  }
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(prefixed.slice(2)).toString("base64url") },
    format: "jwk",
  });
  return key.export({ type: "spki", format: "pem" }).toString();
}

export type EnsuredIdentity = {
  identity: PortableIdentity;
  created: boolean;
};

// Generate-on-first-use, like node keys: an account gets a portable identity
// the first time it does anything federation-shaped. Node-custodied at beta
// (register D-8): both private keys live in IdentityKeyCustody, nowhere else.
export async function ensurePortableIdentity(prisma: DbClient, accountId: string): Promise<EnsuredIdentity> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, portableIdentityId: true, portableIdentity: true },
  });
  if (!account) throw new Error(`Account ${accountId} not found.`);
  if (account.portableIdentity) return { identity: account.portableIdentity, created: false };

  const signing = generateKeyPairSync("ed25519");
  const encryption = generateKeyPairSync("x25519");
  const publicKeyPem = signing.publicKey.export({ type: "spki", format: "pem" }).toString();
  const did = didKeyFromPublicKeyPem(publicKeyPem);

  const identity = await prisma.portableIdentity.create({
    data: {
      did,
      publicKey: publicKeyPem,
      keyCustody: {
        create: {
          signingPrivateKeyPem: signing.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          encryptionPublicKey: encryption.publicKey.export({ type: "spki", format: "pem" }).toString(),
          encryptionPrivateKeyPem: encryption.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        },
      },
    },
  });
  await prisma.account.update({ where: { id: accountId }, data: { portableIdentityId: identity.id } });
  return { identity, created: true };
}

export type IdentitySigner = {
  did: string;
  publicKey: string;
  provider: SigningProvider;
};

export async function identitySigningProvider(prisma: DbClient, portableIdentityId: string): Promise<IdentitySigner> {
  const identity = await prisma.portableIdentity.findUniqueOrThrow({
    where: { id: portableIdentityId },
    include: { keyCustody: true },
  });
  if (!identity.keyCustody || identity.keyCustody.revokedAt) {
    throw new Error(`Identity ${identity.did} has no active custodied key.`);
  }
  const privateKeyPem = identity.keyCustody.signingPrivateKeyPem;
  return {
    did: identity.did,
    publicKey: identity.publicKey,
    provider: {
      sign: (payloadHash) => signWithPrivateKeyPem(privateKeyPem, payloadHash),
      verify: (payloadHash, signature, publicKey) => verifyWithPublicKeyPem(publicKey, payloadHash, signature),
    },
  };
}

// Self-certification check used by remote nodes: the presented public key
// must derive exactly the presented DID — no registry, no trust in the
// presenting node needed for the binding itself.
export function didMatchesPublicKey(did: string, publicKeyPem: string): boolean {
  try {
    return didKeyFromPublicKeyPem(publicKeyPem) === did;
  } catch {
    return false;
  }
}
