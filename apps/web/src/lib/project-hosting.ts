import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { evaluatePetition, openPetition } from "./petitions";
import { logAction } from "./action-log";
import { syncProjectHostingLifecycle } from "./project-membership";

export type OpenProjectHostingWithdrawalResult =
  | { ok: true; petitionId: string; hostingId: string }
  | { ok: false; reason: "not_eligible" | "not_hosting" | "petition_error" };

export type OpenProjectHostingProposalResult =
  | { ok: true; proposalId: string; groupPetitionId: string; projectPetitionId: string }
  | {
      ok: false;
      reason:
        | "not_eligible"
        | "project_not_adoptable"
        | "already_hosted"
        | "empty_electorate"
        | "petition_error";
    };

export type EvaluateProjectHostingProposalResult =
  | { outcome: "succeeded" }
  | { outcome: "failed-rejected" | "failed-withdrawn" | "failed-timeout" }
  | { outcome: "pending" };

type FrozenProjectElectorate = {
  projectId: string;
  capturedAt: string;
  projectMembershipIds: string[];
  accountIds: string[];
};

export async function openProjectHostingWithdrawalPetition(
  prisma: PrismaClient,
  {
    projectId,
    groupId,
    createdByMembershipId,
  }: { projectId: string; groupId: string; createdByMembershipId: string },
): Promise<OpenProjectHostingWithdrawalResult> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  const hosting = await prisma.projectHosting.findFirst({
    where: { projectId, groupId, endedAt: null },
    select: { id: true },
  });
  if (!hosting) return { ok: false, reason: "not_hosting" };

  const result = await openPetition(prisma, {
    groupId,
    category: "project",
    subjectType: "project_hosting_withdrawal",
    subjectId: hosting.id,
    createdByMembershipId,
  });
  if (!result.ok) return { ok: false, reason: "petition_error" };
  return { ok: true, petitionId: result.petitionId, hostingId: hosting.id };
}

export async function onProjectHostingWithdrawalPetitionApproved(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, subjectType: true, subjectId: true, groupId: true, scopeId: true },
  });
  if (!petition || petition.status !== "approved" || petition.subjectType !== "project_hosting_withdrawal") return;

  const hosting = await prisma.projectHosting.findUnique({
    where: { id: petition.subjectId },
    select: { id: true, projectId: true, groupId: true, endedAt: true },
  });
  if (!hosting || hosting.endedAt !== null) return;
  const petitionGroupId = petition.groupId ?? petition.scopeId;
  if (hosting.groupId !== petitionGroupId) {
    throw new Error("Hosting-withdrawal petition group does not match the hosting relationship.");
  }

  const endedAt = new Date();
  await prisma.projectHosting.update({
    where: { id: hosting.id },
    data: { endedAt },
  });
  await logAction(prisma, {
    groupId: hosting.groupId,
    action: "project_hosting.withdrawn",
    targetType: "project_hosting",
    targetId: hosting.id,
    metadata: { projectId: hosting.projectId, endedAt: endedAt.toISOString() },
  });
  await syncProjectHostingLifecycle(prisma, hosting.projectId);
}

