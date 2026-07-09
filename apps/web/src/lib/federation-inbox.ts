import { Prisma, type FederatedNode, type Node, type PrismaClient } from "../generated/prisma/client";
import { initialDecisions } from "./federation-consent";
import {
  parseFederationEnvelope,
  verifyFederationEnvelope,
  type FederationEnvelope,
} from "./federation-envelope";
import { handleMediatedAction } from "./federation-actions";
import {
  handleCoalitionContentAppended,
  handleCoalitionProposalDecision,
  handleCoalitionProposalOpened,
  handleCoalitionResolved,
} from "./federated-coalitions";
import {
  handleBackupEstablishAccept,
  handleBackupEstablishRefuse,
  handleBackupEstablishRequest,
  handleBackupHostingEnded,
  handleBackupRevoked,
} from "./continuity-establishment";
import { handleBackupDelta } from "./continuity-replication";
import {
  handleChallengeRelayRequest,
  handleProofOfLife,
  handleProofOfLifeRelay,
  handleTakeoverChallenge,
} from "./continuity-lease";
import { applyPresenceEstablish, applyPresenceRevoke } from "./federation-presence";
import {
  dissolveFederationLocally,
  enqueueGovernanceEvent,
  recordRemoteFederationDecision,
} from "./federations";
import { openSystemGroupPetition } from "./petitions";

export type FederationInboxHandlerResult = { ok: true } | { ok: false; reason: string };

// Handlers run inside the same transaction that records the inbound event, so
// dedupe and effects commit atomically. Semantics: return {ok:false} for a
// permanent refusal (recorded, dedupe stops reprocessing); THROW for a
// transient failure (transaction rolls back, no row is kept, the sender's
// outbox redelivers).
export type FederationInboxHandler = (
  tx: Prisma.TransactionClient,
  context: { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null },
) => Promise<FederationInboxHandlerResult>;

// ── F1 governance handlers ────────────────────────────────────────────────────

// A remote node proposes an agreement: mirror the proposal and put it in this
// node's steward queue. Fail-closed (register F-5): with no steward collective
// — or federation disabled — the refusal is itself an answer, delivered as a
// signed rejection decision rather than a silent timeout.
const handleProposalOpened: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const proposalId = typeof p.proposalId === "string" ? p.proposalId : null;
  const action = typeof p.action === "string" ? p.action : null;
  const content = typeof p.content === "string" ? p.content : "";
  const snapshot = p.participantSnapshot as { domains?: unknown } | undefined;
  const domains = Array.isArray(snapshot?.domains)
    ? snapshot!.domains.filter((d): d is string => typeof d === "string")
    : [];
  const closesAt = typeof p.closesAt === "string" ? new Date(p.closesAt) : null;

  if (!proposalId || !closesAt || Number.isNaN(closesAt.getTime())) {
    return { ok: false, reason: "malformed_payload" };
  }
  // A node may only propose as itself.
  if (p.initiatedByDomain !== origin.domain) return { ok: false, reason: "initiator_spoof" };
  if (!domains.includes(localNode.domain) || !domains.includes(origin.domain)) {
    return { ok: false, reason: "not_a_participant" };
  }
  if (action !== "formation") return { ok: false, reason: "unsupported_action" };

  const existing = await tx.federationProposal.findUnique({ where: { id: proposalId }, select: { id: true } });
  if (existing) return { ok: true };

  if (!localNode.stewardGroupId || localNode.federationPolicy === "disabled") {
    await enqueueGovernanceEvent(tx, localNode, origin.domain, "federation_proposal_decision", {
      proposalId,
      domain: localNode.domain,
      outcome: "rejected",
      reason: !localNode.stewardGroupId ? "no_steward_group" : "federation_disabled",
    });
    return { ok: true };
  }

  await tx.federationProposal.create({
    data: {
      id: proposalId,
      action,
      initiatedByDomain: origin.domain,
      name: typeof p.name === "string" ? p.name : null,
      content,
      terms: (p.terms ?? {}) as Prisma.InputJsonValue,
      participantSnapshot: { capturedAt: new Date().toISOString(), domains },
      decisions: initialDecisions(domains),
      // The initiator's deadline is the shared deadline: if this node's
      // steward petition cannot resolve by then, the proposal times out
      // honestly on both sides.
      closesAt,
    },
  });
  const petition = await openSystemGroupPetition(tx, {
    groupId: localNode.stewardGroupId,
    category: "group_settings",
    subjectType: "federation_formation",
    subjectId: proposalId,
  });
  if (!petition.ok) {
    await tx.federationProposal.delete({ where: { id: proposalId } });
    await enqueueGovernanceEvent(tx, localNode, origin.domain, "federation_proposal_decision", {
      proposalId,
      domain: localNode.domain,
      outcome: "rejected",
      reason: "petition_error",
    });
    return { ok: true };
  }
  await tx.federationProposalPetition.create({
    data: {
      proposalId,
      petitionId: petition.petitionId,
      nodeDomain: localNode.domain,
      role: "participant",
      snapshot: { nodeDomain: localNode.domain, initiatedByDomain: origin.domain },
    },
  });
  return { ok: true };
};

