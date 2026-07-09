import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ensurePortableIdentity } from "./portable-identity";

// F3.5 identity key escrow (register D-8's demanded recovery design).
//
// The identity private key is WRAPPED — not derived — under a key scrypt'd
// from the member's password: the custody row stays PRIMARY, so while the
// home lives a password change simply rewraps and nothing is lost. The
// wrapped blob rides backup replicas' cannot-read tier (register D-10),
// giving a stranded member client-side-unwrap login at the backup after home
// death: their identity survives because their password did.
//
// The password plaintext exists at exactly three moments — registration,
// successful login, password change — so wrapping happens opportunistically
// there (which doubles as the backfill path for identities created lazily
// mid-session without a password present).
//
// SERVER DISCIPLINE: production server code must never call
// unwrapEscrowedIdentityKey — the unwrap belongs to the (future) client
// bundle and to tests. A caller-scan test enforces this, the transport-
// privacy-test move.

const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const;

export type EscrowBlob = { salt: string; wrapped: string };

export function wrapIdentityKeyForEscrow(password: string, signingPrivateKeyPem: string): EscrowBlob {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(signingPrivateKeyPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("base64"),
    wrapped: Buffer.concat([iv, tag, encrypted]).toString("base64"),
  };
}

// Client-side/test-only (see SERVER DISCIPLINE above). Throws on a wrong
// password (GCM auth failure) — fails closed, never returns garbage.
export function unwrapEscrowedIdentityKey(password: string, blob: EscrowBlob): string {
  const salt = Buffer.from(blob.salt, "base64");
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  const raw = Buffer.from(blob.wrapped, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// Opportunistic wrap at a password moment. `force` rewraps even when a wrap
// exists (password change); otherwise only missing/stale wraps are written.
export async function ensureEscrowWrap(
  prisma: Prisma.TransactionClient | PrismaClient,
  { accountId, password, force = false }: { accountId: string; password: string; force?: boolean },
): Promise<void> {
  const { identity } = await ensurePortableIdentity(prisma, accountId);
  const custody = await prisma.identityKeyCustody.findUnique({
    where: { portableIdentityId: identity.id },
    select: { id: true, signingPrivateKeyPem: true, escrowWrappedKey: true },
  });
  if (!custody) return;
  if (custody.escrowWrappedKey && !force) return;
  const blob = wrapIdentityKeyForEscrow(password, custody.signingPrivateKeyPem);
  await prisma.identityKeyCustody.update({
    where: { id: custody.id },
    data: { escrowSalt: blob.salt, escrowWrappedKey: blob.wrapped, escrowUpdatedAt: new Date() },
  });
}

// Entity dispatch (Phase 5): groups and projects carry their members' wraps;
// coalition replicas carry NONE — a coalition has no accounts, and its
// people are covered by their own groups' backups (stated in register D-10).
export async function buildEntityEscrowEntries(
  client: Prisma.TransactionClient | PrismaClient,
  entityType: string,
  entityId: string,
): Promise<Array<{ handle: string; did: string; salt: string; wrapped: string }>> {
  if (entityType === "group") return buildEscrowEntries(client, entityId);
  if (entityType === "project") {
    const memberships = await client.projectMembership.findMany({
      where: { projectId: entityId, status: "active" },
      select: {
        account: {
          select: {
            displayName: true,
            portableIdentity: {
              select: { did: true, keyCustody: { select: { escrowSalt: true, escrowWrappedKey: true } } },
            },
          },
        },
      },
    });
    return collectEscrowEntries(memberships);
  }
  return [];
}

type EscrowMembership = {
  account: {
    displayName: string;
    portableIdentity: { did: string; keyCustody: { escrowSalt: string | null; escrowWrappedKey: string | null } | null } | null;
  };
};

function collectEscrowEntries(memberships: EscrowMembership[]): Array<{ handle: string; did: string; salt: string; wrapped: string }> {
  const entries: Array<{ handle: string; did: string; salt: string; wrapped: string }> = [];
  for (const membership of memberships) {
    const identity = membership.account.portableIdentity;
    const custody = identity?.keyCustody;
    if (identity && custody?.escrowSalt && custody.escrowWrappedKey) {
      entries.push({
        handle: membership.account.displayName,
        did: identity.did,
        salt: custody.escrowSalt,
        wrapped: custody.escrowWrappedKey,
      });
    }
  }
  return entries;
}

// The replica-bound escrow entries for a group's local members: ciphertext by
// construction (the backup never has the password), so they may ride before
// F4 — but they belong to the cannot-read tier, never the structural manifest.
export async function buildEscrowEntries(
  client: Prisma.TransactionClient | PrismaClient,
  groupId: string,
): Promise<Array<{ handle: string; did: string; salt: string; wrapped: string }>> {
  const memberships = await client.groupMembership.findMany({
    where: { groupId, status: "active" },
    select: {
      account: {
        select: {
          displayName: true,
          portableIdentity: {
            select: { did: true, keyCustody: { select: { escrowSalt: true, escrowWrappedKey: true } } },
          },
        },
      },
    },
  });
  const entries: Array<{ handle: string; did: string; salt: string; wrapped: string }> = [];
  for (const membership of memberships) {
    const identity = membership.account.portableIdentity;
    const custody = identity?.keyCustody;
    if (identity && custody?.escrowSalt && custody.escrowWrappedKey) {
      entries.push({
        handle: membership.account.displayName,
        did: identity.did,
        salt: custody.escrowSalt,
        wrapped: custody.escrowWrappedKey,
      });
    }
  }
  return entries;
}
