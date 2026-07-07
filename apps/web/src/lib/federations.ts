import { randomUUID } from "node:crypto";
import type { FederationProposal, Prisma, PrismaClient } from "../generated/prisma/client";
import {
  applyDecision,
  combineDecisions,
  initialDecisions,
  parseDecisions,
  type FederationDecisionOutcome,
  type FederationDecisionsMap,
} from "./federation-consent";
import { createFederationEnvelope } from "./federation-envelope";
import { enqueueFederationEvent } from "./federation-outbox";
import { getPeerByDomain } from "./federation-peers";
import { nodeSigningProvider } from "./node-keys";
import { requireActiveNodeUser } from "./node-governance";
import { openPetition, openSystemGroupPetition } from "./petitions";
import { assertWithinTransaction } from "./prisma";

// The federation-agreement bundle — the cross-node sibling of coalitions.ts.
// One steward-group petition per participating node (register F-5: federation
// authority rides steward appointment); the shared decisions map converges via
// signed federation_proposal_decision events (federation-consent.ts).

export type FederationProposalAction = "formation" | "join" | "departure" | "removal";

// Give the remote side room to run its own steward petition after ours
// resolves: the proposal stays open this long past the local petition close.
const REMOTE_DECISION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type OpenFederationProposalResult =
  | { ok: true; proposalId: string; petitionId: string }
  | {
      ok: false;
      reason:
        | "no_steward_group"
        | "federation_disabled"
        | "not_eligible"
        | "peer_not_found"
        | "peer_not_federable"
        | "already_federated"
        | "proposal_already_open"
        | "federation_not_found"
        | "petition_error";
    };

export type EvaluateFederationProposalResult =
  | { outcome: "succeeded" }
  | { outcome: "failed-rejected" | "failed-withdrawn" | "failed-timeout" }
  | { outcome: "pending" };

type ParticipantSnapshot = { capturedAt: string; domains: string[] };

function parseSnapshot(value: unknown): ParticipantSnapshot {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const domains = Array.isArray(record.domains) ? record.domains.filter((d): d is string => typeof d === "string") : [];
  return { capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : "", domains };
}

// ── Opening proposals ─────────────────────────────────────────────────────────

