import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { dissolveFederationLocally } from "./federations";
import { requireActiveNodeUser } from "./node-governance";
import { openNodePetition, openPetition, requireApprovedPetition, type OpenPetitionResult } from "./petitions";

// Federation policy is a steward-managed setting (register F-5): changed by a
// steward-group petition in the steward group's own group_settings category —
// the Pattern-A shape of group-settings.ts, deliberately NOT a constitutional
// node-governance object. Node-wide petitions exist only for STOPPING:
// federation_termination (end one agreement) and federation_disable (turn the
// whole surface off). Starting is delegated; stopping is community-owned.

const FEDERATION_POLICIES = [
  "open",
  "allowlisted",
  "project_level",
  "read_only",
  "emergency_only",
  "disabled",
] as const;
export type FederationPolicyValue = (typeof FEDERATION_POLICIES)[number];

export function isFederationPolicy(value: string): value is FederationPolicyValue {
  return (FEDERATION_POLICIES as readonly string[]).includes(value);
}

export type ProposeFederationPolicyResult =
  | OpenPetitionResult
  | { ok: false; reason: "no_steward_group" | "invalid_policy" | "already_set" | "not_eligible" };

export async function proposeFederationPolicyChange(
  prisma: PrismaClient,
  {
    nodeId,
    target,
    createdByMembershipId,
  }: { nodeId: string; target: string; createdByMembershipId: string },
): Promise<ProposeFederationPolicyResult> {
  if (!isFederationPolicy(target)) return { ok: false, reason: "invalid_policy" };
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { stewardGroupId: true, federationPolicy: true },
  });
  if (!node?.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  if (node.federationPolicy === target) return { ok: false, reason: "already_set" };

  // openPetition validates the creator is an active member of the steward
  // group; the one-open-at-a-time partial unique index turns a duplicate into
  // petition_already_open.
  return openPetition(prisma, {
    groupId: node.stewardGroupId,
    category: "group_settings",
    subjectType: "federation_policy_change",
    subjectId: `${nodeId}:${target}`,
    createdByMembershipId,
  });
}

export async function applyFederationPolicyFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "federation_policy_change");
  const [nodeId, target] = petition.subjectId.split(":");
  if (!nodeId || !isFederationPolicy(target ?? "")) return;

  // Staleness guard: the petition applies only while its group is still the
  // steward collective — a recalled steward's in-flight policy petition must
  // not set policy for its successor's era.
  const node = await tx.node.findUnique({ where: { id: nodeId }, select: { stewardGroupId: true } });
  if (!node || node.stewardGroupId !== petition.groupId) return;
  await tx.node.update({ where: { id: nodeId }, data: { federationPolicy: target as FederationPolicyValue } });
}

// ── Node-wide STOP valves ─────────────────────────────────────────────────────

export type ProposeFederationStopResult =
  | OpenPetitionResult
  | { ok: false; reason: "not_eligible" | "federation_not_found" };

// Any active node member may open the valves — mass mobilization is the
// instrument for CHECKING power, so opening the check must be cheap. The
// petitions are node-wide aggregated individual votes (openNodePetition);
// eligibility is validated here and the petition is opened system-side, the
// same shape node_name_change uses for its node stage.
export async function proposeFederationTermination(
  prisma: PrismaClient,
  { nodeId, federationId, requestedByAccountId }: { nodeId: string; federationId: string; requestedByAccountId: string },
): Promise<ProposeFederationStopResult> {
  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  const membership = await prisma.federationMembership.findFirst({
    where: { federationId, isSelf: true, endedAt: null, federation: { status: "active" } },
    select: { id: true },
  });
  if (!membership) return { ok: false, reason: "federation_not_found" };

  return openNodePetition(prisma, {
    nodeId,
    category: "node_stewardship",
    subjectType: "federation_termination",
    subjectId: federationId,
  });
}

export async function proposeFederationDisable(
  prisma: PrismaClient,
  { nodeId, requestedByAccountId }: { nodeId: string; requestedByAccountId: string },
): Promise<ProposeFederationStopResult> {
  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  return openNodePetition(prisma, {
    nodeId,
    category: "node_stewardship",
    subjectType: "federation_disable",
    subjectId: nodeId,
  });
}

export async function applyFederationTerminationFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "federation_termination");
  const federationId = petition.subjectId;
  const selfNode = await selfNodeForScope(tx, petition.scopeId);
  await dissolveFederationLocally(tx, {
    federationId,
    selfNode,
    reason: "terminated_by_node_vote",
    notifyPeers: true,
  });
}

export async function applyFederationDisableFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "federation_disable");
  const nodeId = petition.subjectId;
  const selfNode = await tx.node.findUnique({ where: { id: nodeId }, select: { id: true, domain: true } });
  if (!selfNode) return;

  const active = await tx.federation.findMany({
    where: { status: "active", memberships: { some: { isSelf: true, endedAt: null } } },
    select: { id: true },
  });
  for (const federation of active) {
    await dissolveFederationLocally(tx, {
      federationId: federation.id,
      selfNode,
      reason: "federation_disabled_by_node_vote",
      notifyPeers: true,
    });
  }
  await tx.node.update({ where: { id: nodeId }, data: { federationPolicy: "disabled" } });
}

async function selfNodeForScope(
  tx: Prisma.TransactionClient,
  nodeId: string,
): Promise<{ id: string; domain: string } | null> {
  return tx.node.findUnique({ where: { id: nodeId }, select: { id: true, domain: true } });
}
