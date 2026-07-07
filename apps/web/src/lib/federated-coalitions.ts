import { Prisma, type FederatedNode, type Node, type PrismaClient } from "../generated/prisma/client";
import { applyDecision, parseDecisions, type FederationDecisionOutcome } from "./federation-consent";
import type { FederationEnvelope } from "./federation-envelope";
import { enqueueSignedNodeEvent } from "./federations";
import { mediateRemoteAction, type MediateRemoteActionResult } from "./federation-actions";
import { openSystemGroupPetition } from "./petitions";

// Cross-node coalitions (F3(2), plan §5): the coalition lives on ONE home
// node (the proposing group's node); member groups elsewhere hold presences.
// Topology is hub, not mesh (A4): each member node needs an agreement with
// the HOME node only; the home relays coordination content, and the D-3
// chokepoint gates every relay leg against the home-node agreement. Member
// nodes trust the home as relay for coordination-class content.
//
// All coalition wire events carry dataClass "coalition_coordination"
// (active-agreement tier): a coalition with remote members can neither form
// nor coordinate except across live agreements.

export type RemoteParticipantRef = { domain: string; remoteGroupId: string; name: string };

const COALITION_DATA_CLASS = "coalition_coordination" as const;
export const REMOTE_DECISION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function remoteDecisionKey(domain: string, remoteGroupId: string): string {
  return `${domain}:${remoteGroupId}`;
}

// ── Home side: outbound governance events ────────────────────────────────────

export async function sendCoalitionProposalOpened(
  client: Prisma.TransactionClient | PrismaClient,
  selfNode: { id: string; domain: string },
  input: {
    proposalId: string;
    name: string | null;
    content: string;
    participantLabels: string[];
    remoteParticipants: RemoteParticipantRef[];
    closesAt: Date;
  },
): Promise<boolean> {
  const byDomain = new Map<string, RemoteParticipantRef[]>();
  for (const participant of input.remoteParticipants) {
    byDomain.set(participant.domain, [...(byDomain.get(participant.domain) ?? []), participant]);
  }
  for (const [domain, participants] of byDomain) {
    const delivered = await enqueueSignedNodeEvent(
      client,
      selfNode,
      domain,
      "coalition_proposal_opened",
      {
        proposalId: input.proposalId,
        action: "formation",
        name: input.name,
        content: input.content,
        homeDomain: selfNode.domain,
        participantLabels: input.participantLabels,
        remoteGroupIds: participants.map((participant) => participant.remoteGroupId),
        closesAt: input.closesAt.toISOString(),
      },
      COALITION_DATA_CLASS,
    );
    if (!delivered) return false;
  }
  return true;
}

export async function broadcastCoalitionResolved(
  tx: Prisma.TransactionClient,
  selfNode: { id: string; domain: string },
  input: {
    proposalId: string;
    outcome: "succeeded" | "failed-rejected" | "failed-withdrawn" | "failed-timeout";
    remoteParticipants: RemoteParticipantRef[];
    coalition: { id: string; name: string } | null;
  },
): Promise<void> {
  for (const domain of new Set(input.remoteParticipants.map((participant) => participant.domain))) {
    await enqueueSignedNodeEvent(
      tx,
      selfNode,
      domain,
      "coalition_resolved",
      { proposalId: input.proposalId, outcome: input.outcome, coalition: input.coalition },
      COALITION_DATA_CLASS,
    );
  }
}