// Any active node member may request federation with a pinned peer; the
// request IS a petition before the steward collective (register F-5). No
// steward collective ⇒ fail-closed in both directions.
export async function openFederationFormationProposal(
  prisma: PrismaClient,
  {
    nodeId,
    peerDomain,
    name,
    content,
    terms,
    requestedByAccountId,
  }: {
    nodeId: string;
    peerDomain: string;
    name?: string | null;
    content: string;
    terms?: Prisma.InputJsonValue;
    requestedByAccountId: string;
  },
): Promise<OpenFederationProposalResult> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, domain: true, stewardGroupId: true, federationPolicy: true },
  });
  if (!node) return { ok: false, reason: "not_eligible" };
  if (!node.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  if (node.federationPolicy === "disabled") return { ok: false, reason: "federation_disabled" };

  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }

  const peer = await getPeerByDomain(prisma, peerDomain);
  if (!peer) return { ok: false, reason: "peer_not_found" };
  if (peer.status !== "proposed" && peer.status !== "active") {
    return { ok: false, reason: "peer_not_federable" };
  }

  const existingMembership = await prisma.federationMembership.findFirst({
    where: { memberDomain: peer.domain, endedAt: null, federation: { status: "active" } },
    select: { id: true },
  });
  if (existingMembership) return { ok: false, reason: "already_federated" };

  const openProposals = await prisma.federationProposal.findMany({
    where: { status: { in: ["open", "awaiting_remote"] } },
    select: { participantSnapshot: true },
  });
  if (openProposals.some((p) => parseSnapshot(p.participantSnapshot).domains.includes(peer.domain))) {
    return { ok: false, reason: "proposal_already_open" };
  }

  const domains = [node.domain, peer.domain].sort();
  const proposalId = randomUUID();
  await prisma.federationProposal.create({
    data: {
      id: proposalId,
      action: "formation",
      initiatedByDomain: node.domain,
      name: name?.trim() || null,
      content,
      terms: terms ?? {},
      participantSnapshot: { capturedAt: new Date().toISOString(), domains },
      decisions: initialDecisions(domains),
      closesAt: new Date(Date.now() + REMOTE_DECISION_GRACE_MS * 2),
    },
  });

  const petition = await openStewardPetition(prisma, {
    stewardGroupId: node.stewardGroupId,
    family: "federation_formation",
    proposalId,
    requestedByAccountId,
  });
  if (!petition.ok) {
    await prisma.federationProposal.delete({ where: { id: proposalId } });
    return { ok: false, reason: "petition_error" };
  }

  const petitionRow = await prisma.petition.findUniqueOrThrow({
    where: { id: petition.petitionId },
    select: { closesAt: true },
  });
  await prisma.federationProposal.update({
    where: { id: proposalId },
    data: { closesAt: new Date(petitionRow.closesAt.getTime() + REMOTE_DECISION_GRACE_MS) },
  });
  await prisma.federationProposalPetition.create({
    data: {
      proposalId,
      petitionId: petition.petitionId,
      nodeDomain: node.domain,
      role: "participant",
      snapshot: { nodeDomain: node.domain, peerDomain: peer.domain },
    },
  });

  const delivered = await enqueueGovernanceEvent(prisma, node, peer.domain, "federation_proposal_opened", {
    proposalId,
    action: "formation",
    name: name?.trim() || null,
    content,
    terms: (terms ?? {}) as Record<string, never>,
    participantSnapshot: { capturedAt: new Date().toISOString(), domains },
    initiatedByDomain: node.domain,
    closesAt: new Date(petitionRow.closesAt.getTime() + REMOTE_DECISION_GRACE_MS).toISOString(),
  });
  if (!delivered) {
    // Peer became undeliverable between pin and proposal — fail honestly.
    await prisma.federationProposal.delete({ where: { id: proposalId } });
    await prisma.petition.updateMany({
      where: { id: petition.petitionId, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
    return { ok: false, reason: "peer_not_federable" };
  }

  return { ok: true, proposalId, petitionId: petition.petitionId };
}

// Departure is unilateral (register F-2: stopping is always available): only
// this node's steward petition decides, and the peer receives a notice.
export async function openFederationDepartureProposal(
  prisma: PrismaClient,
  {
    nodeId,
    federationId,
    content,
    requestedByAccountId,
  }: { nodeId: string; federationId: string; content: string; requestedByAccountId: string },
): Promise<OpenFederationProposalResult> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, domain: true, stewardGroupId: true },
  });
  if (!node) return { ok: false, reason: "not_eligible" };
  if (!node.stewardGroupId) return { ok: false, reason: "no_steward_group" };
  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }

  const federation = await prisma.federation.findUnique({
    where: { id: federationId },
    include: { memberships: { where: { endedAt: null } } },
  });
  if (!federation || federation.status !== "active") return { ok: false, reason: "federation_not_found" };
  if (!federation.memberships.some((m) => m.isSelf && m.memberDomain === node.domain)) {
    return { ok: false, reason: "federation_not_found" };
  }

  const openDeparture = await prisma.federationProposal.findFirst({
    where: { federationId, action: "departure", status: { in: ["open", "awaiting_remote"] } },
    select: { id: true },
  });
  if (openDeparture) return { ok: false, reason: "proposal_already_open" };

  const proposalId = randomUUID();
  await prisma.federationProposal.create({
    data: {
      id: proposalId,
      federationId,
      action: "departure",
      initiatedByDomain: node.domain,
      content,
      terms: {},
      participantSnapshot: { capturedAt: new Date().toISOString(), domains: [node.domain] },
      decisions: initialDecisions([node.domain]),
      closesAt: new Date(Date.now() + REMOTE_DECISION_GRACE_MS * 2),
    },
  });
  const petition = await openStewardPetition(prisma, {
    stewardGroupId: node.stewardGroupId,
    family: "federation_departure",
    proposalId,
    requestedByAccountId,
  });
  if (!petition.ok) {
    await prisma.federationProposal.delete({ where: { id: proposalId } });
    return { ok: false, reason: "petition_error" };
  }
  const petitionRow = await prisma.petition.findUniqueOrThrow({
    where: { id: petition.petitionId },
    select: { closesAt: true },
  });
  await prisma.federationProposal.update({
    where: { id: proposalId },
    data: { closesAt: new Date(petitionRow.closesAt.getTime() + REMOTE_DECISION_GRACE_MS) },
  });
  await prisma.federationProposalPetition.create({
    data: {
      proposalId,
      petitionId: petition.petitionId,
      nodeDomain: node.domain,
      role: "departing",
      snapshot: { nodeDomain: node.domain, federationId },
    },
  });
  return { ok: true, proposalId, petitionId: petition.petitionId };
}