const handleProposalDecision: FederationInboxHandler = async (tx, { origin, envelope }) => {
  const p = envelope.payload as Record<string, unknown>;
  const proposalId = typeof p.proposalId === "string" ? p.proposalId : null;
  const domain = typeof p.domain === "string" ? p.domain : null;
  const outcome = p.outcome === "approved" || p.outcome === "rejected" ? p.outcome : null;
  if (!proposalId || !domain || !outcome) return { ok: false, reason: "malformed_payload" };
  // A node speaks only for itself: the decision's domain must be the pinned
  // origin the envelope verified against.
  if (domain !== origin.domain) return { ok: false, reason: "decision_spoof" };

  const result = await recordRemoteFederationDecision(tx, { proposalId, domain, outcome });
  if (result.outcome === "unknown_proposal") {
    // Out-of-order delivery (decision before proposal): transient — roll back
    // so the sender's outbox retries with backoff.
    throw new Error(`federation proposal ${proposalId} not yet known`);
  }
  return { ok: true };
};

const handleAgreementEnded: FederationInboxHandler = async (tx, { origin, envelope, localNode }) => {
  const p = envelope.payload as Record<string, unknown>;
  const federationId = typeof p.federationId === "string" ? p.federationId : null;
  if (!federationId) return { ok: false, reason: "malformed_payload" };
  // Only a member of the agreement may end it.
  const membership = await tx.federationMembership.findFirst({
    where: { federationId, memberDomain: origin.domain, isSelf: false },
    select: { id: true },
  });
  if (!membership) return { ok: false, reason: "not_a_member" };

  await dissolveFederationLocally(tx, {
    federationId,
    selfNode: localNode ? { id: localNode.id, domain: localNode.domain } : null,
    reason: typeof p.reason === "string" ? `peer:${p.reason}` : "peer_departed",
    // Never re-notify: the goodbye came from the peer; echoing it back loops.
    notifyPeers: false,
  });
  return { ok: true };
};

// The peer announces it has suspended traffic with us; mirror that on our
// record of THEM (self-scoped: a node can only suspend itself in our eyes).
const handleSuspensionNotice: FederationInboxHandler = async (tx, { origin }) => {
  await tx.federatedNode.updateMany({
    where: { id: origin.id, status: { in: ["proposed", "active"] } },
    data: { status: "suspended" },
  });
  return { ok: true };
};

