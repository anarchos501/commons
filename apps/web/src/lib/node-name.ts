import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { openPetition, openNodePetition } from "./petitions";

export type OpenNodeNameProposalResult =
  | { ok: true; proposalId: string; petitionId: string }
  | { ok: false; reason: "not_eligible" | "not_found" | "wrong_node" | "invalid_name" | "petition_error" };

export type EvaluateNodeNameResult =
  | { outcome: "pending" }
  | { outcome: "succeeded" }
  | { outcome: "failed-rejected" | "failed-withdrawn" };

const MAX_NODE_NAME = 100;

/**
 * A group internally proposes a new node name. Opens a group-scoped petition; on group approval the
 * proposal escalates to a node-wide vote (see evaluateNodeNameProposalForPetition), and on node
 * approval the node is renamed. Mirrors the node-steward escalation.
 */
export async function openNodeNameProposal(
  prisma: PrismaClient,
  {
    nodeId,
    initiatingGroupId,
    proposedName,
    createdByMembershipId,
  }: { nodeId: string; initiatingGroupId: string; proposedName: string; createdByMembershipId: string },
): Promise<OpenNodeNameProposalResult> {
  const name = proposedName.trim();
  if (!name || name.length > MAX_NODE_NAME) return { ok: false, reason: "invalid_name" };

  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== initiatingGroupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  const group = await prisma.group.findUnique({ where: { id: initiatingGroupId }, select: { nodeId: true } });
  if (!group) return { ok: false, reason: "not_found" };
  if (group.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };

  const proposal = await prisma.nodeNameProposal.create({
    data: { nodeId, initiatingGroupId, proposedName: name, status: "awaiting_group" },
  });
  const petition = await openPetition(prisma, {
    groupId: initiatingGroupId,
    category: "node_stewardship",
    subjectType: "node_name_change_proposal",
    subjectId: proposal.id,
    createdByMembershipId,
  });
  if (!petition.ok) {
    await prisma.nodeNameProposal.delete({ where: { id: proposal.id } });
    return { ok: false, reason: "petition_error" };
  }
  await prisma.nodeNameProposal.update({ where: { id: proposal.id }, data: { groupPetitionId: petition.petitionId } });
  return { ok: true, proposalId: proposal.id, petitionId: petition.petitionId };
}

export async function evaluateNodeNameProposalForPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<EvaluateNodeNameResult | null> {
  const proposal = await prisma.nodeNameProposal.findFirst({
    where: { OR: [{ groupPetitionId: petitionId }, { nodePetitionId: petitionId }] },
  });
  if (!proposal) return null;
  if (proposal.status === "succeeded") return { outcome: "succeeded" };
  if (proposal.status.startsWith("failed-")) {
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" };
  }

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, subjectType: true },
  });
  if (!petition || petition.status === "withdrawn" || petition.status === "superseded") {
    return failNodeName(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.status === "rejected" || petition.status === "blocked") {
    return failNodeName(prisma, proposal.id, "failed-rejected");
  }
  if (petition.status !== "approved") return { outcome: "pending" };

  if (petition.subjectType === "node_name_change_proposal") {
    // Group approved → escalate to a node-wide vote.
    const nodePetition = await openNodePetition(prisma, {
      nodeId: proposal.nodeId,
      category: "node_stewardship",
      subjectType: "node_name_change",
      subjectId: proposal.id,
    });
    if (!nodePetition.ok) return failNodeName(prisma, proposal.id, "failed-withdrawn");
    await prisma.nodeNameProposal.update({
      where: { id: proposal.id },
      data: { nodePetitionId: nodePetition.petitionId, status: "awaiting_node_vote" },
    });
    return { outcome: "pending" };
  }
  if (petition.subjectType === "node_name_change") {
    // Node approved → rename the node.
    await prisma.node.update({ where: { id: proposal.nodeId }, data: { name: proposal.proposedName } });
    await prisma.nodeNameProposal.update({
      where: { id: proposal.id },
      data: { status: "succeeded", resolvedAt: new Date() },
    });
    return { outcome: "succeeded" };
  }
  return { outcome: "pending" };
}

async function failNodeName(
  prisma: Prisma.TransactionClient,
  proposalId: string,
  status: "failed-rejected" | "failed-withdrawn",
): Promise<EvaluateNodeNameResult> {
  await prisma.nodeNameProposal.update({ where: { id: proposalId }, data: { status, resolvedAt: new Date() } });
  return { outcome: status };
}
