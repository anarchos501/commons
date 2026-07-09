import { Prisma, type FederatedNode, type Node, type PrismaClient } from "../generated/prisma/client";
import type { FederationEnvelope } from "./federation-envelope";
import { enqueueSignedNodeEvent } from "./federations";
import { requireActiveNodeUser } from "./node-governance";
import {
  openNodePetition,
  openPetition,
  openSystemGroupPetition,
  requireApprovedPetition,
  type OpenPetitionResult,
} from "./petitions";
import { NOT_SHADOW_ACCOUNT_FILTER } from "./shadow-accounts";

// F3.5 Phase 1 — continuity establishment (register F-8, F-10).
//
// An entity designates its backup through its NATIVE governance form (groups
// here; projects/coalitions add entrances in Phase 5 — the schema is generic
// from day one). The designation carries the failover window W and the
// ADVANCE DIRECTIVE: the entity's pre-consent to post-disaster re-homing,
// collected at the only moment its own machinery can legitimately decide it.
//
// The receiving node's consent DERIVES from its registrationMode (register
// F-10) — no separate consent knob: open → auto-accept (threshold escalates,
// never refuses); invite_only → policy bit or steward petition; stewardless →
// fail closed. Federation is the channel; mode-derived consent the permission.

export const BACKUP_DIRECTIVES = ["none", "reconstitute"] as const;
export type BackupDirective = (typeof BACKUP_DIRECTIVES)[number];
export const CONTINUITY_DATA_CLASS = "continuity" as const;

export function isBackupDirective(value: string): value is BackupDirective {
  return (BACKUP_DIRECTIVES as readonly string[]).includes(value);
}

const HOSTING_POLICIES = ["accept", "approve_each", "refuse"] as const;
export type BackupHostingPolicy = (typeof HOSTING_POLICIES)[number];

export function isBackupHostingPolicy(value: string): value is BackupHostingPolicy {
  return (HOSTING_POLICIES as readonly string[]).includes(value);
}

// Local members only (register F-10 / the F-5 C1 counting discipline): a
// remote presence must never inflate the size the threshold gates.
export async function countLocalMembers(client: Prisma.TransactionClient | PrismaClient, groupId: string): Promise<number> {
  return client.groupMembership.count({
    where: { groupId, status: "active", account: NOT_SHADOW_ACCOUNT_FILTER },
  });
}

// ── Home side: designation (Pattern-A petition, group entrance) ──────────────

export type ProposeBackupDesignationResult =
  | OpenPetitionResult
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_window"
        | "invalid_directive"
        | "no_active_agreement"
        | "backup_already_exists"
        | "no_backup_to_revoke";
    };

export async function proposeBackupDesignation(
  prisma: PrismaClient,
  {
    groupId,
    peerNodeId,
    windowHours,
    directive,
    createdByMembershipId,
  }: {
    groupId: string;
    peerNodeId: string;
    windowHours: number;
    directive: string;
    createdByMembershipId: string;
  },
): Promise<ProposeBackupDesignationResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { archivedAt: true } });
  if (!group || group.archivedAt) return { ok: false, reason: "not_found" };
  if (!Number.isInteger(windowHours) || windowHours < 1) return { ok: false, reason: "invalid_window" };
  if (!isBackupDirective(directive)) return { ok: false, reason: "invalid_directive" };

  // The channel: an ACTIVE agreement with the peer must already exist.
  const peer = await prisma.federatedNode.findUnique({ where: { id: peerNodeId }, select: { status: true } });
  if (!peer || peer.status !== "active") return { ok: false, reason: "no_active_agreement" };

  const existing = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: "group", entityId: groupId } },
    select: { status: true },
  });
  if (existing && (existing.status === "proposed" || existing.status === "active")) {
    return { ok: false, reason: "backup_already_exists" };
  }

  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "backup_designation",
    subjectId: `group:${groupId}:${peerNodeId}:designate:${windowHours}:${directive}`,
    createdByMembershipId,
  });
}

export async function proposeBackupRevocation(
  prisma: PrismaClient,
  { groupId, peerNodeId, createdByMembershipId }: { groupId: string; peerNodeId: string; createdByMembershipId: string },
): Promise<ProposeBackupDesignationResult> {
  const backup = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: "group", entityId: groupId } },
    select: { peerId: true, status: true },
  });
  if (!backup || backup.peerId !== peerNodeId || (backup.status !== "active" && backup.status !== "proposed")) {
    return { ok: false, reason: "no_backup_to_revoke" };
  }
  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "backup_designation",
    subjectId: `group:${groupId}:${peerNodeId}:revoke`,
    createdByMembershipId,
  });
}