// The relay itself (A4): one message, one enqueue per remote member node,
// each leg through the D-3 chokepoint against the HOME's agreement with that
// node. B's content reaches C via the home without any B↔C agreement.
export async function broadcastCoalitionMessage(
  client: Prisma.TransactionClient | PrismaClient,
  selfNode: { id: string; domain: string },
  input: {
    coalitionId: string;
    messageId: string;
    originDomain: string;
    authorLabel: string;
    body: string;
    postedAt: Date;
  },
): Promise<void> {
  const remoteMembers = await client.coalitionMembership.findMany({
    where: { coalitionId: input.coalitionId, endedAt: null, federatedGroupPresenceId: { not: null } },
    select: { federatedGroupPresence: { select: { federatedNode: { select: { domain: true } } } } },
  });
  const domains = new Set(
    remoteMembers
      .map((membership) => membership.federatedGroupPresence?.federatedNode.domain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  for (const domain of domains) {
    await enqueueSignedNodeEvent(
      client,
      selfNode,
      domain,
      "coalition_content_appended",
      {
        coalitionId: input.coalitionId,
        remoteMessageId: input.messageId,
        originDomain: input.originDomain,
        authorLabel: input.authorLabel,
        body: input.body,
        postedAt: input.postedAt.toISOString(),
      },
      COALITION_DATA_CLASS,
    );
  }
}

// ── Member side: posting into a remote-homed coalition ───────────────────────

// Routed write (plan §5): the member verifies THEIR OWN standing locally
// (active membership in the presence's group), then the home node applies it
// through its own checks. The member's node vouches for the group-membership
// assertion by signing the envelope — that is Pattern 1's trust shape.
export async function postFederatedCoalitionMessage(
  prisma: PrismaClient,
  { accountId, presenceId, body }: { accountId: string; presenceId: string; body: string },
): Promise<MediateRemoteActionResult | { ok: false; reason: "not_found" | "not_a_member" | "empty_body" }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "empty_body" };
  const presence = await prisma.federatedCoalitionPresence.findUnique({
    where: { id: presenceId },
    include: { homeFederatedNode: { select: { domain: true } } },
  });
  if (!presence || presence.status !== "active") return { ok: false, reason: "not_found" };
  const membership = await prisma.groupMembership.findFirst({
    where: { accountId, groupId: presence.groupId, status: "active", participationStatus: "active" },
    select: { id: true },
  });
  if (!membership) return { ok: false, reason: "not_a_member" };

  return mediateRemoteAction(prisma, {
    accountId,
    peerDomain: presence.homeFederatedNode.domain,
    actionType: "coalition_post_message",
    action: { coalitionId: presence.coalitionId, viaRemoteGroupId: presence.groupId, body: trimmed },
  });
}

// ── Inbox handlers ────────────────────────────────────────────────────────────

type HandlerResult = { ok: true } | { ok: false; reason: string };
type HandlerContext = { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null };

// Member side: the home node proposes a coalition naming groups on THIS node.
// The petition IS the consent (F-2: a deliberate act needs no prior grant) —
// each named group decides through its own system-opened petition.
export const handleCoalitionProposalOpened = async (
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: HandlerContext,
): Promise<HandlerResult> => {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const proposalId = typeof p.proposalId === "string" ? p.proposalId : null;
  const content = typeof p.content === "string" ? p.content : "";
  const name = typeof p.name === "string" ? p.name : null;
  const homeDomain = typeof p.homeDomain === "string" ? p.homeDomain : null;
  const remoteGroupIds = Array.isArray(p.remoteGroupIds)
    ? p.remoteGroupIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!proposalId || !homeDomain || remoteGroupIds.length === 0) {
    return { ok: false, reason: "malformed_payload" };
  }
  if (homeDomain !== origin.domain) return { ok: false, reason: "home_spoof" };
  if (p.action !== "formation") return { ok: false, reason: "unsupported_action" };

  const existing = await tx.coalitionProposal.findUnique({ where: { id: proposalId }, select: { id: true } });
  if (existing) return { ok: true };

  const groups = await tx.group.findMany({
    where: { id: { in: remoteGroupIds }, nodeId: localNode.id, archivedAt: null },
    select: { id: true, name: true, nodeId: true },
  });
  if (groups.length !== remoteGroupIds.length) return { ok: false, reason: "group_not_found" };

  await tx.coalitionProposal.create({
    data: {
      id: proposalId,
      action: "formation",
      proposedByGroupId: groups[0].id,
      name,
      content,
      homeNodeDomain: origin.domain,
      participantSnapshot: {
        capturedAt: new Date().toISOString(),
        groupIds: remoteGroupIds.sort(),
        currentCoalitionGroupIds: [],
        participantLabels: Array.isArray(p.participantLabels) ? p.participantLabels : [],
        // The home's deadline bounds the mirror too: if the home never
        // resolves us, the sweep fails the mirror past this point.
        remoteDeadline: new Date(
          (typeof p.closesAt === "string" ? new Date(p.closesAt).getTime() : Date.now()) + REMOTE_DECISION_GRACE_MS,
        ).toISOString(),
      },
      // Pre-seeded pending slots for OUR groups (applyDecision is
      // snapshot-scoped; see the home-side note in coalitions.ts).
      decisions: Object.fromEntries(
        remoteGroupIds.map((groupId) => [remoteDecisionKey(localNode.domain, groupId), "pending"]),
      ),
    },
  });
  for (const group of groups) {
    const petition = await openSystemGroupPetition(tx, {
      groupId: group.id,
      category: "group_settings",
      subjectType: "coalition_formation",
      subjectId: proposalId,
    });
    if (!petition.ok) {
      // Permanent local refusal: tell the home this group cannot decide.
      await enqueueSignedNodeEvent(tx, localNode, origin.domain, "coalition_proposal_decision", {
        proposalId,
        domain: localNode.domain,
        remoteGroupId: group.id,
        outcome: "rejected",
      }, COALITION_DATA_CLASS);
      continue;
    }
    await tx.coalitionProposalPetition.create({
      data: {
        proposalId,
        groupId: group.id,
        petitionId: petition.petitionId,
        role: "participant",
        groupSnapshot: { id: group.id, name: group.name, nodeId: group.nodeId },
      },
    });
  }
  return { ok: true };
};

