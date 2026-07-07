import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { logAction } from "./action-log";
import {
  openNodePetition,
  openPetition,
  openSystemGroupPetition,
  requireApprovedPetition,
} from "./petitions";
import { requireActiveNodeHost } from "./node-governance";
import { assertWithinTransaction } from "./prisma";

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
        | "candidate_not_public"
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
  if (await openProposalExists(prisma, nodeId, "appointment", candidateGroupId, { initiatingGroupId })) {
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
  if (await openProposalExists(prisma, nodeId, "appointment", candidateGroupId, { origin: "host" })) {
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
  if (await openProposalExists(prisma, nodeId, "no_confidence", context.stewardGroupId, { initiatingGroupId })) {
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
  if (await openProposalExists(prisma, nodeId, "no_confidence", context.stewardGroupId, { origin: "host" })) {
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
  if (await openProposalExists(prisma, nodeId, "resignation", context.stewardGroupId, { initiatingGroupId: context.stewardGroupId })) {
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

const NODE_STEWARD_FAMILIES = [
  "node_steward_group_nomination",
  "node_steward_candidate_consent",
  "node_steward_appointment",
  "node_steward_no_confidence_initiation",
  "node_steward_no_confidence",
  "node_steward_resignation",
] as const;

export async function evaluateNodeStewardProposalForPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<EvaluateNodeStewardProposalResult | null> {
  let probe = await prisma.nodeStewardProposal.findFirst({
    where: {
      OR: [
        { groupInitiationPetitionId: petitionId },
        { candidateConsentPetitionId: petitionId },
        { nodePetitionId: petitionId },
      ],
    },
    select: { id: true, nodeId: true },
  });
  if (!probe) {
    // Audit A5: the open flows are non-transactional, so a crash between
    // proposal-create and the petition-link update leaves a proposal none of
    // the three link columns can find. subjectId IS the proposalId for every
    // steward family, so fall back to it — recovering the orphan instead of
    // silently never evaluating it. The link is healed below after the lock.
    const petition = await prisma.petition.findUnique({
      where: { id: petitionId },
      select: { subjectId: true, subjectType: true },
    });
    if (!petition || !(NODE_STEWARD_FAMILIES as readonly string[]).includes(petition.subjectType)) return null;
    probe = await prisma.nodeStewardProposal.findUnique({
      where: { id: petition.subjectId },
      select: { id: true, nodeId: true },
    });
    if (!probe) return null;
  }
  assertWithinTransaction(prisma, "evaluateNodeStewardProposalForPetition");

  // Audit A2: the 60s sweep and on-load resolution can evaluate the same
  // petition concurrently, and both re-enter this hook even when their own
  // transaction resolved nothing. Serialize per node and re-read AFTER the
  // lock so the second arrival sees the first one's committed escalation
  // instead of a stale "open" proposal (which would double-open the next
  // petition and orphan a live node vote).
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${probe.nodeId}:node_steward_proposal`}, 0))`;
  const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: probe.id } });
  if (proposal.status === "succeeded") return { outcome: "succeeded" };
  if (proposal.status.startsWith("failed-")) {
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" | "failed-stale" };
  }

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, subjectType: true },
  });

  // Audit A5 (continued): heal a lost link — but only into an EMPTY column.
  // If the column already points at a different petition, this one is a stray
  // duplicate (e.g. a pre-fix double-escalation orphan) and must not become
  // the proposal's gate: report pending and let the linked petition decide.
  if (petition) {
    const linkColumn =
      petition.subjectType === "node_steward_candidate_consent"
        ? ("candidateConsentPetitionId" as const)
        : petition.subjectType === "node_steward_appointment" || petition.subjectType === "node_steward_no_confidence"
          ? ("nodePetitionId" as const)
          : ("groupInitiationPetitionId" as const);
    if (proposal[linkColumn] === null) {
      await prisma.nodeStewardProposal.update({ where: { id: proposal.id }, data: { [linkColumn]: petitionId } });
      proposal[linkColumn] = petitionId;
    } else if (proposal[linkColumn] !== petitionId) {
      return { outcome: "pending" };
    }
  }

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

  // Audit A2 stage guards: each escalation may fire exactly once. A re-entry
  // after escalation sees the advanced status / linked petition id and treats
  // the step as already taken.
  if (petition.subjectType === "node_steward_group_nomination") {
    if (proposal.status !== "open" || proposal.candidateConsentPetitionId || proposal.nodePetitionId) {
      return { outcome: "pending" };
    }
    if (proposal.initiatingGroupId === proposal.candidateGroupId) {
      const next = await openNodeDecision(prisma, proposal.id, "appointment", proposal.nodeId, null, proposal.candidateGroupId);
      return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
    }
    const next = await openCandidateConsent(prisma, proposal.id, proposal.candidateGroupId);
    return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.subjectType === "node_steward_candidate_consent") {
    if (proposal.status !== "awaiting_candidate_consent" || proposal.nodePetitionId) {
      return { outcome: "pending" };
    }
    const next = await openNodeDecision(prisma, proposal.id, "appointment", proposal.nodeId, null, proposal.candidateGroupId);
    return next.ok ? { outcome: "pending" } : failProposal(prisma, proposal.id, "failed-withdrawn");
  }
  if (petition.subjectType === "node_steward_no_confidence_initiation") {
    if (proposal.status !== "open" || proposal.nodePetitionId) {
      return { outcome: "pending" };
    }
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
  prisma: Prisma.TransactionClient,
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
  prisma: Prisma.TransactionClient,
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
  prisma: Prisma.TransactionClient,
  proposalId: string,
): Promise<EvaluateNodeStewardProposalResult> {
  assertWithinTransaction(prisma, "applyProposal");
  const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: proposalId } });

  // Audit A6: re-assert the gating petition really is approved with the right
  // family before mutating node state — the documented handler discipline,
  // rather than trusting caller ordering. Throws (rolling the tx back) on an
  // invariant breach.
  const gatePetitionId = proposal.action === "resignation" ? proposal.groupInitiationPetitionId : proposal.nodePetitionId;
  const gateFamily =
    proposal.action === "appointment"
      ? "node_steward_appointment"
      : proposal.action === "no_confidence"
        ? "node_steward_no_confidence"
        : "node_steward_resignation";
  if (!gatePetitionId) return failProposal(prisma, proposalId, "failed-stale");
  await requireApprovedPetition(prisma, gatePetitionId, gateFamily);

  if (!(await proposalContextStillValid(prisma, proposal))) {
    return failProposal(prisma, proposalId, "failed-stale");
  }
  // Audit A4: atomic staleness — the revision guard in the WHERE clause makes
  // check-then-act impossible: a concurrent apply (e.g. resignation racing a
  // no-confidence vote, neither holding the other's competition lock) bumps
  // the revision first and this update matches zero rows → failed-stale.
  const nodeUpdated = await prisma.node.updateMany({
    where: { id: proposal.nodeId, stewardRevision: proposal.baselineStewardRevision },
    data: {
      stewardGroupId: proposal.action === "appointment" ? proposal.candidateGroupId : null,
      stewardRevision: { increment: 1 },
    },
  });
  if (nodeUpdated.count === 0) return failProposal(prisma, proposalId, "failed-stale");
  await prisma.nodeStewardProposal.updateMany({
    where: { id: proposalId, status: { in: ["open", "awaiting_candidate_consent", "awaiting_node_vote"] } },
    data: { status: "succeeded", resolvedAt: new Date() },
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
  prisma: Prisma.TransactionClient,
  proposalId: string,
  status: Extract<ProposalStatus, `failed-${string}`>,
): Promise<EvaluateNodeStewardProposalResult> {
  const proposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: proposalId } });
  const updated = await prisma.nodeStewardProposal.updateMany({
    where: { id: proposalId, status: { in: ["open", "awaiting_candidate_consent", "awaiting_node_vote"] } },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count > 0) {
    const petitionIds = [
      proposal.groupInitiationPetitionId,
      proposal.candidateConsentPetitionId,
      proposal.nodePetitionId,
    ].filter((id): id is string => Boolean(id));
    await prisma.petition.updateMany({
      where: { id: { in: petitionIds }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  }
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
  prisma: Prisma.TransactionClient,
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
    prisma.group.findUnique({
      where: { id: proposal.candidateGroupId },
      select: { nodeId: true, visibility: true, archivedAt: true },
    }),
  ]);
  if (!node || candidate?.nodeId !== proposal.nodeId) return false;
  if (node.stewardRevision !== proposal.baselineStewardRevision) return false;
  if (proposal.action === "appointment") {
    // Audit A1: the open-time transparency invariant ("a private group must
    // never become node steward") must hold at APPLY time too — a candidate
    // that went private or was archived mid-vote cannot be installed.
    if (candidate.visibility !== "public" || candidate.archivedAt !== null) return false;
    return node.stewardGroupId === proposal.baselineStewardGroupId;
  }
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
  | { ok: false; reason: "not_found" | "wrong_node" | "steward_already_set" | "candidate_not_public" }
> {
  const [node, candidate] = await Promise.all([
    prisma.node.findUnique({ where: { id: nodeId }, select: { name: true, stewardGroupId: true, stewardRevision: true } }),
    prisma.group.findUnique({
      where: { id: candidateGroupId },
      select: { name: true, nodeId: true, visibility: true, archivedAt: true },
    }),
  ]);
  if (!node || !candidate) return { ok: false, reason: "not_found" };
  if (candidate.nodeId !== nodeId) return { ok: false, reason: "wrong_node" };
  // A private group must never become node steward — the steward is a transparency-bearing role.
  // Archived (defunct) groups are equally ineligible (audit A1).
  if (candidate.visibility !== "public" || candidate.archivedAt !== null) {
    return { ok: false, reason: "candidate_not_public" };
  }
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

// Audit A3: the duplicate check is scoped to the INITIATOR, not the node.
// A node-wide mutex was squattable — any member could park a never-approved
// initiation petition and block every other group's (and the host's) recall
// or nomination for its whole duration, then reopen. One open proposal per
// (initiating group | host origin) suffices: the node-stage competition keys
// already serialize the actual decision.
async function openProposalExists(
  prisma: PrismaClient,
  nodeId: string,
  action: string,
  candidateGroupId: string,
  initiator: { initiatingGroupId: string } | { origin: "host" },
): Promise<boolean> {
  const count = await prisma.nodeStewardProposal.count({
    where: {
      nodeId,
      action,
      candidateGroupId,
      ...("initiatingGroupId" in initiator
        ? { initiatingGroupId: initiator.initiatingGroupId }
        : { origin: "host" }),
      status: { in: ["open", "awaiting_candidate_consent", "awaiting_node_vote"] },
    },
  });
  return count > 0;
}