export async function applyBackupDesignationFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "backup_designation");
  const [entityType, entityId, peerNodeId, action, windowRaw, directiveRaw] = petition.subjectId.split(":");
  // Groups and projects apply per-petition; coalition designation applies at
  // PROPOSAL level (family coalition_backup_designation) and never lands here.
  if ((entityType !== "group" && entityType !== "project") || !entityId || !peerNodeId) return;

  const selfNode = await selfNodeForEntity(tx, entityType, entityId);
  if (!selfNode) return;

  if (action === "revoke") {
    const backup = await tx.entityBackup.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
      select: { peerId: true },
    });
    if (!backup || backup.peerId !== peerNodeId) return;
    await revokeEntityBackup(tx, { entityType, entityId, selfNode });
    return;
  }

  if (action !== "designate") return;
  const windowHours = Number.parseInt(windowRaw ?? "", 10);
  const directive = directiveRaw ?? "none";
  if (!Number.isInteger(windowHours) || windowHours < 1 || !isBackupDirective(directive)) return;

  // Staleness re-checks at apply time (the world may have moved mid-vote).
  let entityName: string | null = null;
  if (entityType === "group") {
    const group = await tx.group.findUnique({ where: { id: entityId }, select: { name: true, archivedAt: true } });
    entityName = group && !group.archivedAt ? group.name : null;
  } else {
    const project = await tx.project.findUnique({ where: { id: entityId }, select: { name: true, archivedAt: true, status: true } });
    entityName = project && !project.archivedAt && project.status !== "closed" ? project.name : null;
  }
  const peer = await tx.federatedNode.findUnique({ where: { id: peerNodeId } });
  if (!entityName || !peer || peer.status !== "active") return;

  await establishEntityBackup(tx, {
    entityType,
    entityId,
    entityName,
    memberCount: await countEntityMembers(tx, entityType, entityId),
    peerId: peer.id,
    peerDomain: peer.domain,
    selfNode,
    windowHours,
    directive,
  });
}

// ── Project entrance (Phase 5): same family, project-native governance ──────

export async function proposeProjectBackupDesignation(
  prisma: PrismaClient,
  {
    projectId,
    peerNodeId,
    windowHours,
    directive,
    createdByProjectMembershipId,
  }: {
    projectId: string;
    peerNodeId: string;
    windowHours: number;
    directive: string;
    createdByProjectMembershipId: string;
  },
): Promise<ProposeBackupDesignationResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { archivedAt: true, status: true, foundingGroupId: true },
  });
  if (!project || project.archivedAt || project.status === "closed") return { ok: false, reason: "not_found" };
  if (!Number.isInteger(windowHours) || windowHours < 1) return { ok: false, reason: "invalid_window" };
  if (!isBackupDirective(directive)) return { ok: false, reason: "invalid_directive" };
  const peer = await prisma.federatedNode.findUnique({ where: { id: peerNodeId }, select: { status: true } });
  if (!peer || peer.status !== "active") return { ok: false, reason: "no_active_agreement" };
  const existing = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: "project", entityId: projectId } },
    select: { status: true },
  });
  if (existing && (existing.status === "proposed" || existing.status === "active")) {
    return { ok: false, reason: "backup_already_exists" };
  }
  // Project-native petition (the events.ts project shape): project members
  // vote; the founding group provides governance parameters.
  return openPetition(prisma, {
    groupId: project.foundingGroupId,
    category: "group_settings",
    subjectType: "backup_designation",
    subjectId: `project:${projectId}:${peerNodeId}:designate:${windowHours}:${directive}`,
    createdByProjectMembershipId,
    scopeType: "project",
    scopeId: projectId,
    voterScope: { type: "project", scopeId: projectId },
  });
}

