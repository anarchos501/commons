import { randomUUID } from "node:crypto";
import type { FederatedNode, Node, PortableIdentity, Prisma, PrismaClient } from "../generated/prisma/client";
import type { FederationEnvelope } from "./federation-envelope";
import { ensurePeerNodeRow, getPeerByDomain } from "./federation-peers";
import { resolveFederatedStance } from "./federated-visibility";
import { enqueueSignedNodeEvent } from "./federations";
import { joinOpenGroup } from "./group-membership";
import { verifyWithPublicKeyPem } from "./node-keys";
import { ensurePortableIdentity, identitySigningProvider } from "./portable-identity";
import { hashSignedEventPayload, type SignedEventPayload } from "./signed-events";

// Pattern 1 (plan §3): the person acts in their HOME node's UI; the home node
// signs and delivers the action server-to-server; the receiving node verifies
// (pinned node key + the actor's identity key + presence standing) and applies
// it through its own ordinary {ok, reason} domain logic.
//
// Federation authenticates WHO is acting; it never imports WHAT they may do —
// authorization stays local, and no trust score crosses the wire. The action
// registry below is the receiving side's entire vocabulary: an action type
// not registered here cannot be performed remotely, no matter who signs it.

export type MediatedActionResult = { ok: true } | { ok: false; reason: string };

type MediatedActionContext = {
  localNode: Node;
  origin: FederatedNode;
  identity: PortableIdentity;
  shadowAccountId: string;
  action: Record<string, unknown>;
};

type MediatedActionHandler = (tx: Prisma.TransactionClient, context: MediatedActionContext) => Promise<MediatedActionResult>;