// A member's federation request opens as their own petition when they sit in
// the steward collective, and as a system petition before it otherwise — the
// coalition co-sponsor pattern.
async function openStewardPetition(
  prisma: PrismaClient,
  input: {
    stewardGroupId: string;
    family: "federation_formation" | "federation_departure";
    proposalId: string;
    requestedByAccountId: string;
  },
) {
  const stewardMembership = await prisma.groupMembership.findFirst({
    where: {
      groupId: input.stewardGroupId,
      accountId: input.requestedByAccountId,
      status: "active",
      participationStatus: "active",
    },
    select: { id: true },
  });
  const base = {
    groupId: input.stewardGroupId,
    category: "group_settings",
    subjectType: input.family,
    subjectId: input.proposalId,
  };
  return stewardMembership
    ? openPetition(prisma, { ...base, createdByMembershipId: stewardMembership.id })
    : openSystemGroupPetition(prisma, base);
}

// ── Evaluation (the mutual-consent gate) ──────────────────────────────────────

// Dispatch hook for petition-evaluation.ts — mirrors
// evaluateCoalitionProposalForPetition.
export async function evaluateFederationProposalForPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<EvaluateFederationProposalResult | null> {
  const link = await prisma.federationProposalPetition.findUnique({
    where: { petitionId },
    select: { proposalId: true },
  });
  if (!link) return null;
  return evaluateFederationProposal(prisma, link.proposalId);
}

export async function evaluateFederationProposal(
  tx: Prisma.TransactionClient,
  proposalId: string,
  options: { now?: Date } = {},
): Promise<EvaluateFederationProposalResult> {
  assertWithinTransaction(tx, "evaluateFederationProposal");
  // Serializes concurrent decision merges (inbox handler racing the petition
  // sweep) — the decisions map is read-modify-write.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`federation_proposal:${proposalId}`}, 0))`;

  const proposal = await tx.federationProposal.findUnique({
    where: { id: proposalId },
    include: { petitions: true },
  });
  if (!proposal) return { outcome: "pending" };
  if (proposal.status === "succeeded") return { outcome: "succeeded" };
  if (proposal.status.startsWith("failed-")) {
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" | "failed-timeout" };
  }

  const now = options.now ?? new Date();
  const snapshot = parseSnapshot(proposal.participantSnapshot);
  let decisions = parseDecisions(proposal.decisions);
  // A node's database holds only its OWN petition link.
  const localLink = proposal.petitions[0] ?? null;
  const selfDomain = localLink?.nodeDomain ?? null;

  // Fold the local steward petition's fate into the shared decisions map.
  if (localLink && selfDomain && decisions[selfDomain] === "pending") {
    const petition = await tx.petition.findUnique({
      where: { id: localLink.petitionId },
      select: { status: true },
    });
    const withdrawn = !petition || petition.status === "withdrawn" || petition.status === "superseded";
    const own: FederationDecisionOutcome | null = withdrawn
      ? "rejected"
      : petition.status === "rejected" || petition.status === "blocked"
        ? "rejected"
        : petition.status === "approved"
          ? "approved"
          : null;
    if (own) {
      decisions = await recordDecision(tx, proposal, snapshot, decisions, selfDomain, own);
      if (withdrawn) return finishProposal(tx, proposal, "failed-withdrawn");
    }
  }

  const combined = combineDecisions(decisions, snapshot.domains);
  if (combined === "rejected") return finishProposal(tx, proposal, "failed-rejected");
  if (combined === "approved") return applyFederationProposal(tx, proposal, selfDomain);

  if (now > proposal.closesAt) {
    // Emit our own rejection so the remote side converges instead of waiting
    // out its own clock (late approvals after this are ignored — terminal).
    if (selfDomain && decisions[selfDomain] === "pending") {
      await recordDecision(tx, proposal, snapshot, decisions, selfDomain, "rejected");
    }
    return finishProposal(tx, proposal, "failed-timeout");
  }

  if (selfDomain && decisions[selfDomain] === "approved" && proposal.status === "open") {
    await tx.federationProposal.update({ where: { id: proposal.id }, data: { status: "awaiting_remote" } });
  }
  return { outcome: "pending" };
}

