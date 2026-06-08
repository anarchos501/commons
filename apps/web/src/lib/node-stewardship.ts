import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";
import {
  openNodePetition,
  openPetition,
  openSystemGroupPetition,
} from "./petitions";
import { requireActiveNodeHost } from "./node-governance";

type ProposalStatus =
  | "open"
  | "awaiting_candidate_consent"
  | "awaiting_node_vote"
  | "succeeded"
  | "failed-rejected"
  | "failed-withdrawn"
  | "failed-stale";

export type OpenNodeStewardProposalResult =
  | { ok: true; proposalId: string; petitionId: string }
  | {
      ok: false;
      reason:
        | "not_eligible"
        | "not_found"
        | "wrong_node"
        | "steward_already_set"
        | "no_current_steward"
        | "proposal_already_open"
        | "petition_error";
    };

export type EvaluateNodeStewardProposalResult =
  | { outcome: "pending" }
  | { outcome: "succeeded" }
  | { outcome: "failed-rejected" | "failed-withdrawn" | "failed-stale" };

export async function openGroupStewardNomination(
  prisma: PrismaClient,
  {
    nodeId,
    initiatingGroupId,
    candidateGroupId,
    createdByMembershipId,
  }: {
    nodeId: string;
    initiatingGroupId: string;
    candidateGroupId: string;
    createdByMembershipId: string;
  },
): Promise<OpenNodeStewardProposalResult> {
  const context = await validateAppointmentContext(prisma, nodeId, candidateGroupId);
  if (!context.ok) return context;
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !membership ||
    membership.groupId !== initiatingGroupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  const initiatingGroup = await prisma.group.findUnique({
    where: { id: initiatingGroupId },
    select: { nodeId: true, name: true },
  });
  if (!initiatingGroup) return { ok: false, reason: "not_found" };
  if (initiatingGroup.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };
  if (await openProposalExists(prisma, nodeId, "appointment", candidateGroupId)) {
    return { ok: false, reason: "proposal_already_open" };
  }

  const proposalId = randomUUID();
  await prisma.nodeStewardProposal.create({
    data: {
      id: proposalId,
      nodeId,
      action: "appointment",
      origin: "group",
      candidateGroupId,
      initiatingGroupId,
      initiatedByAccountId: membership.accountId,
      baselineStewardGroupId: null,
      baselineStewardRevision: context.stewardRevision,
      status: "open",
      snapshot: {
        node: { id: nodeId, name: context.nodeName },
        candidateGroup: { id: candidateGroupId, name: context.candidateName },
        initiatingGroup: { id: initiatingGroupId, name: initiatingGroup.name },
      },
    },
  });
  const petition = await openPetition(prisma, {
    groupId: initiatingGroupId,
    category: "node_stewardship",
    subjectType: "node_steward_group_nomination",
    subjectId: proposalId,
    createdByMembershipId,
  });
  if (!petition.ok) return failOpening(prisma, proposalId);
  await prisma.nodeStewardProposal.update({
    where: { id: proposalId },
    data: { groupInitiationPetitionId: petition.petitionId },
  });
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

export async function openHostStewardNomination(
  prisma: PrismaClient,
  {
    nodeId,
    candidateGroupId,
    hostAccountId,
  }: {
    nodeId: string;
    candidateGroupId: string;
    hostAccountId: string;
  },
): Promise<OpenNodeStewardProposalResult> {
  try {
    await requireActiveNodeHost(prisma, nodeId, hostAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  const context = await validateAppointmentContext(prisma, nodeId, candidateGroupId);
  if (!context.ok) return context;
  if (await openProposalExists(prisma, nodeId, "appointment", candidateGroupId)) {
    return { ok: false, reason: "proposal_already_open" };
  }
  const proposalId = randomUUID();
  await prisma.nodeStewardProposal.create({
    data: {
      id: proposalId,
      nodeId,
      action: "appointment",
      origin: "host",
      candidateGroupId,
      initiatedByAccountId: hostAccountId,
      baselineStewardGroupId: null,
      baselineStewardRevision: context.stewardRevision,
      status: "awaiting_candidate_consent",
      snapshot: {
        node: { id: nodeId, name: context.nodeName },
        candidateGroup: { id: candidateGroupId, name: context.candidateName },
      },
    },
  });
  const petition = await openCandidateConsent(prisma, proposalId, candidateGroupId);
  if (!petition.ok) return failOpening(prisma, proposalId);
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

export async function openGroupNoConfidence(
  prisma: PrismaClient,
  {
    nodeId,
    initiatingGroupId,
    createdByMembershipId,
  }: {
    nodeId: string;
    initiatingGroupId: string;
    createdByMembershipId: string;
  },
): Promise<OpenNodeStewardProposalResult> {
  const context = await validateNoConfidenceContext(prisma, nodeId);
  if (!context.ok) return context;
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, accountId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== initiatingGroupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  const initiatingGroup = await prisma.group.findUnique({
    where: { id: initiatingGroupId },
    select: { nodeId: true, name: true },
  });
  if (!initiatingGroup) return { ok: false, reason: "not_found" };
  if (initiatingGroup.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };
  if (await openProposalExists(prisma, nodeId, "no_confidence", context.stewardGroupId)) {
    return { ok: false, reason: "proposal_already_open" };
  }
  const proposalId = randomUUID();
  await prisma.nodeStewardProposal.create({
    data: {
      id: proposalId,
      nodeId,
      action: "no_confidence",
      origin: "group",
      candidateGroupId: context.stewardGroupId,
      initiatingGroupId,
      initiatedByAccountId: membership.accountId,
      baselineStewardGroupId: context.stewardGroupId,
      baselineStewardRevision: context.stewardRevision,
      status: "open",
      snapshot: {
        node: { id: nodeId, name: context.nodeName },
        stewardGroup: { id: context.stewardGroupId, name: context.stewardName },
        initiatingGroup: { id: initiatingGroupId, name: initiatingGroup.name },
      },
    },
  });
  const petition = await openPetition(prisma, {
    groupId: initiatingGroupId,
    category: "node_stewardship",
    subjectType: "node_steward_no_confidence_initiation",
    subjectId: proposalId,
    createdByMembershipId,
  });
  if (!petition.ok) return failOpening(prisma, proposalId);
  await prisma.nodeStewardProposal.update({
    where: { id: proposalId },
    data: { groupInitiationPetitionId: petition.petitionId },
  });
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

export async function openHostNoConfidence(
  prisma: PrismaClient,
  {
    nodeId,
    hostAccountId,
  }: {
    nodeId: string;
    hostAccountId: string;
  },
): Promise<OpenNodeStewardProposalResult> {
  try {
    await requireActiveNodeHost(prisma, nodeId, hostAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  const context = await validateNoConfidenceContext(prisma, nodeId);
  if (!context.ok) return context;
  if (await openProposalExists(prisma, nodeId, "no_confidence", context.stewardGroupId)) {
    return { ok: false, reason: "proposal_already_open" };
  }
  const proposalId = randomUUID();
  await prisma.nodeStewardProposal.create({
    data: {
      id: proposalId,
      nodeId,
      action: "no_confidence",
      origin: "host",
      candidateGroupId: context.stewardGroupId,
      initiatedByAccountId: hostAccountId,
      baselineStewardGroupId: context.stewardGroupId,
      baselineStewardRevision: context.stewardRevision,
      status: "awaiting_node_vote",
      snapshot: {
        node: { id: nodeId, name: context.nodeName },
        stewardGroup: { id: context.stewardGroupId, name: context.stewardName },
      },
    },
  });
  const petition = await openNodeDecision(prisma, proposalId, "no_confidence", nodeId, hostAccountId, context.stewardGroupId);
  if (!petition.ok) return failOpening(prisma, proposalId);
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

export async function openStewardResignation(
  prisma: PrismaClient,
  {
    nodeId,
    createdByMembershipId,
  }: {
    nodeId: string;
    createdByMembershipId: string;
  },
): Promise<OpenNodeStewardProposalResult> {
  const context = await validateNoConfidenceContext(prisma, nodeId);
  if (!context.ok) return context;
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, accountId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== context.stewardGroupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  if (await openProposalExists(prisma, nodeId, "resignation", context.stewardGroupId)) {
    return { ok: false, reason: "proposal_already_open" };
  }
  const proposalId = randomUUID();
  await prisma.nodeStewardProposal.create({
    data: {
      id: proposalId,
      nodeId,
      action: "resignation",
      origin: "group",
      candidateGroupId: context.stewardGroupId,
      initiatingGroupId: context.stewardGroupId,
      initiatedByAccountId: membership.accountId,
      baselineStewardGroupId: context.stewardGroupId,
      baselineStewardRevision: context.stewardRevision,
      status: "open",
      snapshot: {
        node: { id: nodeId, name: context.nodeName },
        stewardGroup: { id: context.stewardGroupId, name: context.stewardName },
      },
    },
  });
  const petition = await openPetition(prisma, {
    groupId: context.stewardGroupId,
    category: "node_stewardship",
    subjectType: "node_steward_resignation",
    subjectId: proposalId,
    createdByMembershipId,
  });
  if (!petition.ok) return failOpening(prisma, proposalId);
  await prisma.nodeStewardProposal.update({
    where: { id: proposalId },
    data: { groupInitiationPetitionId: petition.petitionId },
  });
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

export async function evaluateNodeStewardProposalForPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateNodeStewardProposalResult | null> {
  const proposal = await prisma.nodeStewardProposal.findFirst({
    where: {
      OR: [
        { groupInitiationPetitionId: petitionId },
        { candidateConsentPetitionId: petitionId },
        { nodePetitionId: petitionId },
      ],
    },
  });
  if (!proposal) return null;
  if (proposal.status === "succeeded") return { outcome: "succeeded" };
  if (proposal.status.startsWith("failed-")) {
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" | "failed-stale" };
  }

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, subjectType: true },
  });
  if (!petition || petition.status === "withdrawn" || petition.status === "superseded") {
    return failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.status === "rejected" || petition.status === "blocked") {
    return failProposal(prisma, proposal.id, "failed-rejected");
  }
  if (petition.status !== "approved") return { outcome: "pending" };
  if (!(await proposalContextStillValid(prisma, proposal))) {
    return failProposal(prisma, proposal.id, "failed-stale");
  }

  if (petition.subjectType === "node_steward_group_nomination") {
    if (proposal.initiatingGroupId === proposal.candidateGroupId) {
      const next = await openNodeDecision(prisma, proposal.id, "appointment", proposal.nodeId, null, proposal.candidateGroupId);
      return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
    }
    const next = await openCandidateConsent(prisma, proposal.id, proposal.candidateGroupId);
    return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.subjectType === "node_steward_candidate_consent") {
    const next = await openNodeDecision(prisma, proposal.id, "appointment", proposal.nodeId, null, proposal.candidateGroupId);
    return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.subjectType === "node_steward_no_confidence_initiation") {
    const next = await openNodeDecision(prisma, proposal.id, "no_confidence", proposal.nodeId, null, proposal.candidateGroupId);
    return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.subjectType === "node_steward_resignation") {
    return applyProposal(prisma, proposal.id);
  }
  if (
    petition.subjectType === "node_steward_appointment" ||
    petition.subjectType === "node_steward_no_confidence"
  ) {
    return applyProposal(prisma, proposal.id);
  }
  return { outcome: "pending" };
}

async function openCandidateConsent(
  prisma: PrismaClient,
  proposalId: string,
  candidateGroupId: string,
) {
  const petition = await openSystemGroupPetition(prisma, {
    groupId: candidateGroupId,
    category: "node_stewardship",
    subjectType: "node_steward_candidate_consent",
    subjectId: proposalId,
  });
  if (petition.ok) {
    await prisma.nodeStewardProposal.update({
      where: { id: proposalId },
      data: {
        candidateConsentPetitionId: petition.petitionId,
        status: "awaiting_candidate_consent",
      },
    });
  }
  return petition;
}

async function openNodeDecision(
  prisma: PrismaClient,
  proposalId: string,
  action: "appointment" | "no_confidence",
  nodeId: string,
  createdByAccountId: string | null,
  competitionSubjectId: string,
) {
  const petition = await openNodePetition(prisma, {
    nodeId,
    category: "node_stewardship",
    subjectType: action === "appointment" ? "node_steward_appointment" : "node_steward_no_confidence",
    subjectId: proposalId,
    createdByAccountId,
    competitionSubjectId,
  });
  if (petition.ok) {
    await prisma.nodeStewardProposal.update({
      where: { id: proposalId },
      data: { nodePetitionId: petition.petitionId, status: "awaiting_node_vote" },
    });
  }
  return petition;
}

async function applyProposal(
  prisma: PrismaClient,
  proposalId: string,
): Promise<EvaluateNodeStewardProposalResult> {
  const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (!(await proposalContextStillValid(prisma, proposal))) {
    return failProposal(prisma, proposalId, "failed-stale");
  }
  await prisma.$transaction(async (tx) => {
    await tx.node.update({
      where: { id: proposal.nodeId },
      data: {
        stewardGroupId: proposal.action === "appointment" ? proposal.candidateGroupId : null,
        stewardRevision: { increment: 1 },
      },
    });
    await tx.nodeStewardProposal.update({
      where: { id: proposalId },
      data: { status: "succeeded", resolvedAt: new Date() },
    });
  });
  await logAction(prisma, {
    actorAccountId: proposal.initiatedByAccountId,
    nodeId: proposal.nodeId,
    groupId: proposal.initiatingGroupId,
    action:
      proposal.action === "appointment"
        ? "node.steward.appointed"
        : proposal.action === "resignation"
          ? "node.steward.resigned"
          : "node.steward.removed",
    targetType: "group",
    targetId: proposal.candidateGroupId,
    metadata: { proposalId, origin: proposal.origin },
  });
  return { outcome: "succeeded" };
}

async function failProposal(
  prisma: PrismaClient,
  proposalId: string,
  status: Extract<ProposalStatus, `failed-${string}`>,
): Promise<EvaluateNodeStewardProposalResult> {
  const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: proposalId } });
  await prisma.$transaction(async (tx) => {
    const updated = await tx.nodeStewardProposal.updateMany({
      where: { id: proposalId, status: { in: ["open", "awaiting_candidate_consent", "awaiting_node_vote"] } },
      data: { status, resolvedAt: new Date() },
    });
    if (updated.count === 0) return;
    const petitionIds = [
      proposal.groupInitiationPetitionId,
      proposal.candidateConsentPetitionId,
      proposal.nodePetitionId,
    ].filter((id): id is string => Boolean(id));
    await tx.petition.updateMany({
      where: { id: { in: petitionIds }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  });
  return { outcome: status };
}

async function failOpening(
  prisma: PrismaClient,
  proposalId: string,
): Promise<OpenNodeStewardProposalResult> {
  await failProposal(prisma, proposalId, "failed-withdrawn");
  return { ok: false, reason: "petition_error" };
}

async function proposalContextStillValid(
  prisma: PrismaClient,
  proposal: {
    nodeId: string;
    action: string;
    candidateGroupId: string;
    baselineStewardGroupId: string | null;
    baselineStewardRevision: number;
  },
): Promise<boolean> {
  const [node, candidate] = await Promise.all([
    prisma.node.findUnique({ where: { id: proposal.nodeId }, select: { stewardGroupId: true, stewardRevision: true } }),
    prisma.group.findUnique({ where: { id: proposal.candidateGroupId }, select: { nodeId: true } }),
  ]);
  if (!node || candidate?.nodeId !== proposal.nodeId) return false;
  if (node.stewardRevision !== proposal.baselineStewardRevision) return false;
  if (proposal.action === "appointment") return node.stewardGroupId === proposal.baselineStewardGroupId;
  return (
    node.stewardGroupId === proposal.baselineStewardGroupId &&
    proposal.baselineStewardGroupId === proposal.candidateGroupId
  );
}

async function validateAppointmentContext(
  prisma: PrismaClient,
  nodeId: string,
  candidateGroupId: string,
): Promise<
  | { ok: true; nodeName: string; candidateName: string; stewardRevision: number }
  | { ok: false; reason: "not_found" | "wrong_node" | "steward_already_set" }
> {
  const [node, candidate] = await Promise.all([
    prisma.node.findUnique({ where: { id: nodeId }, select: { name: true, stewardGroupId: true, stewardRevision: true } }),
    prisma.group.findUnique({ where: { id: candidateGroupId }, select: { name: true, nodeId: true } }),
  ]);
  if (!node || !candidate) return { ok: false, reason: "not_found" };
  if (candidate.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };
  if (node.stewardGroupId) return { ok: false, reason: "steward_already_set" };
  return { ok: true, nodeName: node.name, candidateName: candidate.name, stewardRevision: node.stewardRevision };
}

async function validateNoConfidenceContext(
  prisma: PrismaClient,
  nodeId: string,
): Promise<
  | { ok: true; nodeName: string; stewardGroupId: string; stewardName: string; stewardRevision: number }
  | { ok: false; reason: "not_found" | "no_current_steward" | "wrong_node" }
> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: {
      name: true,
      stewardGroupId: true,
      stewardRevision: true,
      stewardGroup: { select: { id: true, name: true, nodeId: true } },
    },
  });
  if (!node) return { ok: false, reason: "not_found" };
  if (!node.stewardGroupId || !node.stewardGroup) return { ok: false, reason: "no_current_steward" };
  if (node.stewardGroup.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };
  return {
    ok: true,
    nodeName: node.name,
    stewardGroupId: node.stewardGroupId,
    stewardName: node.stewardGroup.name,
    stewardRevision: node.stewardRevision,
  };
}

async function openProposalExists(
  prisma: PrismaClient,
  nodeId: string,
  action: string,
  candidateGroupId: string,
): Promise<boolean> {
  const count = await prisma.nodeStewardProposal.count({
    where: {
      nodeId,
      action,
      candidateGroupId,
      status: { in: ["open", "awaiting_candidate_consent", "awaiting_node_vote"] },
    },
  });
  return count > 0;
}
