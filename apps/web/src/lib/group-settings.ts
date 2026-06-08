import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { openPetition, requireApprovedPetition } from "./petitions";
import type { OpenPetitionResult } from "./petitions";

export type GroupMembershipPolicy = "open" | "request_required";

const VALID_MEMBERSHIP_POLICIES: ReadonlySet<string> = new Set<GroupMembershipPolicy>(["open", "request_required"]);

function sanitizeMembershipPolicy(value: unknown): GroupMembershipPolicy {
  return typeof value === "string" && VALID_MEMBERSHIP_POLICIES.has(value)
    ? (value as GroupMembershipPolicy)
    : "request_required";
}

export type CreateGroupInput = {
  nodeId: string;
  name: string;
  description?: string;
  creatorAccountId: string;
  membershipPolicy?: GroupMembershipPolicy;
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
            visibility: "private",
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

export async function proposeGroupVisibility(
  prisma: PrismaClient,
  { groupId, createdByMembershipId }: { groupId: string; createdByMembershipId: string },
): Promise<OpenPetitionResult> {
  return openPetition(prisma, {
    groupId,
    category: "group_settings",
    subjectType: "group_visibility_proposal",
    subjectId: groupId,
    createdByMembershipId,
  });
}

// Called when a group_visibility_proposal petition is approved.
// Idempotent: setting public→public is a no-op.
export async function applyGroupVisibilityFromPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "group_visibility_proposal");
  await prisma.group.update({
    where: { id: petition.groupId },
    data: { visibility: "public" },
  });
}