// Home side: a member node reports one of its groups' decisions. Monotonic +
// idempotent per (domain, group); the sender speaks only for itself.
export const handleCoalitionProposalDecision = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const proposalId = typeof p.proposalId === "string" ? p.proposalId : null;
  const domain = typeof p.domain === "string" ? p.domain : null;
  const remoteGroupId = typeof p.remoteGroupId === "string" ? p.remoteGroupId : null;
  const outcome = p.outcome === "approved" || p.outcome === "rejected" ? p.outcome : null;
  if (!proposalId || !domain || !remoteGroupId || !outcome) return { ok: false, reason: "malformed_payload" };
  if (domain !== origin.domain) return { ok: false, reason: "decision_spoof" };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coalition_proposal:${proposalId}`}, 0))`;
  const proposal = await tx.coalitionProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, homeNodeDomain: true, decisions: true, status: true },
  });
  if (!proposal) throw new Error(`coalition proposal ${proposalId} not yet known`); // transient: retry
  if (proposal.homeNodeDomain !== null) return { ok: false, reason: "not_the_home" };
  if (proposal.status === "open") {
    const decisions = parseDecisions(proposal.decisions);
    const updated = applyDecision(decisions, remoteDecisionKey(domain, remoteGroupId), outcome as FederationDecisionOutcome);
    if (updated) {
      await tx.coalitionProposal.update({ where: { id: proposalId }, data: { decisions: updated } });
    }
  }
  const { evaluateCoalitionProposal } = await import("./coalitions");
  await evaluateCoalitionProposal(tx, proposalId);
  return { ok: true };
};

// Member side: the home announces the proposal's terminal outcome.
export const handleCoalitionResolved = async (
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: HandlerContext,
): Promise<HandlerResult> => {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const proposalId = typeof p.proposalId === "string" ? p.proposalId : null;
  const outcome = typeof p.outcome === "string" ? p.outcome : null;
  const coalition =
    typeof p.coalition === "object" && p.coalition !== null
      ? (p.coalition as { id?: unknown; name?: unknown })
      : null;
  if (!proposalId || !outcome) return { ok: false, reason: "malformed_payload" };

  const proposal = await tx.coalitionProposal.findUnique({
    where: { id: proposalId },
    include: { petitions: { select: { petitionId: true, groupId: true } } },
  });
  if (!proposal) return { ok: true }; // never mirrored (e.g. we rejected at open): nothing to finalize
  if (proposal.homeNodeDomain !== origin.domain) return { ok: false, reason: "not_your_proposal" };
  if (proposal.status !== "open") return { ok: true }; // already terminal locally

  if (outcome === "succeeded" && typeof coalition?.id === "string" && typeof coalition?.name === "string") {
    await tx.coalitionProposal.update({
      where: { id: proposalId },
      data: { status: "succeeded", resolvedAt: new Date() },
    });
    for (const petition of proposal.petitions) {
      await tx.federatedCoalitionPresence.upsert({
        where: { coalitionId_groupId: { coalitionId: coalition.id, groupId: petition.groupId } },
        update: { status: "active", name: coalition.name },
        create: {
          coalitionId: coalition.id,
          homeFederatedNodeId: origin.id,
          groupId: petition.groupId,
          name: coalition.name,
        },
      });
    }
    return { ok: true };
  }

  const failed = outcome.startsWith("failed-") ? outcome : "failed-withdrawn";
  await tx.coalitionProposal.update({
    where: { id: proposalId },
    data: { status: failed, resolvedAt: new Date() },
  });
  await tx.petition.updateMany({
    where: { id: { in: proposal.petitions.map((petition) => petition.petitionId) }, status: "open" },
    data: { status: "superseded", resolvedAt: new Date() },
  });
  return { ok: true };
};