export async function proposeProjectBackupRevocation(
  prisma: PrismaClient,
  {
    projectId,
    peerNodeId,
    createdByProjectMembershipId,
  }: { projectId: string; peerNodeId: string; createdByProjectMembershipId: string },
): Promise<ProposeBackupDesignationResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { foundingGroupId: true },
  });
  if (!project) return { ok: false, reason: "not_found" };
  const backup = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: "project", entityId: projectId } },
    select: { peerId: true, status: true },
  });
  if (!backup || backup.peerId !== peerNodeId || backup.status === "revoked" || backup.status === "ended") {
    return { ok: false, reason: "no_backup_to_revoke" };
  }
  return openPetition(prisma, {
    groupId: project.foundingGroupId,
    category: "group_settings",
    subjectType: "backup_designation",
    subjectId: `project:${projectId}:${peerNodeId}:revoke`,
    createdByProjectMembershipId,
    scopeType: "project",
    scopeId: projectId,
    voterScope: { type: "project", scopeId: projectId },
  });
}

// ── Node-level consent settings ───────────────────────────────────────────────

export type ProposeNodeSettingResult =
  | OpenPetitionResult
  | { ok: false; reason: "invalid_value" | "already_set" | "not_eligible" | "no_steward_group" };

// Node-wide (constitutional, like registration mode): the per-entity member
// threshold over which an open node's auto-accept escalates to consent.
export async function proposeBackupSizeThreshold(
  prisma: PrismaClient,
  { nodeId, value, requestedByAccountId }: { nodeId: string; value: number | null; requestedByAccountId: string },
): Promise<ProposeNodeSettingResult> {
  if (value !== null && (!Number.isInteger(value) || value < 1)) return { ok: false, reason: "invalid_value" };
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { backupMemberThreshold: true } });
  if (!node) return { ok: false, reason: "not_eligible" };
  if (node.backupMemberThreshold === value) return { ok: false, reason: "already_set" };
  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  return openNodePetition(prisma, {
    nodeId,
    category: "node_stewardship",
    subjectType: "backup_size_threshold_change",
    subjectId: `${nodeId}:${value === null ? "none" : value}`,
  });
}

export async function applyBackupSizeThresholdFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "backup_size_threshold_change");
  const [nodeId, raw] = petition.subjectId.split(":");
  if (!nodeId || raw === undefined) return;
  const value = raw === "none" ? null : Number.parseInt(raw, 10);
  if (value !== null && (!Number.isInteger(value) || value < 1)) return;
  await tx.node.update({ where: { id: nodeId }, data: { backupMemberThreshold: value } });
}

// Steward-managed (the federation_policy_change shape): how an invite_only
// node answers backup requests.
export async function proposeBackupHostingPolicy(
  prisma: PrismaClient,
  { nodeId, target, createdByMembershipId }: { nodeId: string; target: string; createdByMembershipId: string },
): Promise<ProposeNodeSettingResult> {
  if (!isBackupHostingPolicy(target)) return { ok: false, reason: "invalid_value" };
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { stewardGroupId: true, backupHostingPolicy: true },
  });
  if (!node?.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  if (node.backupHostingPolicy === target) return { ok: false, reason: "already_set" };
  return openPetition(prisma, {
    groupId: node.stewardGroupId,
    category: "group_settings",
    subjectType: "backup_hosting_policy_change",
    subjectId: `${nodeId}:${target}`,
    createdByMembershipId,
  });
}

export async function applyBackupHostingPolicyFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "backup_hosting_policy_change");
  const [nodeId, target] = petition.subjectId.split(":");
  if (!nodeId || !isBackupHostingPolicy(target ?? "")) return;
  // Recalled-steward staleness guard (the federation-policy precedent).
  const node = await tx.node.findUnique({ where: { id: nodeId }, select: { stewardGroupId: true } });
  if (!node || node.stewardGroupId !== petition.groupId) return;
  await tx.node.update({ where: { id: nodeId }, data: { backupHostingPolicy: target as BackupHostingPolicy } });
}