const MEDIATED_ACTION_HANDLERS: Record<string, MediatedActionHandler> = {
  // F2 reference action: join a public, open-membership group — the smallest
  // real action that exercises the whole chain, deciding through the SAME
  // joinOpenGroup guards a local member hits (open policy, revoked/pending
  // membership refusals).
  join_open_group: async (tx, { localNode, origin, shadowAccountId, action }) => {
    const groupId = typeof action.groupId === "string" ? action.groupId : null;
    if (!groupId) return { ok: false, reason: "malformed_action" };

    const group = await tx.group.findUnique({
      where: { id: groupId },
      select: { nodeId: true, visibility: true, archivedAt: true },
    });
    // Private groups are not federated surfaces (register D-4/A3): a remote
    // actor is told "not found", exactly like the open web sees.
    if (!group || group.nodeId !== localNode.id || group.archivedAt || group.visibility !== "public") {
      return { ok: false, reason: "not_found" };
    }

    // register D-4: the grant chokepoint, on a federated serve path. A group
    // closed toward this peer reads as not found on the FEDERATED layer —
    // its public page stays public on the open web, which this function
    // never gates. A merely-visible group is discoverable but refuses
    // interaction, honestly labeled.
    const stance = await resolveFederatedStance(tx, groupId, origin);
    if (stance === "closed") return { ok: false, reason: "not_found" };
    if (stance !== "interactive") return { ok: false, reason: "group_not_interactive" };

    try {
      await joinOpenGroup(tx as unknown as PrismaClient, shadowAccountId, groupId);
    } catch (error) {
      // joinOpenGroup's throws are all pre-write checks (not open, revoked,
      // pending) — safe to convert to a permanent, recorded refusal.
      return { ok: false, reason: error instanceof Error ? error.message : "join_refused" };
    }

    // Remote members carry ZERO local governance weight at F2 (the D-5
    // arrival-weight question in miniature, decided deliberately): dormant
    // participation keeps them out of voter counts and threshold
    // denominators. They also cannot vote — a shadow account has no
    // credentials, so no session can ever act as it locally. F3+ revisits
    // participation semantics for remote members.
    await tx.groupMembership.update({
      where: { accountId_groupId: { accountId: shadowAccountId, groupId } },
      data: { participationStatus: "dormant" },
    });
    return { ok: true };
  },

  // Hub ingest (A4): a member of a REMOTE member group posts into a coalition
  // homed here. WHO was verified by handleMediatedAction (pinned node key +
  // identity key + active presence); the home's own authorization is: the
  // vouched group must be an active remote member of this coalition, vouched
  // by ITS home node (origin). The member's node asserted the person's group
  // membership by signing the envelope — Pattern 1's trust shape.
  coalition_post_message: async (tx, { localNode, origin, shadowAccountId, action }) => {
    const coalitionId = typeof action.coalitionId === "string" ? action.coalitionId : null;
    const viaRemoteGroupId = typeof action.viaRemoteGroupId === "string" ? action.viaRemoteGroupId : null;
    const body = typeof action.body === "string" ? action.body.trim() : "";
    if (!coalitionId || !viaRemoteGroupId || !body) return { ok: false, reason: "malformed_action" };

    const membership = await tx.coalitionMembership.findFirst({
      where: {
        coalitionId,
        endedAt: null,
        coalition: { status: "active", nodeId: localNode.id },
        federatedGroupPresence: {
          remoteGroupId: viaRemoteGroupId,
          federatedNodeId: origin.id,
          status: "active",
        },
      },
      select: { id: true },
    });
    if (!membership) return { ok: false, reason: "group_not_coalition_member" };

    // The relay thread: first open coalition thread, created on demand.
    let thread = await tx.discussionThread.findFirst({
      where: { spaceType: "coalition", spaceId: coalitionId, closedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!thread) {
      thread = await tx.discussionThread.create({
        data: {
          spaceType: "coalition",
          spaceId: coalitionId,
          title: "Cross-node coordination",
          createdByAccountId: shadowAccountId,
        },
        select: { id: true },
      });
    }
    const message = await tx.discussionMessage.create({
      data: {
        threadId: thread.id,
        authorId: shadowAccountId,
        body,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.discussionThread.update({
      where: { id: thread.id },
      data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
    });

    const author = await tx.account.findUnique({ where: { id: shadowAccountId }, select: { displayName: true } });
    // Dynamic import: federated-coalitions imports mediateRemoteAction from
    // this module; a static import back would be a cycle.
    const { broadcastCoalitionMessage } = await import("./federated-coalitions");
    await broadcastCoalitionMessage(tx, { id: localNode.id, domain: localNode.domain }, {
      coalitionId,
      messageId: message.id,
      originDomain: origin.domain,
      authorLabel: `${author?.displayName ?? "member"} @ ${origin.domain}`,
      body,
      postedAt: message.createdAt,
    });
    return { ok: true };
  },
};

export const MEDIATED_ACTION_TYPES = Object.keys(MEDIATED_ACTION_HANDLERS);

// The nonce makes every signed claim single-intent (register D-8, same
// rationale as presence claims): no re-enveloping of old member signatures,
// no deterministic-signature collisions in the SignedEvent ledger.
function mediatedActionClaim(input: {
  did: string;
  actionType: string;
  action: Record<string, unknown>;
  nonce: string;
}): SignedEventPayload {
  return {
    purpose: "mediated_action",
    did: input.did,
    actionType: input.actionType,
    action: input.action as SignedEventPayload,
    nonce: input.nonce,
  };
}

export type MediateRemoteActionResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: "account_not_found" | "peer_not_found" | "not_federable" | "unknown_action_type" };

// Home side. The person never logs into the remote node at all.
export async function mediateRemoteAction(
  prisma: PrismaClient,
  {
    accountId,
    peerDomain,
    actionType,
    action,
  }: { accountId: string; peerDomain: string; actionType: string; action: Record<string, unknown> },
): Promise<MediateRemoteActionResult> {
  if (!MEDIATED_ACTION_TYPES.includes(actionType)) return { ok: false, reason: "unknown_action_type" };
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, homeNode: { select: { id: true, domain: true } } },
  });
  if (!account) return { ok: false, reason: "account_not_found" };
  const peer = await getPeerByDomain(prisma, peerDomain);
  if (!peer) return { ok: false, reason: "peer_not_found" };

  const { identity } = await ensurePortableIdentity(prisma, accountId);
  const signer = await identitySigningProvider(prisma, identity.id);
  const nonce = randomUUID();
  const claim = mediatedActionClaim({ did: identity.did, actionType, action, nonce });
  const actorSignature = signer.provider.sign(hashSignedEventPayload(claim), signer.publicKey);

  // Doubly signed: the identity signs the claim, the node signs the envelope.
  const delivered = await enqueueSignedNodeEvent(
    prisma,
    account.homeNode,
    peer.domain,
    "mediated_action",
    { did: identity.did, actionType, action, nonce, actorSignature },
    "cross_node_action",
  );
  if (!delivered) return { ok: false, reason: "not_federable" };

  const persisted = await prisma.signedEvent.create({
    data: {
      eventType: "mediated_action_requested",
      subjectType: "mediated_action",
      subjectId: `${actionType}:${peer.domain}`,
      actorAccountId: accountId,
      portableIdentityId: identity.id,
      nodeId: account.homeNode.id,
      payload: claim as Prisma.InputJsonValue,
      payloadHash: hashSignedEventPayload(claim),
      signature: actorSignature,
      publicKey: identity.publicKey,
    },
  });
  return { ok: true, eventId: persisted.id };
}

// ── Remote side (invoked from federation-inbox) ──────────────────────────────

export async function handleMediatedAction(
  tx: Prisma.TransactionClient,
  { origin, envelope, localNode }: { origin: FederatedNode; envelope: FederationEnvelope; localNode: Node | null },
): Promise<MediatedActionResult> {
  if (!localNode) return { ok: false, reason: "node_unavailable" };
  const p = envelope.payload as Record<string, unknown>;
  const did = typeof p.did === "string" ? p.did : null;
  const actionType = typeof p.actionType === "string" ? p.actionType : null;
  const action =
    typeof p.action === "object" && p.action !== null && !Array.isArray(p.action)
      ? (p.action as Record<string, unknown>)
      : null;
  const nonce = typeof p.nonce === "string" ? p.nonce : null;
  const actorSignature = typeof p.actorSignature === "string" ? p.actorSignature : null;
  if (!did || !actionType || !action || !nonce || !actorSignature) return { ok: false, reason: "malformed_payload" };

  // WHO: the identity must already hold an active presence here, established
  // by its home node — and only that home node may mediate for it.
  const identity = await tx.portableIdentity.findUnique({ where: { did } });
  if (!identity) return { ok: false, reason: "unknown_identity" };
  const presence = await tx.linkedNodePresence.findUnique({
    where: { portableIdentityId_nodeId: { portableIdentityId: identity.id, nodeId: localNode.id } },
  });
  if (!presence) return { ok: false, reason: "no_presence" };
  if (presence.status !== "active") return { ok: false, reason: `presence_${presence.status}` };
  if (presence.homeNodeDomain && presence.homeNodeDomain !== origin.domain) {
    return { ok: false, reason: "home_mismatch" };
  }

  const claim = mediatedActionClaim({ did, actionType, action, nonce });
  if (!verifyWithPublicKeyPem(identity.publicKey, hashSignedEventPayload(claim), actorSignature)) {
    return { ok: false, reason: "bad_actor_signature" };
  }

  const handler = MEDIATED_ACTION_HANDLERS[actionType];
  if (!handler) return { ok: false, reason: "unknown_action_type" };

  // WHAT: local authorization decides from here, through the same domain
  // logic a local member hits. The shadow account is the presence's
  // member-shaped adapter: no credentials (no session can ever act as it),
  // homeNodeId pointing truthfully at the peer's Node row.
  const shadowAccountId = await ensureShadowAccount(tx, identity, presence.displayName ?? presence.handle, origin);
  return handler(tx, { localNode, origin, identity, shadowAccountId, action });
}

async function ensureShadowAccount(
  tx: Prisma.TransactionClient,
  identity: PortableIdentity,
  displayName: string,
  origin: FederatedNode,
): Promise<string> {
  const existing = await tx.account.findFirst({
    where: { portableIdentityId: identity.id },
    select: { id: true },
  });
  if (existing) return existing.id;
  const homeNode = await ensurePeerNodeRow(tx, { domain: origin.domain, name: origin.displayName });
  const account = await tx.account.create({
    data: {
      portableIdentityId: identity.id,
      homeNodeId: homeNode.id,
      displayName,
      accountType: "participant",
    },
    select: { id: true },
  });
  return account.id;
}