export async function openProjectHostingProposal(
  prisma: PrismaClient,
  {
    projectId,
    candidateGroupId,
    groupCreatedByMembershipId,
    projectCreatedByProjectMembershipId,
    content,
  }: {
    projectId: string;
    candidateGroupId: string;
    groupCreatedByMembershipId: string;
    projectCreatedByProjectMembershipId: string;
    content: string;
  },
): Promise<OpenProjectHostingProposalResult> {
  const [project, candidateGroup, groupCreator, projectCreator, activeHosting] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        pendingClosureAt: true,
        pendingClosureElectorate: true,
        foundingGroupId: true,
      },
    }),
    prisma.group.findUnique({
      where: { id: candidateGroupId },
      select: { id: true, name: true, nodeId: true, visibility: true },
    }),
    prisma.groupMembership.findUnique({
      where: { id: groupCreatedByMembershipId },
      select: { groupId: true, status: true, participationStatus: true },
    }),
    prisma.projectMembership.findUnique({
      where: { id: projectCreatedByProjectMembershipId },
      select: { id: true, projectId: true, status: true, participationStatus: true },
    }),
    prisma.projectHosting.findFirst({
      where: { projectId, groupId: candidateGroupId, endedAt: null },
      select: { id: true },
    }),
  ]);

  if (
    !candidateGroup ||
    !groupCreator ||
    groupCreator.groupId !== candidateGroupId ||
    groupCreator.status !== "active" ||
    groupCreator.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  if (!project || project.status === "closed" || project.status === "completed" || project.pendingClosureAt === null) {
    return { ok: false, reason: "project_not_adoptable" };
  }
  if (activeHosting) return { ok: false, reason: "already_hosted" };

  const hasAnyActiveHost = await prisma.projectHosting.count({ where: { projectId, endedAt: null } });
  if (hasAnyActiveHost > 0) return { ok: false, reason: "project_not_adoptable" };

  const frozenElectorate = project.pendingClosureElectorate as FrozenProjectElectorate | null;
  if (!frozenElectorate || frozenElectorate.projectId !== projectId) {
    return { ok: false, reason: "project_not_adoptable" };
  }
  if (frozenElectorate.projectMembershipIds.length === 0) return { ok: false, reason: "empty_electorate" };
  if (
    !projectCreator ||
    projectCreator.projectId !== projectId ||
    projectCreator.status !== "active" ||
    !frozenElectorate.projectMembershipIds.includes(projectCreator.id)
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  const proposalId = randomUUID();
  const trimmedContent = content.trim();
  const projectSnapshot = {
    id: project.id,
    name: project.name,
    description: project.description,
    pendingClosureAt: project.pendingClosureAt.toISOString(),
  };
  const candidateGroupSnapshot = {
    id: candidateGroup.id,
    name: candidateGroup.name,
    nodeId: candidateGroup.nodeId,
    visibility: candidateGroup.visibility,
  };
  const groupPetition = await openPetition(prisma, {
    groupId: candidateGroupId,
    category: "project",
    subjectType: "project_hosting_offer",
    subjectId: proposalId,
    createdByMembershipId: groupCreatedByMembershipId,
  });
  if (!groupPetition.ok) return { ok: false, reason: "petition_error" };

  const projectPetition = await openPetition(prisma, {
    groupId: project.foundingGroupId,
    scopeType: "project",
    scopeId: projectId,
    category: "project",
    subjectType: "project_hosting_acceptance",
    subjectId: proposalId,
    createdByProjectMembershipId: projectCreatedByProjectMembershipId,
    voterScope: { type: "project_frozen", scopeId: projectId, membershipIds: frozenElectorate.projectMembershipIds },
  });
  if (!projectPetition.ok) {
    await markPetitionsSuperseded(prisma, [groupPetition.petitionId]);
    return { ok: false, reason: "petition_error" };
  }

  try {
    await prisma.projectHostingProposal.create({
      data: {
        id: proposalId,
        projectId,
        candidateGroupId,
        projectSnapshot,
        candidateGroupSnapshot,
        frozenElectorate,
        content: trimmedContent,
        groupPetitionId: groupPetition.petitionId,
        projectPetitionId: projectPetition.petitionId,
      },
    });
  } catch (err) {
    await markPetitionsSuperseded(prisma, [groupPetition.petitionId, projectPetition.petitionId]);
    throw err;
  }

  const deadline = new Date(project.pendingClosureAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.petition.updateMany({
    where: { id: { in: [groupPetition.petitionId, projectPetition.petitionId] }, closesAt: { gt: deadline } },
    data: { closesAt: deadline },
  });

  return {
    ok: true,
    proposalId,
    groupPetitionId: groupPetition.petitionId,
    projectPetitionId: projectPetition.petitionId,
  };
}

export async function evaluateProjectHostingProposal(
  prisma: PrismaClient,
  proposalId: string,
): Promise<EvaluateProjectHostingProposalResult> {
  const proposal = await prisma.projectHostingProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      projectId: true,
      candidateGroupId: true,
      groupPetitionId: true,
      projectPetitionId: true,
      status: true,
      project: { select: { pendingClosureAt: true, status: true } },
    },
  });
  if (!proposal || proposal.status !== "open") {
    return proposal?.status === "succeeded" ? { outcome: "succeeded" } : { outcome: "pending" };
  }

  await evaluateClosedChildPetitions(prisma, [proposal.groupPetitionId, proposal.projectPetitionId]);

  const petitions = await prisma.petition.findMany({
    where: { id: { in: [proposal.groupPetitionId, proposal.projectPetitionId] } },
    select: { id: true, status: true, closesAt: true, resolvedAt: true },
  });
  const byId = new Map(petitions.map((petition) => [petition.id, petition]));
  const children = [byId.get(proposal.groupPetitionId), byId.get(proposal.projectPetitionId)];
  if (children.some((petition) => !petition)) return failProjectHostingProposal(prisma, proposal, "failed-withdrawn");

  if (children.some((petition) => petition!.status === "withdrawn" || petition!.status === "superseded")) {
    return failProjectHostingProposal(prisma, proposal, "failed-withdrawn");
  }
  if (children.some((petition) => petition!.status === "rejected" || petition!.status === "blocked")) {
    return failProjectHostingProposal(prisma, proposal, "failed-rejected");
  }

  const now = new Date();
  if (children.some((petition) => petition!.status === "open" && petition!.closesAt <= now)) {
    return failProjectHostingProposal(prisma, proposal, "failed-timeout");
  }

  if (children.every((petition) => petition!.status === "approved")) {
    const deadline = proposal.project.pendingClosureAt
      ? new Date(proposal.project.pendingClosureAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null;
    if (
      !deadline ||
      proposal.project.status === "closed" ||
      proposal.project.status === "completed" ||
      children.some((petition) => !petition!.resolvedAt || petition!.resolvedAt > deadline)
    ) {
      return failProjectHostingProposal(prisma, proposal, "failed-timeout");
    }

    await prisma.$transaction(async (tx) => {
      const activeHosting = await tx.projectHosting.findFirst({
        where: { projectId: proposal.projectId, groupId: proposal.candidateGroupId, endedAt: null },
        select: { id: true },
      });
      if (!activeHosting) {
        await tx.projectHosting.create({
          data: { projectId: proposal.projectId, groupId: proposal.candidateGroupId },
        });
      }
      await tx.project.update({
        where: { id: proposal.projectId },
        data: { pendingClosureAt: null, pendingClosureElectorate: Prisma.JsonNull },
      });
      await tx.projectHostingProposal.update({
        where: { id: proposal.id },
        data: { status: "succeeded", resolvedAt: new Date() },
      });
    });
    await logAction(prisma, {
      groupId: proposal.candidateGroupId,
      action: "project_hosting.adopted",
      targetType: "project",
      targetId: proposal.projectId,
      metadata: { proposalId: proposal.id },
    });
    return { outcome: "succeeded" };
  }

  return { outcome: "pending" };
}

export async function evaluateProjectHostingProposalForPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<EvaluateProjectHostingProposalResult | null> {
  const proposal = await prisma.projectHostingProposal.findFirst({
    where: { OR: [{ groupPetitionId: petitionId }, { projectPetitionId: petitionId }] },
    select: { id: true },
  });
  if (!proposal) return null;
  return evaluateProjectHostingProposal(prisma, proposal.id);
}

async function evaluateClosedChildPetitions(prisma: PrismaClient, petitionIds: string[]): Promise<void> {
  const duePetitions = await prisma.petition.findMany({
    where: { id: { in: petitionIds }, status: "open", closesAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const petition of duePetitions) {
    await evaluatePetition(prisma, petition.id);
  }
}

async function failProjectHostingProposal(
  prisma: PrismaClient,
  proposal: {
    id: string;
    groupPetitionId: string;
    projectPetitionId: string;
  },
  status: "failed-rejected" | "failed-withdrawn" | "failed-timeout",
): Promise<EvaluateProjectHostingProposalResult> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.projectHostingProposal.updateMany({
      where: { id: proposal.id, status: "open" },
      data: { status, resolvedAt: new Date() },
    });
    if (updated.count === 0) return;
    await tx.petition.updateMany({
      where: {
        id: { in: [proposal.groupPetitionId, proposal.projectPetitionId] },
        status: "open",
      },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  });
  return { outcome: status };
}

async function markPetitionsSuperseded(prisma: PrismaClient, petitionIds: string[]): Promise<void> {
  await prisma.petition.updateMany({
    where: { id: { in: petitionIds }, status: "open" },
    data: { status: "superseded", resolvedAt: new Date() },
  });
}
