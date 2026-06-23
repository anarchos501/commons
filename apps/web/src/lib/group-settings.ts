import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { openPetition, requireApprovedPetition } from "./petitions";
import type { OpenPetitionResult } from "./petitions";
import { provisionConcernReviewer } from "./concern-reviewer";

export type GroupMembershipPolicy = "open" | "request_required";
export type GroupVisibilityValue = "private" | "public";

const VALID_MEMBERSHIP_POLICIES: ReadonlySet<string> = new Set<GroupMembershipPolicy>(["open", "request_required"]);
const VALID_VISIBILITIES: ReadonlySet<string> = new Set<GroupVisibilityValue>(["private", "public"]);

function sanitizeMembershipPolicy(value: unknown): GroupMembershipPolicy {
  return typeof value === "string" && VALID_MEMBERSHIP_POLICIES.has(value)
    ? (value as GroupMembershipPolicy)
    : "request_required";
}

function sanitizeVisibility(value: unknown): GroupVisibilityValue {
  return typeof value === "string" && VALID_VISIBILITIES.has(value)
    ? (value as GroupVisibilityValue)
    : "private";
}

export type CreateGroupInput = {
  nodeId: string;
  name: string;
  description?: string;
  creatorAccountId: string;
  membershipPolicy?: GroupMembershipPolicy;
  visibility?: GroupVisibilityValue;
};

export type CreateGroupResult =
  | { ok: true; groupId: string }
  | { ok: false; reason: "duplicate_name" };

export async function createGroup(
  prisma: PrismaClient,
  input: CreateGroupInput,
): Promise<CreateGroupResult> {
  const existing = await prisma.group.findUnique({
    where: { nodeId_name: { nodeId: input.nodeId, name: input.name } },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "duplicate_name" };

  const membershipPolicy = sanitizeMembershipPolicy(input.membershipPolicy);
  const visibility = sanitizeVisibility(input.visibility);

  let result: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const existingGroupCount = await tx.group.count({ where: { nodeId: input.nodeId } });
        const group = await tx.group.create({
          data: {
            nodeId: input.nodeId,
            name: input.name,
            description: input.description,
            membershipPolicy,
            visibility,
          },
        });
        await tx.groupMembership.create({
          data: {
            accountId: input.creatorAccountId,
            groupId: group.id,
            status: "active",
            participationStatus: "active",
          },
        });
        // Every group gets the Concern Reviewer accountability role so the path always
        // exists for members to volunteer for (no one is assigned it automatically).
        await provisionConcernReviewer(tx, group.id);
        if (existingGroupCount === 0) {
          await tx.nodeHost.create({
            data: { nodeId: input.nodeId, accountId: input.creatorAccountId },
          });
        }
        return group.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!result) throw new Error("Could not create group after retrying the bootstrap transaction.");

  return { ok: true, groupId: result };
}

export type ProposeGroupVisibilityResult =
  | OpenPetitionResult
  | { ok: false; reason: "already_set" };

/**
 * Opens a petition to change a group's visibility. Bidirectional: a group can
 * petition to become public (discoverable) or back to private (reversibility).
 * The target is carried in subjectId as `${groupId}:${target}` so the approval
 * handler and the petition framing can both recover it without a schema change
 * (same encoding pattern as responsibility_proposal's `${membershipId}:${type}`).
 */
export async function proposeGroupVisibility(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    target = "public",
  }: { groupId: string; createdByMembershipId: string; target?: GroupVisibilityValue },
): Promise<ProposeGroupVisibilityResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { visibility: true } });
  // No-op guard: don't open a petition to set the visibility a group already has.
  if (group && group.visibility === target) return { ok: false, reason: "already_set" };
  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "group_visibility_proposal",
    subjectId: `${groupId}:${target}`,
    createdByMembershipId,
  });
}

// Called when a group_visibility_proposal petition is approved.
// Idempotent: setting a visibility the group already has is a no-op.
export async function applyGroupVisibilityFromPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "group_visibility_proposal");
  // subjectId is `${groupId}:${target}`; fall back to "public" for any legacy
  // petition whose subjectId was the bare groupId (the old one-way behavior).
  const target = sanitizeVisibility(petition.subjectId.split(":")[1] ?? "public");
  await prisma.group.update({
    where: { id: petition.groupId },
    data: { visibility: target },
  });
}

// ── Custom support requests (feedback #1) ─────────────────────────────────────
// Accepting/declining free-text "custom" support requests is collective-wide, so it
// must be petitioned rather than flipped by a single member. Encoded like visibility:
// subjectId is `${groupId}:${"on"|"off"}` carrying the target state.
export type ProposeCustomRequestsToggleResult =
  | OpenPetitionResult
  | { ok: false; reason: "already_set" };

export async function proposeCustomRequestsToggle(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    accepts,
  }: { groupId: string; createdByMembershipId: string; accepts: boolean },
): Promise<ProposeCustomRequestsToggleResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { acceptsCustomRequests: true } });
  if (group && group.acceptsCustomRequests === accepts) return { ok: false, reason: "already_set" };
  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "custom_support_requests_toggle",
    subjectId: `${groupId}:${accepts ? "on" : "off"}`,
    createdByMembershipId,
  });
}

export async function applyCustomRequestsToggleFromPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "custom_support_requests_toggle");
  const accepts = (petition.subjectId.split(":")[1] ?? "off") === "on";
  await prisma.group.update({
    where: { id: petition.groupId },
    data: { acceptsCustomRequests: accepts },
  });
}

// ── Membership policy (feedback #2) ───────────────────────────────────────────
// Transition a group between open and application-based ("request_required") membership.
// Petitioned under the membership category so it inherits membership thresholds.
// subjectId is `${groupId}:${policy}`.
export type ProposeMembershipPolicyChangeResult =
  | OpenPetitionResult
  | { ok: false; reason: "already_set" };

export async function proposeMembershipPolicyChange(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    target,
  }: { groupId: string; createdByMembershipId: string; target: GroupMembershipPolicy },
): Promise<ProposeMembershipPolicyChangeResult> {
  const policy = sanitizeMembershipPolicy(target);
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { membershipPolicy: true } });
  if (group && group.membershipPolicy === policy) return { ok: false, reason: "already_set" };
  return openPetition(prisma, {
    groupId,
    category: "membership",
    subjectType: "membership_policy_change",
    subjectId: `${groupId}:${policy}`,
    createdByMembershipId,
  });
}

export async function applyMembershipPolicyChangeFromPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "membership_policy_change");
  const target = sanitizeMembershipPolicy(petition.subjectId.split(":")[1] ?? "request_required");
  await prisma.group.update({
    where: { id: petition.groupId },
    data: { membershipPolicy: target },
  });
}