// Records a remote node's signed decision (inbox handler entry point).
// Monotonic + idempotent: a redelivered or spoof-ordered event cannot change
// a terminal slot. The caller has verified origin === domain.
export async function recordRemoteFederationDecision(
  tx: Prisma.TransactionClient,
  input: { proposalId: string; domain: string; outcome: FederationDecisionOutcome },
): Promise<EvaluateFederationProposalResult | { outcome: "unknown_proposal" }> {
  assertWithinTransaction(tx, "recordRemoteFederationDecision");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`federation_proposal:${input.proposalId}`}, 0))`;
  const proposal = await tx.federationProposal.findUnique({ where: { id: input.proposalId } });
  if (!proposal) return { outcome: "unknown_proposal" };
  if (proposal.status === "succeeded" || proposal.status.startsWith("failed-")) {
    // Late decision after local terminal state: ignored by design.
    return evaluateFederationProposal(tx, input.proposalId);
  }
  const decisions = parseDecisions(proposal.decisions);
  const updated = applyDecision(decisions, input.domain, input.outcome);
  if (updated) {
    await tx.federationProposal.update({
      where: { id: proposal.id },
      data: { decisions: updated },
    });
  }
  return evaluateFederationProposal(tx, input.proposalId);
}

async function recordDecision(
  tx: Prisma.TransactionClient,
  proposal: FederationProposal,
  snapshot: ParticipantSnapshot,
  decisions: FederationDecisionsMap,
  domain: string,
  outcome: FederationDecisionOutcome,
): Promise<FederationDecisionsMap> {
  const updated = applyDecision(decisions, domain, outcome);
  if (!updated) return decisions;
  await tx.federationProposal.update({ where: { id: proposal.id }, data: { decisions: updated } });

  // Broadcast our decision to every other participant. Guarded by the
  // pending→terminal transition above, so redelivery cannot double-emit.
  const selfNode = await tx.node.findUnique({ where: { domain }, select: { id: true, domain: true } });
  if (selfNode) {
    for (const other of snapshot.domains) {
      if (other === domain) continue;
      await enqueueGovernanceEvent(tx, selfNode, other, "federation_proposal_decision", {
        proposalId: proposal.id,
        domain,
        outcome,
      });
    }
  }
  return updated;
}

async function finishProposal(
  tx: Prisma.TransactionClient,
  proposal: FederationProposal & { petitions?: { petitionId: string }[] },
  status: "failed-rejected" | "failed-withdrawn" | "failed-timeout",
): Promise<EvaluateFederationProposalResult> {
  const updated = await tx.federationProposal.updateMany({
    where: { id: proposal.id, status: { in: ["open", "awaiting_remote"] } },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count > 0) {
    const petitionIds = (proposal.petitions ?? []).map((p) => p.petitionId);
    if (petitionIds.length > 0) {
      await tx.petition.updateMany({
        where: { id: { in: petitionIds }, status: "open" },
        data: { status: "superseded", resolvedAt: new Date() },
      });
    }
  }
  return { outcome: status };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function applyFederationProposal(
  tx: Prisma.TransactionClient,
  proposal: FederationProposal,
  selfDomain: string | null,
): Promise<EvaluateFederationProposalResult> {
  assertWithinTransaction(tx, "applyFederationProposal");
  const snapshot = parseSnapshot(proposal.participantSnapshot);

  if (proposal.action === "formation") {
    const federationId = proposal.id; // both sides converge on the same id
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`federation:${federationId}`}, 0))`;
    await tx.federation.upsert({
      where: { id: federationId },
      update: {},
      create: {
        id: federationId,
        name: proposal.name?.trim() || `Federation: ${snapshot.domains.join(" + ")}`,
        terms: proposal.terms as Prisma.InputJsonValue,
      },
    });
    for (const domain of snapshot.domains) {
      const isSelf = domain === selfDomain;
      const peer = isSelf ? null : await getPeerByDomain(tx, domain);
      await tx.federationMembership.upsert({
        where: { federationId_memberDomain: { federationId, memberDomain: domain } },
        update: { endedAt: null, endReason: null },
        create: { federationId, memberDomain: domain, isSelf, federatedNodeId: peer?.id ?? null },
      });
      if (peer && peer.status === "proposed") {
        await tx.federatedNode.update({ where: { id: peer.id }, data: { status: "active" } });
      }
    }
    await tx.federationProposal.updateMany({
      where: { id: proposal.id, status: { in: ["open", "awaiting_remote"] } },
      data: { status: "succeeded", federationId, resolvedAt: new Date() },
    });
    return { outcome: "succeeded" };
  }

  if (proposal.action === "departure") {
    if (!proposal.federationId) return finishProposal(tx, proposal, "failed-withdrawn");
    const selfNode = selfDomain
      ? await tx.node.findUnique({ where: { domain: selfDomain }, select: { id: true, domain: true } })
      : null;
    await dissolveFederationLocally(tx, {
      federationId: proposal.federationId,
      selfNode,
      reason: "departure",
      notifyPeers: true,
    });
    await tx.federationProposal.updateMany({
      where: { id: proposal.id, status: { in: ["open", "awaiting_remote"] } },
      data: { status: "succeeded", resolvedAt: new Date() },
    });
    return { outcome: "succeeded" };
  }

  // join/removal ship with multilateral agreements (post-F1); nothing can
  // open them yet, so reaching here is an invariant breach.
  throw new Error(`Unsupported federation proposal action: ${proposal.action}`);
}

