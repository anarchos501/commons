import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { openPetition, requireApprovedPetition, type OpenPetitionResult } from "./petitions";

// register D-4: per-(collective, peer-node) visibility grants — the §2b
// consent layer. Every collective starts CLOSED toward every peer node and
// opens itself toward a specific peer by its own petition. The grant governs
// the FEDERATED layer only (discovery in peer listings, inbound requests,
// presence interaction) — it does not and cannot govern the open web: a
// public group's page is already readable by anyone, including a peer's
// members, and "closed toward node X" retracts nothing from it. That
// carve-out is enforced here as code shape: resolveFederatedStance is called
// from federated-surface serving paths ONLY; no public-web read path may
// ever consult it.

export const FEDERATED_STANCES = ["closed", "visible", "interactive"] as const;
export type FederatedStance = (typeof FEDERATED_STANCES)[number];

export function isFederatedStance(value: string): value is FederatedStance {
  return (FEDERATED_STANCES as readonly string[]).includes(value);
}

export type ProposeFederatedVisibilityResult =
  | OpenPetitionResult
  | {
      ok: false;
      reason: "invalid_stance" | "not_found" | "private_group_not_grantable" | "peer_not_found" | "already_set";
    };

// Pattern-A petition (the group_visibility_proposal shape): subject encodes
// `${groupId}:${peerNodeId}:${target}`; the partial unique index
// Petition_federated_visibility_open_unique enforces one open stance petition
// per (group, peer) — register F-7: that index IS the single-open invariant.
export async function proposeFederatedVisibility(
  prisma: PrismaClient,
  {
    groupId,
    peerNodeId,
    target,
    createdByMembershipId,
  }: { groupId: string; peerNodeId: string; target: string; createdByMembershipId: string },
): Promise<ProposeFederatedVisibilityResult> {
  if (!isFederatedStance(target)) return { ok: false, reason: "invalid_stance" };

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { visibility: true, archivedAt: true },
  });
  if (!group || group.archivedAt) return { ok: false, reason: "not_found" };
  // register D-4/A3: grants are a public-group instrument only. A private
  // group's cross-node exposure happens exclusively through deliberate
  // shared acts, disclosure scoped to the shared entity's membership.
  if (group.visibility !== "public") return { ok: false, reason: "private_group_not_grantable" };

  const peer = await prisma.federatedNode.findUnique({ where: { id: peerNodeId }, select: { id: true } });
  if (!peer) return { ok: false, reason: "peer_not_found" };

  const current = await prisma.federatedVisibilityGrant.findUnique({
    where: { groupId_federatedNodeId: { groupId, federatedNodeId: peerNodeId } },
    select: { stance: true, suspendedAt: true },
  });
  if ((current?.stance ?? "closed") === target && !current?.suspendedAt) {
    return { ok: false, reason: "already_set" };
  }

  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "federated_visibility_change",
    subjectId: `${groupId}:${peerNodeId}:${target}`,
    createdByMembershipId,
  });
}

export async function applyFederatedVisibilityFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "federated_visibility_change");
  const [groupId, peerNodeId, target] = petition.subjectId.split(":");
  if (!groupId || !peerNodeId || !isFederatedStance(target ?? "")) return;

  // Staleness guards: a group gone private (or archived) mid-vote must not
  // gain a grant (A3), and the peer must still exist.
  const group = await tx.group.findUnique({ where: { id: groupId }, select: { visibility: true, archivedAt: true } });
  if (!group || group.archivedAt || group.visibility !== "public") return;
  const peer = await tx.federatedNode.findUnique({ where: { id: peerNodeId }, select: { id: true } });
  if (!peer) return;

  // A fresh petition-backed decision clears any suspension: the collective
  // has re-consented under whatever agreement state now holds.
  await tx.federatedVisibilityGrant.upsert({
    where: { groupId_federatedNodeId: { groupId, federatedNodeId: peerNodeId } },
    update: { stance: target as FederatedStance, suspendedAt: null },
    create: { groupId, federatedNodeId: peerNodeId, stance: target as FederatedStance },
  });
}

// ── The chokepoint (register D-4) ─────────────────────────────────────────────

// Effective stance of a group toward a peer, for FEDERATED-surface serving
// only. Self-contained defense in depth: closed unless the agreement is
// active AND an unsuspended grant says otherwise. Call this from every
// federated serve path (discovery listings, inbound requests, presence
// interaction, federated deliveries); never from public-web rendering.
export async function resolveFederatedStance(
  client: Prisma.TransactionClient | PrismaClient,
  groupId: string,
  peer: { id: string; status: string },
): Promise<FederatedStance> {
  if (peer.status !== "active") return "closed";
  const grant = await client.federatedVisibilityGrant.findUnique({
    where: { groupId_federatedNodeId: { groupId, federatedNodeId: peer.id } },
    select: { stance: true, suspendedAt: true },
  });
  if (!grant || grant.suspendedAt || !isFederatedStance(grant.stance)) return "closed";
  return grant.stance;
}

// ── Agreement lifecycle (register D-4: grants suspend with the agreement) ─────

// Suspension is agreement-scoped soft-archive, never deletion — and resume is
// keyed to a NEW agreement being applied, never inferred from peer status
// (proposed-after-dissolve must stay equivalent to proposed-fresh).
export async function suspendGrantsForPeer(tx: Prisma.TransactionClient, federatedNodeId: string): Promise<void> {
  await tx.federatedVisibilityGrant.updateMany({
    where: { federatedNodeId, suspendedAt: null },
    data: { suspendedAt: new Date() },
  });
}

export async function resumeGrantsForPeer(tx: Prisma.TransactionClient, federatedNodeId: string): Promise<void> {
  await tx.federatedVisibilityGrant.updateMany({
    where: { federatedNodeId, suspendedAt: { not: null } },
    data: { suspendedAt: null },
  });
}
