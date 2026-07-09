import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { applyDecision, parseDecisions } from "./federation-consent";
import {
  broadcastCoalitionResolved,
  remoteDecisionKey,
  sendCoalitionProposalOpened,
  REMOTE_DECISION_GRACE_MS,
  type RemoteParticipantRef,
} from "./federated-coalitions";
import { enqueueSignedNodeEvent } from "./federations";
import type { ProposalFamily } from "./governance-proposal-families";
import { evaluatePetition, openPetition, openSystemGroupPetition } from "./petitions";
import {
  countEntityMembers,
  establishEntityBackup,
  isBackupDirective,
  selfNodeForEntity,
} from "./continuity-establishment";
import { resolveWriteAuthority } from "./continuity";
import { assertWithinTransaction } from "./prisma";

export type CoalitionProposalAction = "formation" | "join" | "departure" | "removal" | "backup_designation";

type GroupSponsor = {
  groupId: string;
  createdByMembershipId?: string;
};

type ParticipantSnapshot = {
  capturedAt: string;
  groupIds: string[];
  currentCoalitionGroupIds: string[];
  // Cross-node (F3): remote member groups by home domain + their group id
  // THERE, and the deadline after which silent remote consent times out.
  remoteParticipants?: RemoteParticipantRef[];
  remoteDeadline?: string;
  // F3.5 Phase 5: backup-designation terms — machine-readable so the
  // proposal-level apply and every mirror render the SAME peer/W/directive
  // the members consented to.
  backupTerms?: { peerNodeId: string; peerDomain: string; windowHours: number; directive: string };
};