// Backup-side unilateral stop (F-2 symmetry: stopping is always available).
export async function proposeBackupHostingEnd(
  prisma: PrismaClient,
  { replicaId, createdByMembershipId }: { replicaId: string; createdByMembershipId: string },
): Promise<ProposeNodeSettingResult> {
  const replica = await prisma.backupReplica.findUnique({ where: { id: replicaId }, select: { status: true } });
  if (!replica || replica.status === "ended" || replica.status === "refused") {
    return { ok: false, reason: "invalid_value" };
  }
  const node = await prisma.node.findFirst({
    orderBy: { createdAt: "asc" },
    select: { stewardGroupId: true },
  });
  if (!node?.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  return openPetition(prisma, {
    groupId: node.stewardGroupId,
    category: "group_settings",
    subjectType: "backup_hosting_end",
    subjectId: replicaId,
    createdByMembershipId,
  });
}

export async function applyBackupHostingEndFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "backup_hosting_end");
  const replica = await tx.backupReplica.findUnique({
    where: { id: petition.subjectId },
    include: { origin: { select: { domain: true } } },
  });
  if (!replica || replica.status === "ended") return;
  await tx.backupReplica.update({ where: { id: replica.id }, data: { status: "ended" } });
  const selfNode = await localNode(tx);
  if (selfNode) {
    await enqueueSignedNodeEvent(tx, selfNode, replica.origin.domain, "backup_hosting_ended", {
      entityType: replica.entityType,
      entityId: replica.entityId,
    }, CONTINUITY_DATA_CLASS);
  }
}

// ── Backup side: mode-derived consent (register F-10) ────────────────────────

type HandlerResult = { ok: true } | { ok: false; reason: string };
type HandlerContext = { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null };

export const handleBackupEstablishRequest = async (
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: HandlerContext,
): Promise<HandlerResult> => {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  const name = typeof p.name === "string" ? p.name : null;
  const memberCount = typeof p.memberCount === "number" ? p.memberCount : null;
  const windowHours = typeof p.windowHours === "number" ? p.windowHours : null;
  const directive = typeof p.directive === "string" && isBackupDirective(p.directive) ? p.directive : "none";
  if (!entityType || !entityId || !name || memberCount === null || !windowHours || windowHours < 1) {
    return { ok: false, reason: "malformed_payload" };
  }

  // Idempotent duplicate.
  const existing = await tx.backupReplica.findUnique({
    where: { entityType_entityId_originPeerId: { entityType, entityId, originPeerId: origin.id } },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== "ended" && existing.status !== "refused") return { ok: true };

  const refuse = async (reason: string): Promise<HandlerResult> => {
    await enqueueSignedNodeEvent(tx, localNode, origin.domain, "backup_establish_refuse", {
      entityType,
      entityId,
      reason,
    }, CONTINUITY_DATA_CLASS);
    return { ok: true };
  };

  const createReplica = async (status: "active" | "pending_consent") =>
    existing
      ? tx.backupReplica.update({
          where: { id: existing.id },
          data: { entityName: name, memberCount, windowHours, directive, status, manifestSeq: 0, manifest: Prisma.DbNull },
        })
      : tx.backupReplica.create({
          data: {
            entityType,
            entityId,
            originPeerId: origin.id,
            entityName: name,
            memberCount,
            windowHours,
            directive,
            status,
          },
        });

  const accept = async (): Promise<HandlerResult> => {
    await createReplica("active");
    await enqueueSignedNodeEvent(tx, localNode, origin.domain, "backup_establish_accept", {
      entityType,
      entityId,
    }, CONTINUITY_DATA_CLASS);
    return { ok: true };
  };

  // Consent escalation shared by both triggers (register F-10: one petition
  // mechanism, two triggers — over-threshold open nodes and gated nodes).
  const escalateToConsentPetition = async (): Promise<HandlerResult> => {
    if (!localNode.stewardGroupId) {
      // Fail closed, honestly: no steward collective exists to consider this.
      return refuse("stewardless");
    }
    const replica = await createReplica("pending_consent");
    const petition = await openSystemGroupPetition(tx, {
      groupId: localNode.stewardGroupId,
      category: "group_settings",
      subjectType: "backup_hosting_consent",
      subjectId: replica.id,
    });
    if (!petition.ok) {
      await tx.backupReplica.update({ where: { id: replica.id }, data: { status: "refused" } });
      return refuse("petition_error");
    }
    await tx.backupReplica.update({ where: { id: replica.id }, data: { consentPetitionId: petition.petitionId } });
    return { ok: true };
  };

  // register F-10: consent derived from registrationMode — the branch.
  if (localNode.registrationMode === "open") {
    const threshold = localNode.backupMemberThreshold;
    if (threshold === null || memberCount <= threshold) return accept();
    return escalateToConsentPetition(); // escalate, never refuse
  }
  // invite_only:
  const policy = localNode.backupHostingPolicy;
  if (policy === "accept") return accept();
  if (policy === "refuse") return refuse("hosting_refused");
  return escalateToConsentPetition(); // approve_each (default)
};

// Consent petition lifecycle: approval accepts; rejection/withdrawal/timeout
// refuses honestly. Dispatch hook (the coalition/federation hook shape).
export async function evaluateBackupHostingConsentForPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<boolean> {
  const petition = await tx.petition.findUnique({
    where: { id: petitionId },
    select: { subjectType: true, subjectId: true, status: true },
  });
  if (!petition || petition.subjectType !== "backup_hosting_consent") return false;
  const replica = await tx.backupReplica.findUnique({
    where: { id: petition.subjectId },
    include: { origin: { select: { domain: true } } },
  });
  if (!replica || replica.status !== "pending_consent") return true;

  const selfNode = await localNode(tx);
  if (!selfNode) return true;

  if (petition.status === "approved") {
    await tx.backupReplica.update({ where: { id: replica.id }, data: { status: "active" } });
    await enqueueSignedNodeEvent(tx, selfNode, replica.origin.domain, "backup_establish_accept", {
      entityType: replica.entityType,
      entityId: replica.entityId,
    }, CONTINUITY_DATA_CLASS);
  } else if (["rejected", "blocked", "withdrawn", "superseded"].includes(petition.status)) {
    await tx.backupReplica.update({ where: { id: replica.id }, data: { status: "refused" } });
    await enqueueSignedNodeEvent(tx, selfNode, replica.origin.domain, "backup_establish_refuse", {
      entityType: replica.entityType,
      entityId: replica.entityId,
      reason: "consent_declined",
    }, CONTINUITY_DATA_CLASS);
  }
  return true;
}

// ── Home side: accept/refuse/ended handlers ───────────────────────────────────

export const handleBackupEstablishAccept = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const backup = await findHomeBackup(tx, p, origin);
  if (!backup) return { ok: false, reason: "unknown_backup" };
  if (backup.status === "active") return { ok: true };
  if (backup.status !== "proposed") return { ok: true }; // revoked/ended meanwhile: stale accept ignored
  await tx.entityBackup.update({
    where: { id: backup.id },
    // Fresh establishment is verified by construction (register F-9).
    data: { status: "active", establishedAt: new Date(), verifiedAt: new Date() },
  });
  return { ok: true };
};