// Shared by departure, the node-wide STOP valves (federation-policy.ts), and
// the inbound agreement_ended handler. Idempotent: dissolving a dissolved
// federation is a no-op.
export async function dissolveFederationLocally(
  tx: Prisma.TransactionClient,
  input: {
    federationId: string;
    selfNode: { id: string; domain: string } | null;
    reason: string;
    notifyPeers: boolean;
  },
): Promise<{ dissolved: boolean }> {
  assertWithinTransaction(tx, "dissolveFederationLocally");
  const federation = await tx.federation.findUnique({
    where: { id: input.federationId },
    include: { memberships: { where: { endedAt: null } } },
  });
  if (!federation || federation.status !== "active") return { dissolved: false };

  const remoteDomains = federation.memberships.filter((m) => !m.isSelf).map((m) => m.memberDomain);

  // Notices go out BEFORE peers flip to ended — mayFederate's protocol tier
  // refuses ended peers, and the goodbye must still be deliverable.
  if (input.notifyPeers && input.selfNode) {
    for (const domain of remoteDomains) {
      await enqueueGovernanceEvent(tx, input.selfNode, domain, "federation_agreement_ended", {
        federationId: input.federationId,
        reason: input.reason,
      });
    }
  }

  await tx.federationMembership.updateMany({
    where: { federationId: input.federationId, endedAt: null },
    data: { endedAt: new Date(), endReason: input.reason },
  });
  await tx.federation.update({
    where: { id: input.federationId },
    data: { status: "dissolved", dissolvedAt: new Date() },
  });
  // Ending the AGREEMENT does not sever the PIN: the peer demotes from
  // active back to proposed — still a known node, still reachable for the
  // goodbye notice above and for a future re-federation proposal (register
  // F-2: de-federation is reversible). "ended" stays reserved for actual
  // peer severance (F5 suspension/compromise), which the outbox refuses to
  // deliver to.
  //
  // proposed-after-dissolve must stay equivalent to proposed-fresh: every
  // agreement-scoped state is closed here (memberships ended, federation
  // dissolved), so nothing may infer "never federated" from peer status.
  // F3: suspend visibility grants toward these peers HERE (register D-4),
  // and resume must key off the NEW agreement — never off peer status.
  for (const domain of remoteDomains) {
    await tx.federatedNode.updateMany({
      where: { domain, status: "active" },
      data: { status: "proposed" },
    });
  }
  return { dissolved: true };
}

// ── Timeout sweep ─────────────────────────────────────────────────────────────

// Sibling of resolveExpiredPetitions: once the local petition has resolved,
// nothing re-triggers evaluation, so remote silence needs a clock. Runs from
// the federation instrumentation tick.
export async function resolveExpiredFederationProposals(
  prisma: PrismaClient,
): Promise<{ attempted: number; resolved: number; failed: number }> {
  const due = await prisma.federationProposal.findMany({
    where: { status: { in: ["open", "awaiting_remote"] }, closesAt: { lte: new Date() } },
    select: { id: true },
  });
  let resolved = 0;
  let failed = 0;
  for (const proposal of due) {
    try {
      const result = await prisma.$transaction((tx) => evaluateFederationProposal(tx, proposal.id));
      if (result.outcome !== "pending") resolved += 1;
    } catch (err) {
      failed += 1;
      console.error(`[federation] failed to evaluate proposal ${proposal.id}`, err);
    }
  }
  return { attempted: due.length, resolved, failed };
}

// ── Shared enqueue helper ─────────────────────────────────────────────────────

// All governance-handshake traffic flows through the D-3 chokepoint with the
// federation_governance class (protocol tier: deliverable to proposed peers).
export async function enqueueGovernanceEvent(
  client: Prisma.TransactionClient | PrismaClient,
  selfNode: { id: string; domain: string },
  peerDomain: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const peer = await getPeerByDomain(client, peerDomain);
  if (!peer) return false;
  const signer = await nodeSigningProvider(client, selfNode.id);
  const envelope = createFederationEnvelope({
    eventType,
    payload: payload as Parameters<typeof createFederationEnvelope>[0]["payload"],
    originDomain: selfNode.domain,
    keyId: signer.keyId,
    signer: signer.provider,
    publicKey: signer.publicKey,
  });
  const result = await enqueueFederationEvent(client, {
    peer,
    envelope,
    dataClass: "federation_governance",
  });
  return result.ok;
}
