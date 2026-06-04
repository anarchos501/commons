import type { PrismaClient } from "../generated/prisma/client";
import { openPetition, requireApprovedPetition } from "./petitions";
import { logAction } from "./action-log";

export type ProposeProjectResult =
  | { ok: true; proposalId: string; petitionId: string }
  | { ok: false; reason: "not_eligible" | "petition_error" };

/**
 * Active group member proposes a new project. Opens a project_proposal petition
 * with a Proposal record as the subject. The group votes; on approval,
 * createProjectFromPetition() creates the actual Project.
 */
export async function proposeProject(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    accountId,
    name,
    description,
  }: {
    groupId: string;
    createdByMembershipId: string;
    accountId: string;
    name: string;
    description: string;
  },
): Promise<ProposeProjectResult> {
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

  const proposal = await prisma.proposal.create({
    data: {
      groupId,
      title: name,
      body: description,
      createdByAccountId: accountId,
      status: "open",
    },
  });

  const result = await openPetition(prisma, {
    groupId,
    category: "project",
    subjectType: "project_proposal",
    subjectId: proposal.id,
    createdByMembershipId,
  });

  if (!result.ok) {
    // Clean up the proposal if the petition couldn't be opened
    await prisma.proposal.delete({ where: { id: proposal.id } });
    return { ok: false, reason: "petition_error" };
  }

  return { ok: true, proposalId: proposal.id, petitionId: result.petitionId };
}

/**
 * Called when a project_proposal petition is approved.
 * Creates Project, ProjectHosting, and initial ProjectMembership for proposer.
 * Idempotent: checks proposal.status before creating to prevent duplicates.
 */
export async function createProjectFromPetition(
  prisma: PrismaClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(prisma, petitionId, "project_proposal");

  const proposal = await prisma.proposal.findUnique({
    where: { id: petition.subjectId },
    select: { id: true, groupId: true, title: true, body: true, status: true, createdByAccountId: true },
  });
  if (!proposal) throw new Error(`Proposal ${petition.subjectId} not found.`);

  // Idempotency guard: skip if already implemented
  if (proposal.status === "implemented") return;

  const project = await prisma.project.create({
    data: {
      groupId: proposal.groupId,
      name: proposal.title,
      description: proposal.body || null,
      status: "active",
      membershipPolicy: "petition",
    },
  });

  await prisma.projectHosting.create({
    data: { projectId: project.id, groupId: proposal.groupId },
  });

  await prisma.projectMembership.create({
    data: {
      accountId: proposal.createdByAccountId,
      projectId: project.id,
      status: "active",
      participationStatus: "active",
    },
  });

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { status: "implemented", resolvedAt: new Date() },
  });

  await logAction(prisma, {
    actorAccountId: proposal.createdByAccountId,
    groupId: proposal.groupId,
    action: "project.created",
    targetType: "project",
    targetId: project.id,
  });
}
