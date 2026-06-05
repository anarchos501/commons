import type { PrismaClient } from "../generated/prisma/client";
import { openPetition, requireApprovedPetition } from "./petitions";
import type { OpenPetitionResult } from "./petitions";

export type CreateGroupInput = {
  nodeId: string;
  name: string;
  description?: string;
  creatorAccountId: string;
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

  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        nodeId: input.nodeId,
        name: input.name,
        description: input.description,
        membershipPolicy: "request_required",
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
    return group.id;
  });

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