export const handleBackupEstablishRefuse = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const backup = await findHomeBackup(tx, p, origin);
  if (!backup) return { ok: true }; // nothing to refuse — idempotent
  if (backup.status !== "proposed") return { ok: true };
  await tx.entityBackup.update({ where: { id: backup.id }, data: { status: "refused" } });
  return { ok: true };
};

export const handleBackupRevoked = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return { ok: false, reason: "malformed_payload" };
  await tx.backupReplica.updateMany({
    where: { entityType, entityId, originPeerId: origin.id, status: { notIn: ["ended", "refused"] } },
    data: { status: "ended" },
  });
  return { ok: true };
};

export const handleBackupHostingEnded = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const backup = await findHomeBackup(tx, p, origin);
  if (!backup) return { ok: true };
  if (backup.status === "ended") return { ok: true };
  await tx.entityBackup.update({ where: { id: backup.id }, data: { status: "ended" } });
  return { ok: true };
};

// ── Shared helpers ────────────────────────────────────────────────────────────

async function findHomeBackup(
  tx: Prisma.TransactionClient,
  p: Record<string, unknown>,
  origin: FederatedNode,
) {
  const entityType = typeof p.entityType === "string" ? p.entityType : null;
  const entityId = typeof p.entityId === "string" ? p.entityId : null;
  if (!entityType || !entityId) return null;
  const backup = await tx.entityBackup.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  // Only the designated peer may answer for this backup.
  if (!backup || backup.peerId !== origin.id) return null;
  return backup;
}

export async function selfNodeForGroup(
  tx: Prisma.TransactionClient | PrismaClient,
  groupId: string,
): Promise<{ id: string; domain: string } | null> {
  const group = await tx.group.findUnique({
    where: { id: groupId },
    select: { node: { select: { id: true, domain: true } } },
  });
  return group?.node ?? null;
}