// Static registry, one entry per wire event type (the PETITION_DETAIL_BUILDERS
// pattern).
const INBOX_HANDLERS: Record<string, FederationInboxHandler> = {
  federation_ping: async () => ({ ok: true }),
  federation_proposal_opened: handleProposalOpened,
  federation_proposal_decision: handleProposalDecision,
  federation_agreement_ended: handleAgreementEnded,
  federation_suspension_notice: handleSuspensionNotice,
  presence_establish: applyPresenceEstablish,
  presence_revoke: applyPresenceRevoke,
  mediated_action: handleMediatedAction,
  coalition_proposal_opened: handleCoalitionProposalOpened,
  coalition_proposal_decision: handleCoalitionProposalDecision,
  coalition_resolved: handleCoalitionResolved,
  coalition_content_appended: handleCoalitionContentAppended,
  backup_establish_request: handleBackupEstablishRequest,
  backup_establish_accept: handleBackupEstablishAccept,
  backup_establish_refuse: handleBackupEstablishRefuse,
  backup_revoked: handleBackupRevoked,
  backup_hosting_ended: handleBackupHostingEnded,
  backup_delta: handleBackupDelta,
  takeover_challenge: handleTakeoverChallenge,
  challenge_relay_request: handleChallengeRelayRequest,
  proof_of_life: handleProofOfLife,
  proof_of_life_relay: handleProofOfLifeRelay,
};

export const KNOWN_INBOX_EVENT_TYPES = Object.keys(INBOX_HANDLERS);

export type ReceiveFederationEnvelopeResult =
  | { outcome: "applied"; eventId: string }
  | { outcome: "duplicate"; eventId: string }
  | { outcome: "rejected"; reason: string };

export async function receiveFederationEnvelope(
  prisma: PrismaClient,
  body: unknown,
  options: { now?: Date; localNode?: Node | null } = {},
): Promise<ReceiveFederationEnvelopeResult> {
  const envelope = parseFederationEnvelope(body);
  if (!envelope) return { outcome: "rejected", reason: "malformed" };

  // Identity lookup is by origin.domain — the pinned identity — never by any
  // delivery address (register F-4: inboxUrl is untrusted routing metadata).
  const origin = await prisma.federatedNode.findUnique({ where: { domain: envelope.origin.domain } });
  if (!origin) return { outcome: "rejected", reason: "unknown_origin" };
  if (origin.status === "suspended" || origin.status === "ended") {
    return { outcome: "rejected", reason: `origin_${origin.status}` };
  }

  const verdict = verifyFederationEnvelope(envelope, origin.publicKey, { now: options.now });
  if (!verdict.ok) return { outcome: "rejected", reason: verdict.reason };

  const handler = INBOX_HANDLERS[envelope.eventType];
  const localNode = options.localNode ?? null;

  let result: ReceiveFederationEnvelopeResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Insert-first replay guard: the unique(originNodeId, remoteEventId)
      // violation below is the duplicate signal (register F-4).
      const inbound = await tx.federationInboundEvent.create({
        data: {
          originNodeId: origin.id,
          remoteEventId: envelope.eventId,
          eventType: envelope.eventType,
          envelope: envelope as unknown as Prisma.InputJsonValue,
        },
      });

      if (!handler) {
        await tx.federationInboundEvent.update({
          where: { id: inbound.id },
          data: { outcome: "rejected", error: "unknown_event_type", processedAt: new Date() },
        });
        return { outcome: "rejected" as const, reason: "unknown_event_type" };
      }

      const handled = await handler(tx, { origin, envelope, localNode });
      await tx.federationInboundEvent.update({
        where: { id: inbound.id },
        data: {
          outcome: handled.ok ? "applied" : "rejected",
          error: handled.ok ? null : handled.reason,
          processedAt: new Date(),
        },
      });
      return handled.ok
        ? { outcome: "applied" as const, eventId: envelope.eventId }
        : { outcome: "rejected" as const, reason: handled.reason };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "duplicate", eventId: envelope.eventId };
    }
    throw error;
  }

  // Best-effort liveness marker; never blocks the verdict.
  try {
    await prisma.federatedNode.update({ where: { id: origin.id }, data: { lastSeenAt: new Date() } });
  } catch {
    // ignore
  }

  return result;
}
