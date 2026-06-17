import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { ProposalFamily } from "./governance-proposal-families";
import { evaluatePetition, openPetition, openSystemGroupPetition } from "./petitions";
import { assertWithinTransaction } from "./prisma";

export type CoalitionProposalAction = "formation" | "join" | "departure" | "removal";

type GroupSponsor = {
  groupId: string;
  createdByMembershipId?: string;
};

type ParticipantSnapshot = {
  capturedAt: string;
  groupIds: string[];
  currentCoalitionGroupIds: string[];
};

export type OpenCoalitionProposalResult =
  | { ok: true; proposalId: string; petitionIds: string[] }
  | {
      ok: false;
      reason:
        | "invalid_participants"
        | "not_eligible"
        | "not_found"
        | "already_member"
        | "not_member"
        | "duplicate_name"
        | "petition_error";
    };

export type EvaluateCoalitionProposalResult =
  | { outcome: "succeeded"; coalitionId: string }
  | { outcome: "failed-rejected" | "failed-withdrawn" | "failed-timeout" }
  | { outcome: "pending" };

export async function openCoalitionFormationProposal(
  prisma: PrismaClient,
  {
    name,
    description,
    content,
    participants,
  }: {
    name: string;
    description?: string | null;
    content: string;
    participants: GroupSponsor[];
  },
): Promise<OpenCoalitionProposalResult> {
  const normalizedName = name.trim();
  const uniqueParticipants = uniqueSponsors(participants);
  if (!normalizedName || uniqueParticipants.length < 2 || uniqueParticipants.length !== participants.length) {
    return { ok: false, reason: "invalid_participants" };
  }

  const groups = await loadSponsorGroups(prisma, uniqueParticipants);
  if (!groups) return { ok: false, reason: "not_eligible" };
  const initiatingGroupId = uniqueParticipants.find((participant) => participant.createdByMembershipId)!.groupId;
  const nodeIds = new Set(groups.map((group) => group.nodeId));
  if (nodeIds.size !== 1) return { ok: false, reason: "invalid_participants" };

  const duplicate = await prisma.coalition.findFirst({
    where: { nodeId: groups[0].nodeId, name: normalizedName },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "duplicate_name" };

  return createCoalitionProposal(prisma, {
    action: "formation",
    coalitionId: null,
    proposedByGroupId: initiatingGroupId,
    targetGroupId: null,
    name: normalizedName,
    description: description?.trim() || null,
    content,
    currentCoalitionGroupIds: [],
    sponsors: uniqueParticipants.map((sponsor) => ({ ...sponsor, role: "participant" })),
    groups,
  });
}

export async function openCoalitionJoinProposal(
  prisma: PrismaClient,
  {
    coalitionId,
    applicant,
    memberSponsors,
    content,
  }: {
    coalitionId: string;
    applicant: GroupSponsor;
    memberSponsors: GroupSponsor[];
    content: string;
  },
): Promise<OpenCoalitionProposalResult> {
  const coalition = await loadActiveCoalition(prisma, coalitionId);
  if (!coalition) return { ok: false, reason: "not_found" };
  const currentGroupIds = coalition.memberships.map((membership) => membership.groupId).sort();
  if (currentGroupIds.includes(applicant.groupId)) return { ok: false, reason: "already_member" };
  if (!sameIds(currentGroupIds, memberSponsors.map((sponsor) => sponsor.groupId))) {
    return { ok: false, reason: "invalid_participants" };
  }

  const sponsors = [
    ...memberSponsors.map((sponsor) => ({ ...sponsor, role: "participant" })),
    { ...applicant, role: "applicant" },
  ];
  const groups = await loadSponsorGroups(prisma, sponsors);
  if (!groups || groups.some((group) => group.nodeId !== coalition.nodeId)) {
    return { ok: false, reason: "not_eligible" };
  }
  const initiatingGroupId = sponsors.find((sponsor) => sponsor.createdByMembershipId)!.groupId;

  return createCoalitionProposal(prisma, {
    action: "join",
    coalitionId,
    proposedByGroupId: initiatingGroupId,
    targetGroupId: applicant.groupId,
    name: null,
    description: null,
    content,
    currentCoalitionGroupIds: currentGroupIds,
    sponsors,
    groups,
  });
}

export async function openCoalitionDepartureProposal(
  prisma: PrismaClient,
  {
    coalitionId,
    departing,
    content,
  }: {
    coalitionId: string;
    departing: GroupSponsor;
    content: string;
  },
): Promise<OpenCoalitionProposalResult> {
  const coalition = await loadActiveCoalition(prisma, coalitionId);
  if (!coalition) return { ok: false, reason: "not_found" };
  const currentGroupIds = coalition.memberships.map((membership) => membership.groupId).sort();
  if (!currentGroupIds.includes(departing.groupId)) return { ok: false, reason: "not_member" };
  const groups = await loadSponsorGroups(prisma, [departing]);
  if (!groups) return { ok: false, reason: "not_eligible" };

  return createCoalitionProposal(prisma, {
    action: "departure",
    coalitionId,
    proposedByGroupId: departing.groupId,
    targetGroupId: departing.groupId,
    name: null,
    description: null,
    content,
    currentCoalitionGroupIds: currentGroupIds,
    sponsors: [{ ...departing, role: "departing" }],
    groups,
  });
}

export async function openCoalitionRemovalProposal(
  prisma: PrismaClient,
  {
    coalitionId,
    targetGroupId,
    remainingSponsors,
    content,
  }: {
    coalitionId: string;
    targetGroupId: string;
    remainingSponsors: GroupSponsor[];
    content: string;
  },
): Promise<OpenCoalitionProposalResult> {
  const coalition = await loadActiveCoalition(prisma, coalitionId);
  if (!coalition) return { ok: false, reason: "not_found" };
  const currentGroupIds = coalition.memberships.map((membership) => membership.groupId).sort();
  if (!currentGroupIds.includes(targetGroupId)) return { ok: false, reason: "not_member" };
  const expectedRemaining = currentGroupIds.filter((groupId) => groupId !== targetGroupId);
  if (expectedRemaining.length === 0 || !sameIds(expectedRemaining, remainingSponsors.map((sponsor) => sponsor.groupId))) {
    return { ok: false, reason: "invalid_participants" };
  }
  const groups = await loadSponsorGroups(prisma, remainingSponsors);
  if (!groups) return { ok: false, reason: "not_eligible" };
  const initiatingGroupId = remainingSponsors.find((sponsor) => sponsor.createdByMembershipId)!.groupId;

  return createCoalitionProposal(prisma, {
    action: "removal",
    coalitionId,
    proposedByGroupId: initiatingGroupId,
    targetGroupId,
    name: null,
    description: null,
    content,
    currentCoalitionGroupIds: currentGroupIds,
    sponsors: remainingSponsors.map((sponsor) => ({ ...sponsor, role: "remaining_member" })),
    groups,
  });
}

export async function evaluateCoalitionProposal(
  prisma: Prisma.TransactionClient,
  proposalId: string,
): Promise<EvaluateCoalitionProposalResult> {
  const proposal = await prisma.coalitionProposal.findUnique({
    where: { id: proposalId },
    include: {
      petitions: { select: { petitionId: true, groupId: true } },
    },
  });
  if (!proposal) return { outcome: "pending" };
  if (proposal.status !== "open") {
    if (proposal.status === "succeeded" && proposal.coalitionId) {
      return { outcome: "succeeded", coalitionId: proposal.coalitionId };
    }
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" | "failed-timeout" };
  }

  if (proposal.coalitionId && !(await participantSnapshotStillMatches(prisma, proposal.coalitionId, proposal.participantSnapshot))) {
    return failCoalitionProposal(prisma, proposal, "failed-withdrawn");
  }

  const evaluatedAt = new Date();
  await evaluateDuePetitions(prisma, proposal.petitions.map((child) => child.petitionId), evaluatedAt);
  const petitions = await prisma.petition.findMany({
    where: { id: { in: proposal.petitions.map((child) => child.petitionId) } },
    select: { id: true, status: true, closesAt: true },
  });
  if (petitions.length !== proposal.petitions.length) {
    return failCoalitionProposal(prisma, proposal, "failed-withdrawn");
  }
  if (petitions.some((petition) => petition.status === "withdrawn" || petition.status === "superseded")) {
    return failCoalitionProposal(prisma, proposal, "failed-withdrawn");
  }
  if (petitions.some((petition) => petition.status === "rejected" || petition.status === "blocked")) {
    return failCoalitionProposal(prisma, proposal, "failed-rejected");
  }
  if (petitions.some((petition) => petition.status === "open" && petition.closesAt <= evaluatedAt)) {
    return failCoalitionProposal(prisma, proposal, "failed-timeout");
  }
  if (!petitions.every((petition) => petition.status === "approved")) return { outcome: "pending" };

  return applyCoalitionProposal(prisma, proposal);
}

export async function evaluateCoalitionProposalForPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<EvaluateCoalitionProposalResult | null> {
  const child = await prisma.coalitionProposalPetition.findUnique({
    where: { petitionId },
    select: { proposalId: true },
  });
  if (!child) return null;
  return evaluateCoalitionProposal(prisma, child.proposalId);
}

async function createCoalitionProposal(
  prisma: PrismaClient,
  input: {
    action: CoalitionProposalAction;
    coalitionId: string | null;
    proposedByGroupId: string;
    targetGroupId: string | null;
    name: string | null;
    description: string | null;
    content: string;
    currentCoalitionGroupIds: string[];
    sponsors: Array<GroupSponsor & { role: string }>;
    groups: Array<{ id: string; name: string; nodeId: string }>;
  },
): Promise<OpenCoalitionProposalResult> {
  const proposalId = randomUUID();
  const groupIds = input.sponsors.map((sponsor) => sponsor.groupId).sort();
  const participantSnapshot: ParticipantSnapshot = {
    capturedAt: new Date().toISOString(),
    groupIds,
    currentCoalitionGroupIds: [...input.currentCoalitionGroupIds].sort(),
  };
  await prisma.coalitionProposal.create({
    data: {
      id: proposalId,
      coalitionId: input.coalitionId,
      action: input.action,
      proposedByGroupId: input.proposedByGroupId,
      targetGroupId: input.targetGroupId,
      name: input.name,
      description: input.description,
      content: input.content.trim(),
      participantSnapshot,
    },
  });

  const petitionIds: string[] = [];
  const family = familyForAction(input.action);
  try {
    for (const sponsor of input.sponsors) {
      const petition = sponsor.createdByMembershipId
        ? await openPetition(prisma, {
            groupId: sponsor.groupId,
            category: "group_settings",
            subjectType: family,
            subjectId: proposalId,
            createdByMembershipId: sponsor.createdByMembershipId,
          })
        : await openSystemGroupPetition(prisma, {
            groupId: sponsor.groupId,
            category: "group_settings",
            subjectType: family,
            subjectId: proposalId,
          });
      if (!petition.ok) {
        await failOpenProposal(prisma, proposalId, petitionIds);
        return { ok: false, reason: "petition_error" };
      }
      petitionIds.push(petition.petitionId);
      const group = input.groups.find((candidate) => candidate.id === sponsor.groupId)!;
      await prisma.coalitionProposalPetition.create({
        data: {
          proposalId,
          groupId: sponsor.groupId,
          petitionId: petition.petitionId,
          role: sponsor.role,
          groupSnapshot: { id: group.id, name: group.name, nodeId: group.nodeId },
        },
      });
    }
  } catch {
    if (petitionIds.length > 0) {
      await failOpenProposal(prisma, proposalId, petitionIds);
    }
    return { ok: false, reason: "petition_error" };
  }

  return { ok: true, proposalId, petitionIds };
}

async function applyCoalitionProposal(
  prisma: Prisma.TransactionClient,
  proposal: {
    id: string;
    coalitionId: string | null;
    action: string;
    proposedByGroupId: string;
    targetGroupId: string | null;
    name: string | null;
    description: string | null;
    participantSnapshot: unknown;
    petitions: Array<{ petitionId: string; groupId: string }>;
  },
): Promise<EvaluateCoalitionProposalResult> {
  assertWithinTransaction(prisma, "applyCoalitionProposal");
  const snapshot = proposal.participantSnapshot as ParticipantSnapshot;

  if (proposal.action === "formation") {
    const sponsorGroup = await prisma.group.findUniqueOrThrow({
      where: { id: proposal.proposedByGroupId },
      select: { nodeId: true },
    });
    // Advisory lock + pre-check replaces the P2002 catch/recover pattern (Fix 9c):
    // a thrown P2002 inside this transaction would poison it, making recovery impossible.
    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${sponsorGroup.nodeId}:coalition_name:${proposal.name}`}, 0))`;
    const existingCoalition = await prisma.coalition.findFirst({
      where: { nodeId: sponsorGroup.nodeId, name: proposal.name! },
    });
    if (existingCoalition) {
      const updated = await prisma.coalitionProposal.updateMany({
        where: { id: proposal.id, status: "open" },
        data: { status: "failed-withdrawn", resolvedAt: new Date() },
      });
      if (updated.count > 0) {
        await prisma.petition.updateMany({
          where: { id: { in: proposal.petitions.map((p) => p.petitionId) }, status: "open" },
          data: { status: "superseded", resolvedAt: new Date() },
        });
      }
      return { outcome: "failed-withdrawn" as const };
    }
    const coalition = await prisma.coalition.create({
      data: {
        nodeId: sponsorGroup.nodeId,
        name: proposal.name!,
        description: proposal.description,
      },
    });
    await prisma.coalitionMembership.createMany({
      data: snapshot.groupIds.map((groupId) => ({ coalitionId: coalition.id, groupId })),
    });
    await prisma.coalitionProposal.update({
      where: { id: proposal.id },
      data: { coalitionId: coalition.id, status: "succeeded", resolvedAt: new Date() },
    });
    return { outcome: "succeeded" as const, coalitionId: coalition.id };
  }

  if (!proposal.coalitionId || !proposal.targetGroupId) {
    throw new Error("Coalition proposal is missing its coalition or target group.");
  }
  if (proposal.action === "join") {
    await prisma.coalitionMembership.create({
      data: { coalitionId: proposal.coalitionId, groupId: proposal.targetGroupId },
    });
  } else {
    const endedAt = new Date();
    const updated = await prisma.coalitionMembership.updateMany({
      where: { coalitionId: proposal.coalitionId, groupId: proposal.targetGroupId, endedAt: null },
      data: {
        endedAt,
        endReason: proposal.action === "departure" ? "voluntary_departure" : "removed_by_members",
      },
    });
    if (updated.count === 0) {
      await prisma.coalitionProposal.updateMany({
        where: { id: proposal.id, status: "open" },
        data: { status: "failed-withdrawn", resolvedAt: endedAt },
      });
      return { outcome: "failed-withdrawn" as const };
    }
    const remaining = await prisma.coalitionMembership.count({
      where: { coalitionId: proposal.coalitionId, endedAt: null },
    });
    if (remaining === 0) {
      await prisma.coalition.update({
        where: { id: proposal.coalitionId },
        data: { status: "dissolved", dissolvedAt: endedAt },
      });
    }
  }
  await prisma.coalitionProposal.update({
    where: { id: proposal.id },
    data: { status: "succeeded", resolvedAt: new Date() },
  });
  return { outcome: "succeeded" as const, coalitionId: proposal.coalitionId };
}

async function failCoalitionProposal(
  prisma: Prisma.TransactionClient,
  proposal: { id: string; petitions: Array<{ petitionId: string }> },
  status: "failed-rejected" | "failed-withdrawn" | "failed-timeout",
): Promise<EvaluateCoalitionProposalResult> {
  const updated = await prisma.coalitionProposal.updateMany({
    where: { id: proposal.id, status: "open" },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count > 0) {
    await prisma.petition.updateMany({
      where: { id: { in: proposal.petitions.map((child) => child.petitionId) }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  }
  return { outcome: status };
}

async function failOpenProposal(prisma: PrismaClient, proposalId: string, petitionIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.coalitionProposal.update({
      where: { id: proposalId },
      data: { status: "failed-withdrawn", resolvedAt: new Date() },
    }),
    prisma.petition.updateMany({
      where: { id: { in: petitionIds }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    }),
  ]);
}

async function evaluateDuePetitions(prisma: Prisma.TransactionClient, petitionIds: string[], now: Date): Promise<void> {
  const due = await prisma.petition.findMany({
    where: { id: { in: petitionIds }, status: "open", closesAt: { lte: now } },
    select: { id: true },
  });
  for (const petition of due) await evaluatePetition(prisma, petition.id);
}

async function participantSnapshotStillMatches(
  prisma: Prisma.TransactionClient,
  coalitionId: string,
  rawSnapshot: unknown,
): Promise<boolean> {
  const snapshot = rawSnapshot as ParticipantSnapshot;
  const memberships = await prisma.coalitionMembership.findMany({
    where: { coalitionId, endedAt: null },
    select: { groupId: true },
  });
  return sameIds(snapshot.currentCoalitionGroupIds, memberships.map((membership) => membership.groupId));
}

async function loadActiveCoalition(prisma: PrismaClient, coalitionId: string) {
  return prisma.coalition.findFirst({
    where: { id: coalitionId, status: "active" },
    include: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
  });
}

async function loadSponsorGroups(
  prisma: PrismaClient,
  sponsors: GroupSponsor[],
): Promise<Array<{ id: string; name: string; nodeId: string }> | null> {
  const unique = uniqueSponsors(sponsors);
  if (unique.length !== sponsors.length) return null;
  const initiated = sponsors.filter((sponsor) => sponsor.createdByMembershipId);
  if (initiated.length === 0) return null;
  const memberships = await prisma.groupMembership.findMany({
    where: { id: { in: initiated.map((sponsor) => sponsor.createdByMembershipId!) } },
    select: {
      id: true,
      groupId: true,
      status: true,
      participationStatus: true,
      group: { select: { id: true, name: true, nodeId: true } },
    },
  });
  if (memberships.length !== initiated.length) return null;
  const byId = new Map(memberships.map((membership) => [membership.id, membership]));
  for (const sponsor of initiated) {
    const membership = byId.get(sponsor.createdByMembershipId!);
    if (
      !membership ||
      membership.groupId !== sponsor.groupId ||
      membership.status !== "active" ||
      membership.participationStatus !== "active"
    ) {
      return null;
    }
  }
  const groups = await prisma.group.findMany({
    where: { id: { in: sponsors.map((sponsor) => sponsor.groupId) } },
    select: { id: true, name: true, nodeId: true },
  });
  if (groups.length !== sponsors.length) return null;
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return sponsors.map((sponsor) => groupsById.get(sponsor.groupId)!);
}

function familyForAction(action: CoalitionProposalAction): ProposalFamily {
  return `coalition_${action}` as ProposalFamily;
}

function uniqueSponsors(sponsors: GroupSponsor[]): GroupSponsor[] {
  return [...new Map(sponsors.map((sponsor) => [sponsor.groupId, sponsor])).values()];
}

function sameIds(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