// Member side: cache relayed coordination content (aggregated reads are
// local-cache reads). Only the coalition's HOME may relay into the cache.
export const handleCoalitionContentAppended = async (
  tx: Prisma.TransactionClient,
  { origin, envelope }: HandlerContext,
): Promise<HandlerResult> => {
  const p = envelope.payload as Record<string, unknown>;
  const coalitionId = typeof p.coalitionId === "string" ? p.coalitionId : null;
  const remoteMessageId = typeof p.remoteMessageId === "string" ? p.remoteMessageId : null;
  const originDomain = typeof p.originDomain === "string" ? p.originDomain : null;
  const authorLabel = typeof p.authorLabel === "string" ? p.authorLabel : "unknown";
  const body = typeof p.body === "string" ? p.body : null;
  const postedAt = typeof p.postedAt === "string" ? new Date(p.postedAt) : null;
  if (!coalitionId || !remoteMessageId || !originDomain || !body || !postedAt || Number.isNaN(postedAt.getTime())) {
    return { ok: false, reason: "malformed_payload" };
  }

  const presences = await tx.federatedCoalitionPresence.findMany({
    where: { coalitionId, status: "active", homeFederatedNode: { domain: origin.domain } },
    select: { id: true },
  });
  if (presences.length === 0) return { ok: false, reason: "unknown_coalition" };

  for (const presence of presences) {
    const exists = await tx.federatedCoalitionMessage.findUnique({
      where: { presenceId_remoteMessageId: { presenceId: presence.id, remoteMessageId } },
      select: { id: true },
    });
    if (!exists) {
      await tx.federatedCoalitionMessage.create({
        data: { presenceId: presence.id, remoteMessageId, originDomain, authorLabel, body, postedAt },
      });
    }
  }
  return { ok: true };
};

// ── Timeout sweep (rides the federation instrumentation tick) ────────────────

// Home side: all local petitions may approve while a member node stays
// silent; only a clock finishes those. Member side: a home that vanishes
// after our approval leaves the mirror open; fail it past its deadline.
export async function resolveExpiredCrossNodeCoalitionProposals(
  prisma: PrismaClient,
): Promise<{ attempted: number; resolved: number }> {
  const now = new Date();
  const open = await prisma.coalitionProposal.findMany({
    where: { status: "open", OR: [{ homeNodeDomain: { not: null } }, { decisions: { not: Prisma.DbNull } }] },
    select: { id: true, homeNodeDomain: true, participantSnapshot: true },
  });
  let attempted = 0;
  let resolved = 0;
  const { evaluateCoalitionProposal } = await import("./coalitions");
  for (const proposal of open) {
    const snapshot = proposal.participantSnapshot as { remoteDeadline?: string } | null;
    const deadline = snapshot?.remoteDeadline ? new Date(snapshot.remoteDeadline) : null;
    if (!deadline || deadline > now) continue;
    attempted += 1;
    try {
      const outcome = await prisma.$transaction((tx) => evaluateCoalitionProposal(tx, proposal.id));
      if (outcome.outcome !== "pending") resolved += 1;
    } catch (err) {
      console.error(`[federation] cross-node coalition proposal ${proposal.id} evaluation failed`, err);
    }
  }
  return { attempted, resolved };
}