// The node an entity's continuity machinery signs as (Phase 5, entity-generic).
// Project branch anchors on the FOUNDING group deliberately: hosting can
// change, and an anchor that moved with the current host would silently
// re-home the entity's signing identity after a hosting transfer — a
// wrongness that only shows up later. Founding-group provenance is immutable.
// Coalition home = the node where the Coalition row lives (positional, F3).
export async function selfNodeForEntity(
  tx: Prisma.TransactionClient | PrismaClient,
  entityType: string,
  entityId: string,
): Promise<{ id: string; domain: string } | null> {
  if (entityType === "group") return selfNodeForGroup(tx, entityId);
  if (entityType === "project") {
    const project = await tx.project.findUnique({
      where: { id: entityId },
      select: { foundingGroup: { select: { node: { select: { id: true, domain: true } } } } },
    });
    return project?.foundingGroup.node ?? null;
  }
  if (entityType === "coalition") {
    const coalition = await tx.coalition.findUnique({
      where: { id: entityId },
      select: { node: { select: { id: true, domain: true } } },
    });
    return coalition?.node ?? null;
  }
  return null;
}

// Entity-generic member count for the establish request. Groups and projects
// count local PEOPLE (the locals-only discipline, register F-10); a coalition
// counts member COLLECTIVES — its people live on their own nodes under their
// own backups, so the collective count is the honest number available, and
// the receiving node sees entityType alongside it.
export async function countEntityMembers(
  client: Prisma.TransactionClient | PrismaClient,
  entityType: string,
  entityId: string,
): Promise<number> {
  if (entityType === "group") return countLocalMembers(client, entityId);
  if (entityType === "project") {
    return client.projectMembership.count({
      where: { projectId: entityId, status: "active", account: NOT_SHADOW_ACCOUNT_FILTER },
    });
  }
  if (entityType === "coalition") {
    return client.coalitionMembership.count({ where: { coalitionId: entityId, endedAt: null } });
  }
  return 0;
}

// Shared establish step (used by the group/project petition apply AND the
// coalition proposal apply): create-or-reset the EntityBackup and send the
// establish request through the D-3 chokepoint.
export async function establishEntityBackup(
  tx: Prisma.TransactionClient,
  input: {
    entityType: string;
    entityId: string;
    entityName: string;
    memberCount: number;
    peerId: string;
    peerDomain: string;
    selfNode: { id: string; domain: string };
    windowHours: number;
    directive: BackupDirective;
  },
): Promise<void> {
  const existing = await tx.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: input.entityType, entityId: input.entityId } },
    select: { id: true, status: true },
  });
  if (existing && (existing.status === "proposed" || existing.status === "active")) return;
  const backup = existing
    ? await tx.entityBackup.update({
        where: { id: existing.id },
        data: {
          peerId: input.peerId,
          windowHours: input.windowHours,
          directive: input.directive,
          status: "proposed",
          manifestSeq: 0,
          lastManifest: Prisma.DbNull,
          takeoverState: "none",
          lastAppliedSeq: 0,
        },
      })
    : await tx.entityBackup.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          peerId: input.peerId,
          windowHours: input.windowHours,
          directive: input.directive,
        },
      });
  await enqueueSignedNodeEvent(tx, input.selfNode, input.peerDomain, "backup_establish_request", {
    entityType: input.entityType,
    entityId: input.entityId,
    name: input.entityName,
    memberCount: input.memberCount,
    windowHours: input.windowHours,
    directive: input.directive,
    backupId: backup.id,
  }, CONTINUITY_DATA_CLASS);
}

// Shared revoke step (petition apply, coalition withdrawal, wire withdrawal).
export async function revokeEntityBackup(
  tx: Prisma.TransactionClient,
  input: { entityType: string; entityId: string; selfNode: { id: string; domain: string } },
): Promise<boolean> {
  const backup = await tx.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: input.entityType, entityId: input.entityId } },
    include: { peer: { select: { domain: true } } },
  });
  if (!backup || backup.status === "revoked" || backup.status === "ended") return false;
  await tx.entityBackup.update({ where: { id: backup.id }, data: { status: "revoked" } });
  await enqueueSignedNodeEvent(tx, input.selfNode, backup.peer.domain, "backup_revoked", {
    entityType: input.entityType,
    entityId: input.entityId,
  }, CONTINUITY_DATA_CLASS);
  return true;
}

async function localNode(tx: Prisma.TransactionClient): Promise<{ id: string; domain: string } | null> {
  // The local node is the oldest Node row (peer rows are always newer —
  // resolveCurrentNode's own fallback rule).
  return tx.node.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, domain: true } });
}