export type CoalitionBackupTerms = NonNullable<ParticipantSnapshot["backupTerms"]>;

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
    remoteParticipants = [],
  }: {
    name: string;
    description?: string | null;
    content: string;
    participants: GroupSponsor[];
    // Cross-node members (F3): this node becomes the coalition's home (the
    // proposing group's node hosts — plan §5). Each remote group's own node
    // opens its petition; the act is the consent (F-2, A3).
    remoteParticipants?: RemoteParticipantRef[];
  },
): Promise<OpenCoalitionProposalResult> {
  const normalizedName = name.trim();
  const uniqueParticipants = uniqueSponsors(participants);
  const uniqueRemotes = [
    ...new Map(remoteParticipants.map((remote) => [`${remote.domain}:${remote.remoteGroupId}`, remote])).values(),
  ];
  const totalParticipants = uniqueParticipants.length + uniqueRemotes.length;
  if (
    !normalizedName ||
    totalParticipants < 2 ||
    uniqueParticipants.length < 1 ||
    uniqueParticipants.length !== participants.length ||
    uniqueRemotes.length !== remoteParticipants.length
  ) {
    return { ok: false, reason: "invalid_participants" };
  }
  // Every remote participant's home must hold an ACTIVE agreement with this
  // node (A4: the hub agreements are the coalition's transport).
  for (const remote of uniqueRemotes) {
    const peer = await prisma.federatedNode.findUnique({ where: { domain: remote.domain }, select: { status: true } });
    if (!peer || peer.status !== "active" || !remote.remoteGroupId.trim() || !remote.name.trim()) {
      return { ok: false, reason: "invalid_participants" };
    }
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
    remoteParticipants: uniqueRemotes,
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
  // Join on a coalition with REMOTE members needs every member's consent,
  // including remote ones — multilateral cross-node changes are deferred
  // (pairwise-first). Refuse rather than silently skip remote consent.
  if (coalition.memberships.some((membership) => membership.groupId === null)) {
    return { ok: false, reason: "invalid_participants" };
  }
  const currentGroupIds = localMemberGroupIds(coalition.memberships);
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
  // Departure is unilateral, so a LOCAL group may leave a mixed coalition;
  // the snapshot tracks local members only (matcher filters likewise).
  const currentGroupIds = localMemberGroupIds(coalition.memberships);
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
  // Removal on a mixed coalition: deferred with join (see above).
  if (coalition.memberships.some((membership) => membership.groupId === null)) {
    return { ok: false, reason: "invalid_participants" };
  }
  const currentGroupIds = localMemberGroupIds(coalition.memberships);
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

  // MEMBER side of a cross-node coalition: this node only decides its own
  // groups' petitions and reports each decision to the home; the home's
  // signed coalition_resolved event finalizes the mirror.
  if (proposal.homeNodeDomain) {
    return evaluateMemberSideProposal(prisma, proposal);
  }
  // Continuity gate (register F-9, Phase 5): membership changes and every
  // other coalition-level decision hold while the coalition's lease is not
  // writable — pending, never failed. Covers the petition hook AND the
  // expiry sweep (both funnel through this evaluator). Formation has no
  // coalition yet, so it is writable by construction (no EntityBackup row).
  if (proposal.coalitionId) {
    const authority = await resolveWriteAuthority(prisma, { entityType: "coalition", entityId: proposal.coalitionId });
    if (authority !== "writable") return { outcome: "pending" };
  }
  const crossNodeSnapshot = proposal.participantSnapshot as ParticipantSnapshot;
  const remoteParticipants = crossNodeSnapshot.remoteParticipants ?? [];
  if (remoteParticipants.length > 0) {
    // Serialize with the inbound decision handler (read-modify-write on the
    // decisions map); re-entrant within its transaction.
    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coalition_proposal:${proposal.id}`}, 0))`;
    // Any remote rejection fails the whole formation IMMEDIATELY — before the
    // local gates, which would otherwise return "pending" while local
    // petitions are still open (the unanimity short-circuit, as in
    // combineDecisions).
    const earlyDecisions = parseDecisions(proposal.decisions);
    const rejected = remoteParticipants.some(
      (remote) => earlyDecisions[remoteDecisionKey(remote.domain, remote.remoteGroupId)] === "rejected",
    );
    if (rejected) return failCoalitionProposal(prisma, proposal, "failed-rejected");
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

  // Home-side remote-consent gate (F3): every remote group's decision must be
  // approved; any rejection fails the whole formation; silence times out at
  // the snapshot deadline. Mirrors the federation unanimity ladder.
  if (remoteParticipants.length > 0) {
    const decisions = parseDecisions(proposal.decisions);
    const keys = remoteParticipants.map((remote) => remoteDecisionKey(remote.domain, remote.remoteGroupId));
    if (keys.some((key) => decisions[key] === "rejected")) {
      return failCoalitionProposal(prisma, proposal, "failed-rejected");
    }
    if (!keys.every((key) => decisions[key] === "approved")) {
      if (crossNodeSnapshot.remoteDeadline && evaluatedAt > new Date(crossNodeSnapshot.remoteDeadline)) {
        return failCoalitionProposal(prisma, proposal, "failed-timeout");
      }
      return { outcome: "pending" };
    }
  }

  return applyCoalitionProposal(prisma, proposal);
}

// Member-side mirror evaluation: fold each local petition's fate into the
// decisions map, emit one signed decision per group (monotonic — a slot
// already terminal never re-emits), and fail the mirror locally on any
// rejection or on deadline.
async function evaluateMemberSideProposal(
  prisma: Prisma.TransactionClient,
  proposal: {
    id: string;
    homeNodeDomain: string | null;
    decisions: unknown;
    participantSnapshot: unknown;
    petitions: Array<{ petitionId: string; groupId: string }>;
  },
): Promise<EvaluateCoalitionProposalResult> {
  const evaluatedAt = new Date();
  await evaluateDuePetitions(prisma, proposal.petitions.map((child) => child.petitionId), evaluatedAt);
  const petitions = await prisma.petition.findMany({
    where: { id: { in: proposal.petitions.map((child) => child.petitionId) } },
    select: { id: true, status: true, closesAt: true },
  });
  const petitionByGroup = new Map(proposal.petitions.map((child) => [child.groupId, child.petitionId]));
  const statusById = new Map(petitions.map((petition) => [petition.id, petition]));

  const selfNode = await selfNodeForLocalGroup(prisma, proposal.petitions[0]?.groupId);
  if (!selfNode) return { outcome: "pending" };

  let decisions = parseDecisions(proposal.decisions);
  let anyRejected = false;
  for (const [groupId, petitionId] of petitionByGroup) {
    const petition = statusById.get(petitionId);
    if (!petition) continue;
    let outcome: "approved" | "rejected" | null = null;
    if (petition.status === "approved") outcome = "approved";
    else if (petition.status === "rejected" || petition.status === "blocked") outcome = "rejected";
    else if (petition.status === "withdrawn" || petition.status === "superseded") outcome = "rejected";
    else if (petition.status === "open" && petition.closesAt <= evaluatedAt) outcome = "rejected";
    if (!outcome) continue;
    const key = remoteDecisionKey(selfNode.domain, groupId);
    const updated = applyDecision(decisions, key, outcome);
    if (updated) {
      decisions = updated;
      await prisma.coalitionProposal.update({ where: { id: proposal.id }, data: { decisions } });
      await enqueueSignedNodeEvent(
        prisma,
        selfNode,
        proposal.homeNodeDomain!,
        "coalition_proposal_decision",
        { proposalId: proposal.id, domain: selfNode.domain, remoteGroupId: groupId, outcome },
        "coalition_coordination",
      );
      if (outcome === "rejected") anyRejected = true;
    }
  }
  if (anyRejected) return failCoalitionProposal(prisma, proposal, "failed-rejected");

  const snapshot = proposal.participantSnapshot as ParticipantSnapshot;
  if (snapshot.remoteDeadline && evaluatedAt > new Date(snapshot.remoteDeadline)) {
    // The home never resolved us: fail the mirror rather than dangle forever.
    return failCoalitionProposal(prisma, proposal, "failed-timeout");
  }
  return { outcome: "pending" };
}

async function selfNodeForLocalGroup(
  prisma: Prisma.TransactionClient,
  groupId: string | undefined,
): Promise<{ id: string; domain: string } | null> {
  if (!groupId) return null;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { node: { select: { id: true, domain: true } } },
  });
  return group?.node ?? null;
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

// ── F3.5 Phase 5: coalition backup designation (a coalition decision) ───────
//
// Membership in a coalition is not tiered by where a group's data happens to
// live (register F-8): EVERY member group consents through its own node's
// governance — local groups by petition here, remote groups by mirrored
// petitions on their own nodes reported through the decisions map — exactly
// as formation does. The peer CHOICE is part of what members consent to,
// which also collects, pre-disaster, the consent reconstitution stands on.
//
// Calm-weather property (stated in the UI and the guide): full-member
// consent means a coalition can only arrange its disaster protection while
// ALL its member nodes are healthy — a proposal with an unreachable member
// times out. Designate early, in calm weather.

export type OpenCoalitionBackupResult =
  | OpenCoalitionProposalResult
  | {
      ok: false;
      reason:
        | "invalid_window"
        | "invalid_directive"
        | "no_active_agreement"
        | "backup_already_exists"
        | "proposal_already_open";
    };

export async function openCoalitionBackupDesignationProposal(
  prisma: PrismaClient,
  {
    coalitionId,
    peerNodeId,
    windowHours,
    directive,
    createdByMembershipId,
  }: {
    coalitionId: string;
    peerNodeId: string;
    windowHours: number;
    directive: string;
    createdByMembershipId: string;
  },
): Promise<OpenCoalitionBackupResult> {
  const coalition = await prisma.coalition.findUnique({
    where: { id: coalitionId },
    include: {
      memberships: {
        where: { endedAt: null },
        include: {
          group: { select: { id: true, name: true, nodeId: true } },
          federatedGroupPresence: {
            select: { remoteGroupId: true, name: true, federatedNode: { select: { domain: true, status: true } } },
          },
        },
      },
    },
  });
  if (!coalition || coalition.status !== "active") return { ok: false, reason: "not_found" };
  if (!Number.isInteger(windowHours) || windowHours < 1) return { ok: false, reason: "invalid_window" };
  if (!isBackupDirective(directive)) return { ok: false, reason: "invalid_directive" };

  const peer = await prisma.federatedNode.findUnique({
    where: { id: peerNodeId },
    select: { id: true, domain: true, status: true },
  });
  if (!peer || peer.status !== "active") return { ok: false, reason: "no_active_agreement" };

  const existing = await prisma.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: "coalition", entityId: coalitionId } },
    select: { status: true },
  });
  if (existing && (existing.status === "proposed" || existing.status === "active")) {
    return { ok: false, reason: "backup_already_exists" };
  }
  // Single-open backed by the DB partial index (register F-7); this check is
  // legibility, the index is the invariant.
  const openProposal = await prisma.coalitionProposal.findFirst({
    where: { coalitionId, action: "backup_designation", status: "open" },
    select: { id: true },
  });
  if (openProposal) return { ok: false, reason: "proposal_already_open" };

  const localGroups = coalition.memberships.flatMap((membership) => (membership.group ? [membership.group] : []));
  const remoteParticipants: RemoteParticipantRef[] = coalition.memberships.flatMap((membership) =>
    membership.federatedGroupPresence && membership.federatedGroupPresence.federatedNode.status === "active"
      ? [
          {
            domain: membership.federatedGroupPresence.federatedNode.domain,
            remoteGroupId: membership.federatedGroupPresence.remoteGroupId,
            name: membership.federatedGroupPresence.name,
          },
        ]
      : [],
  );
  if (localGroups.length === 0) return { ok: false, reason: "not_eligible" };
  // A remote member whose federation agreement lapsed cannot be consulted —
  // the proposal must not silently drop their consent.
  const remoteMemberCount = coalition.memberships.filter((m) => m.federatedGroupPresence).length;
  if (remoteParticipants.length !== remoteMemberCount) return { ok: false, reason: "no_active_agreement" };

  const initiator = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (
    !initiator ||
    initiator.status !== "active" ||
    initiator.participationStatus !== "active" ||
    !localGroups.some((group) => group.id === initiator.groupId)
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  return createCoalitionProposal(prisma, {
    action: "backup_designation",
    coalitionId,
    proposedByGroupId: initiator.groupId,
    targetGroupId: null,
    name: coalition.name,
    description: null,
    content: `Designate ${peer.domain} as the backup for coalition "${coalition.name}" (failover window ${windowHours}h, directive "${directive}"). The replica holds the coalition's home-side skeleton and relay thread only — never member collectives' own data.`,
    currentCoalitionGroupIds: localGroups.map((group) => group.id),
    sponsors: localGroups.map((group) => ({
      groupId: group.id,
      role: "participant",
      ...(group.id === initiator.groupId ? { createdByMembershipId } : {}),
    })),
    groups: localGroups,
    remoteParticipants,
    backupTerms: { peerNodeId: peer.id, peerDomain: peer.domain, windowHours, directive },
  });
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
    remoteParticipants?: RemoteParticipantRef[];
    backupTerms?: CoalitionBackupTerms;
  },
): Promise<OpenCoalitionProposalResult> {
  const proposalId = randomUUID();
  const groupIds = input.sponsors.map((sponsor) => sponsor.groupId).sort();
  const remoteParticipants = input.remoteParticipants ?? [];
  const participantSnapshot: ParticipantSnapshot = {
    capturedAt: new Date().toISOString(),
    groupIds,
    currentCoalitionGroupIds: [...input.currentCoalitionGroupIds].sort(),
    ...(remoteParticipants.length > 0 ? { remoteParticipants } : {}),
    ...(input.backupTerms ? { backupTerms: input.backupTerms } : {}),
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
      // Pre-seeded pending slots: applyDecision is deliberately
      // snapshot-scoped (federation-consent) — a decision for an unknown key
      // is ignored, so every expected participant must start as pending.
      ...(remoteParticipants.length > 0
        ? {
            decisions: Object.fromEntries(
              remoteParticipants.map((remote) => [remoteDecisionKey(remote.domain, remote.remoteGroupId), "pending"]),
            ),
          }
        : {}),
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

  if (remoteParticipants.length > 0) {
    // The shared deadline: every local petition has closed by then; remote
    // silence past it fails the formation (sweep + evaluate both check it).
    const petitions = await prisma.petition.findMany({
      where: { id: { in: petitionIds } },
      select: { closesAt: true },
    });
    const remoteDeadline = new Date(
      Math.max(...petitions.map((petition) => petition.closesAt.getTime())) + REMOTE_DECISION_GRACE_MS,
    );
    await prisma.coalitionProposal.update({
      where: { id: proposalId },
      data: { participantSnapshot: { ...participantSnapshot, remoteDeadline: remoteDeadline.toISOString() } },
    });
    const selfNode = await prisma.node.findUniqueOrThrow({
      where: { id: input.groups[0].nodeId },
      select: { id: true, domain: true },
    });
    const delivered = await sendCoalitionProposalOpened(prisma, selfNode, {
      proposalId,
      action: input.action,
      coalitionId: input.coalitionId,
      backupTerms: input.backupTerms ?? null,
      name: input.name,
      content: input.content.trim(),
      participantLabels: [
        ...input.groups.map((group) => group.name),
        ...remoteParticipants.map((remote) => `${remote.name} @ ${remote.domain}`),
      ],
      remoteParticipants,
      closesAt: remoteDeadline,
    });
    if (!delivered) {
      await failOpenProposal(prisma, proposalId, petitionIds);
      return { ok: false, reason: "petition_error" };
    }
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
    // Remote members: presence-backed rows (the XOR's other arm). Presence
    // name is the disclosure the remote group consented to by joining (A3).
    const remoteParticipants = snapshot.remoteParticipants ?? [];
    for (const remote of remoteParticipants) {
      const peer = await prisma.federatedNode.findUniqueOrThrow({ where: { domain: remote.domain } });
      const presence = await prisma.federatedGroupPresence.upsert({
        where: { federatedNodeId_remoteGroupId: { federatedNodeId: peer.id, remoteGroupId: remote.remoteGroupId } },
        update: { name: remote.name, status: "active", lastSyncedAt: new Date() },
        create: { federatedNodeId: peer.id, remoteGroupId: remote.remoteGroupId, name: remote.name },
      });
      await prisma.coalitionMembership.create({
        data: { coalitionId: coalition.id, federatedGroupPresenceId: presence.id },
      });
    }
    await prisma.coalitionProposal.update({
      where: { id: proposal.id },
      data: { coalitionId: coalition.id, status: "succeeded", resolvedAt: new Date() },
    });
    if (remoteParticipants.length > 0) {
      const selfNode = await prisma.node.findUniqueOrThrow({
        where: { id: sponsorGroup.nodeId },
        select: { id: true, domain: true },
      });
      await broadcastCoalitionResolved(prisma, selfNode, {
        proposalId: proposal.id,
        outcome: "succeeded",
        remoteParticipants,
        coalition: { id: coalition.id, name: coalition.name },
      });
    }
    return { outcome: "succeeded" as const, coalitionId: coalition.id };
  }

  if (proposal.action === "backup_designation") {
    if (!proposal.coalitionId || !snapshot.backupTerms) {
      return failCoalitionProposal(prisma, proposal, "failed-withdrawn");
    }
    const terms = snapshot.backupTerms;
    // Staleness re-checks at apply time: coalition still active, channel
    // still open, no backup raced in.
    const coalition = await prisma.coalition.findUnique({
      where: { id: proposal.coalitionId },
      select: { id: true, name: true, status: true },
    });
    const peer = await prisma.federatedNode.findUnique({
      where: { id: terms.peerNodeId },
      select: { id: true, domain: true, status: true },
    });
    const selfNode = await selfNodeForEntity(prisma, "coalition", proposal.coalitionId);
    if (
      !coalition ||
      coalition.status !== "active" ||
      !peer ||
      peer.status !== "active" ||
      !selfNode ||
      !isBackupDirective(terms.directive)
    ) {
      return failCoalitionProposal(prisma, proposal, "failed-withdrawn");
    }
    await establishEntityBackup(prisma, {
      entityType: "coalition",
      entityId: coalition.id,
      entityName: coalition.name,
      memberCount: await countEntityMembers(prisma, "coalition", coalition.id),
      peerId: peer.id,
      peerDomain: peer.domain,
      selfNode,
      windowHours: terms.windowHours,
      directive: terms.directive,
    });
    await prisma.coalitionProposal.update({
      where: { id: proposal.id },
      data: { status: "succeeded", resolvedAt: new Date() },
    });
    const remoteParticipants = snapshot.remoteParticipants ?? [];
    if (remoteParticipants.length > 0) {
      await broadcastCoalitionResolved(prisma, selfNode, {
        proposalId: proposal.id,
        outcome: "succeeded",
        remoteParticipants,
        coalition: { id: coalition.id, name: coalition.name },
      });
    }
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
  proposal: {
    id: string;
    petitions: Array<{ petitionId: string; groupId?: string }>;
    participantSnapshot?: unknown;
    homeNodeDomain?: string | null;
  },
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
    // Cross-node HOME failure: tell every member node once (guarded by the
    // updateMany count, so redelivered evaluations cannot double-emit).
    const snapshot = (proposal.participantSnapshot ?? {}) as ParticipantSnapshot;
    const remoteParticipants = snapshot.remoteParticipants ?? [];
    if ((proposal.homeNodeDomain ?? null) === null && remoteParticipants.length > 0) {
      const firstGroupId = proposal.petitions.find((child) => child.groupId)?.groupId;
      const selfNode = await selfNodeForLocalGroup(prisma, firstGroupId);
      if (selfNode) {
        await broadcastCoalitionResolved(prisma, selfNode, {
          proposalId: proposal.id,
          outcome: status,
          remoteParticipants,
          coalition: null,
        });
      }
    }
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
  // Snapshots capture LOCAL member groups; compare against locals only.
  return sameIds(snapshot.currentCoalitionGroupIds, localMemberGroupIds(memberships));
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

function localMemberGroupIds(memberships: Array<{ groupId: string | null }>): string[] {
  return memberships.flatMap((membership) => (membership.groupId ? [membership.groupId] : [])).sort();
}

function sameIds(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
