import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

// Shareable request link for a private group (feedback #9). Modeled on group-invites.ts,
// but DURABLE: a request link never expires — it stays valid until revoked. Revocation is
// the only off-switch, so the revoke control must be prominent in the UI.

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function isEligibleMember(
  membership: { groupId: string; status: string; participationStatus: string } | null,
  groupId: string,
): boolean {
  return (
    !!membership &&
    membership.groupId === groupId &&
    membership.status === "active" &&
    membership.participationStatus === "active"
  );
}

export type GenerateRequestLinkResult =
  | { ok: true; rawToken: string }
  | { ok: false; reason: "not_eligible" };

export async function generateGroupRequestLink(
  prisma: PrismaClient,
  { groupId, createdByMembershipId }: { groupId: string; createdByMembershipId: string },
): Promise<GenerateRequestLinkResult> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (!isEligibleMember(membership, groupId)) return { ok: false, reason: "not_eligible" };

  // Only one active link at a time: revoke existing before issuing a new one.
  await prisma.groupRequestLink.updateMany({
    where: { groupId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("base64url");
  await prisma.groupRequestLink.create({
    data: { tokenHash: hashToken(rawToken), tokenPreview: rawToken.slice(0, 8), groupId, createdByMembershipId },
  });
  return { ok: true, rawToken };
}

// Resolves a raw token to the group it grants request access to. Fails closed for an
// unknown or revoked token. The caller MUST additionally check the resolved groupId equals
// the group being requested, so a token for group A cannot open group B.
export type ResolveRequestLinkResult =
  | { ok: true; groupId: string }
  | { ok: false; reason: "not_found" | "revoked" };

export async function resolveGroupRequestLink(
  prisma: PrismaClient,
  rawToken: string,
): Promise<ResolveRequestLinkResult> {
  const record = await prisma.groupRequestLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { groupId: true, revokedAt: true },
  });
  if (!record) return { ok: false, reason: "not_found" };
  if (record.revokedAt !== null) return { ok: false, reason: "revoked" };
  return { ok: true, groupId: record.groupId };
}

// True iff `rawToken` is a valid, non-revoked link for exactly `groupId`.
export async function requestLinkGrantsAccess(
  prisma: PrismaClient,
  groupId: string,
  rawToken: string | null | undefined,
): Promise<boolean> {
  if (!rawToken) return false;
  const resolved = await resolveGroupRequestLink(prisma, rawToken);
  return resolved.ok && resolved.groupId === groupId;
}

export type ActiveRequestLinkPreview = { tokenPreview: string } | null;

export async function getActiveGroupRequestLinkPreview(
  prisma: PrismaClient,
  groupId: string,
): Promise<ActiveRequestLinkPreview> {
  const record = await prisma.groupRequestLink.findFirst({
    where: { groupId, revokedAt: null },
    select: { tokenPreview: true },
    orderBy: { createdAt: "desc" },
  });
  return record ?? null;
}

export async function revokeAllGroupRequestLinks(
  prisma: PrismaClient,
  { groupId, membershipId }: { groupId: string; membershipId: string },
): Promise<{ ok: true } | { ok: false; reason: "not_eligible" }> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (!isEligibleMember(membership, groupId)) return { ok: false, reason: "not_eligible" };
  await prisma.groupRequestLink.updateMany({
    where: { groupId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}
