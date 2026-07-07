import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import type { NodeKeyPair, Prisma, PrismaClient } from "../generated/prisma/client";
import type { SigningProvider } from "./signed-events";

type DbClient = Prisma.TransactionClient | PrismaClient;

export const NODE_KEY_ALGORITHM = "ed25519";

export function generateEd25519KeyPairPem(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signWithPrivateKeyPem(privateKeyPem: string, payloadHash: string): string {
  return cryptoSign(null, Buffer.from(payloadHash, "utf8"), createPrivateKey(privateKeyPem)).toString("base64");
}

export function verifyWithPublicKeyPem(publicKeyPem: string, payloadHash: string, signature: string): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(payloadHash, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

// Generate-on-first-use. The partial unique index NodeKeyPair_active_per_node_unique
// (one row per node where retiredAt IS NULL) makes the create race-safe: a
// concurrent loser recovers by re-reading the winner's row.
export async function ensureNodeKeyPair(prisma: DbClient, nodeId: string): Promise<NodeKeyPair> {
  const active = await prisma.nodeKeyPair.findFirst({ where: { nodeId, retiredAt: null } });
  if (active) return active;

  const { publicKeyPem, privateKeyPem } = generateEd25519KeyPairPem();
  try {
    return await prisma.nodeKeyPair.create({
      data: { nodeId, algorithm: NODE_KEY_ALGORITHM, publicKey: publicKeyPem, privateKeyPem },
    });
  } catch (error) {
    const existing = await prisma.nodeKeyPair.findFirst({ where: { nodeId, retiredAt: null } });
    if (existing) return existing;
    throw error;
  }
}

export type NodeSigner = {
  keyId: string;
  publicKey: string;
  provider: SigningProvider;
};

export async function nodeSigningProvider(prisma: DbClient, nodeId: string): Promise<NodeSigner> {
  const key = await ensureNodeKeyPair(prisma, nodeId);
  return {
    keyId: key.id,
    publicKey: key.publicKey,
    provider: {
      sign: (payloadHash) => signWithPrivateKeyPem(key.privateKeyPem, payloadHash),
      verify: (payloadHash, signature, publicKey) => verifyWithPublicKeyPem(publicKey, payloadHash, signature),
    },
  };
}
