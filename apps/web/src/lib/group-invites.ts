import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

const EXPIRY_DAYS_DEFAULT = 30;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type GenerateInviteResult =
  | { ok: true; rawToken: string; expiresAt: Date }
  | { ok: false; reason: "not_eligible" };

export async function generateGroupInviteToken(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    expiryDays = EXPIRY_DAYS_DEFAULT,
  }: { groupId: string; createdByMembershipId: string; expiryDays?: number },
): Promise<GenerateInviteResult> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  // Revoke all existing active tokens for this group
  await prisma.groupInviteToken.updateMany({
    where: { groupId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const tokenPreview = rawToken.slice(0, 8);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  await prisma.groupInviteToken.create({
    // rawToken is persisted so any active member can re-copy the full link later (feedback #2);
    // see the schema comment on why that's acceptable for a shareable bearer link.
    data: { tokenHash, tokenPreview, rawToken, groupId, createdByMembershipId, expiresAt },
  });

  return { ok: true, rawToken, expiresAt };
}

export type ResolveInviteResult =
  | { ok: true; groupId: string; groupName: string; membershipPolicy: string; visibility: string }
  | { ok: false; reason: "not_found" | "expired" | "revoked" };

export async function resolveGroupInviteToken(
  prisma: PrismaClient,
  rawToken: string,
): Promise<ResolveInviteResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.groupInviteToken.findUnique({
    where: { tokenHash },
    select: {
      expiresAt: true,
      revokedAt: true,
      group: { select: { id: true, name: true, membershipPolicy: true, visibility: true } },
    },
  });

  if (!record) return { ok: false, reason: "not_found" };
  if (record.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (record.expiresAt <= new Date()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    groupId: record.group.id,
    groupName: record.group.name,
    membershipPolicy: record.group.membershipPolicy,
    visibility: record.group.visibility,
  };
}

// rawToken is the full token for re-display; null on links created before the rawToken column
// existed (those degrade to preview-only in the UI).
export type ActiveInvitePreview = { tokenPreview: string; rawToken: string | null; expiresAt: Date } | null;

export async function getActiveGroupInvitePreview(
  prisma: PrismaClient,
  groupId: string,
): Promise<ActiveInvitePreview> {
  const now = new Date();
  const record = await prisma.groupInviteToken.findFirst({
    where: { groupId, revokedAt: null, expiresAt: { gt: now } },
    select: { tokenPreview: true, rawToken: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  return record ?? null;
}

export async function revokeAllGroupInviteTokens(
  prisma: PrismaClient,
  { groupId, membershipId }: { groupId: string; membershipId: string },
): Promise<{ ok: true } | { ok: false; reason: "not_eligible" }> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  await prisma.groupInviteToken.updateMany({
    where: { groupId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}
