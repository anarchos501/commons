import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { establishPresence } from "../lib/federation-presence";
import { mediateRemoteAction } from "../lib/federation-actions";
import { proposeFederatedVisibility, resolveFederatedStance } from "../lib/federated-visibility";
import { proposeFederationTermination } from "../lib/federation-policy";
import { openFederationFormationProposal } from "../lib/federations";
import { addNodePetitionSupport, addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedPair,
  ensureSecondDatabase,
  stewardPetitionFor,
  type FederatedPair,
} from "./federation-fixtures";

// register D-4: per-(collective, peer-node) visibility grants. Default closed;
// opening is a petition; the grant governs the FEDERATED layer only and must
// not touch open-web serving; grants suspend with the agreement and resume on
// re-federation.

let prismaA: PrismaClient;
let prismaB: PrismaClient;

before(async () => {
  const secondUrl = await ensureSecondDatabase();
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
});

// A public group on A's node + A's steward account's membership, so it can
// open stance petitions. Returns { groupId, membershipId }.
async function publicGroupOnA(prefix: string): Promise<{ groupId: string; membershipId: string; stewardAccountId: string }> {
  const steward = await prismaA.node.findFirstOrThrow({
    where: { domain: `${prefix}-a.example` },
    select: { stewardGroupId: true },
  });
  const membership = await prismaA.groupMembership.findFirstOrThrow({
    where: { groupId: steward.stewardGroupId! },
    select: { id: true, accountId: true },
  });
  return { groupId: steward.stewardGroupId!, membershipId: membership.id, stewardAccountId: membership.accountId };
}

async function approveGroupPetition(petitionId: string, membershipId: string) {
  const membership = await prismaA.groupMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { accountId: true },
  });
  assert.equal(
    (await addPetitionSupport(prismaA, { petitionId, actorAccountId: membership.accountId, membershipId })).ok,
    true,
  );
  await prismaA.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(prismaA, petitionId);
}

async function activePeerId(pair: FederatedPair): Promise<string> {
  const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
  return peer.id;
}

test("default stance is closed; a petition opens it, and it is legible", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fv_open", { activate: true });
  try {
    const { groupId, membershipId } = await publicGroupOnA("fv_open");
    const peerId = await activePeerId(pair);
    const peer = { id: peerId, status: "active" };

    // Default: no grant row, stance is closed.
    assert.equal(await resolveFederatedStance(prismaA, groupId, peer), "closed");

    const proposed = await proposeFederatedVisibility(prismaA, {
      groupId,
      peerNodeId: peerId,
      target: "interactive",
      createdByMembershipId: membershipId,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    await approveGroupPetition(proposed.petitionId, membershipId);

    assert.equal(await resolveFederatedStance(prismaA, groupId, peer), "interactive");
  } finally {
    await cleanupSide(prismaA, "fv_open");
    await cleanupSide(prismaB, "fv_open");
  }
});

test("private groups cannot hold a grant (register D-4/A3)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fv_priv", { activate: true });
  try {
    const { membershipId } = await publicGroupOnA("fv_priv");
    const peerId = await activePeerId(pair);
    const privateGroup = await prismaA.group.create({
      data: {
        id: "fv_priv_private_group",
        nodeId: (await prismaA.node.findFirstOrThrow({ where: { domain: "fv_priv-a.example" } })).id,
        name: "fv_priv private",
        membershipPolicy: "open",
        visibility: "private",
      },
    });
    await prismaA.groupMembership.create({
      data: {
        id: "fv_priv_private_membership",
        accountId: (await prismaA.groupMembership.findUniqueOrThrow({ where: { id: membershipId }, select: { accountId: true } })).accountId,
        groupId: privateGroup.id,
        status: "active",
        participationStatus: "active",
      },
    });
    const refused = await proposeFederatedVisibility(prismaA, {
      groupId: privateGroup.id,
      peerNodeId: peerId,
      target: "visible",
      createdByMembershipId: "fv_priv_private_membership",
    });
    assert.deepEqual(refused, { ok: false, reason: "private_group_not_grantable" });
  } finally {
    await cleanupSide(prismaA, "fv_priv");
    await cleanupSide(prismaB, "fv_priv");
  }
});

// THE carve-out (register D-4/D-6): a public group set "closed" toward a peer
// disappears from that peer's FEDERATED surfaces, but its public page — the
// open-web read path that never consults the stance — is unaffected. Proven
// in code by exercising both a federated serve path (mediated join) and a
// public-web read (the group's own row + public page loader inputs) against
// the same closed group.
test("a public group closed toward a peer still serves its public page (the carve-out is code, not copy)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fv_carve", { activate: true });
  try {
    const nodeA = await prismaA.node.findFirstOrThrow({ where: { domain: "fv_carve-a.example" } });
    const publicGroup = await prismaA.group.create({
      data: {
        id: "fv_carve_public_group",
        nodeId: nodeA.id,
        name: "Open Garden",
        description: "Public and readable by anyone.",
        membershipPolicy: "open",
        visibility: "public",
      },
    });
    const peerId = await activePeerId(pair);
    const peer = { id: peerId, status: "active" };

    // Explicitly CLOSED toward the peer (default is closed, but make it a real
    // grant row to model "someone set it closed and expects privacy").
    await prismaA.federatedVisibilityGrant.create({
      data: { groupId: publicGroup.id, federatedNodeId: peerId, stance: "closed" },
    });

    // FEDERATED path: the stance chokepoint says closed → the group is
    // invisible/unreachable on the federated layer. A remote person from B
    // establishes a presence on A and tries to join: refused as not_found,
    // exactly what the open web would show for a nonexistent federated target.
    assert.equal(await resolveFederatedStance(prismaA, publicGroup.id, peer), "closed");
    const established = await establishPresence(prismaB, {
      accountId: pair.b.stewardAccountId,
      peerDomain: pair.a.domain,
    });
    assert.equal(established.ok, true);
    await pair.pump();
    const mediated = await mediateRemoteAction(prismaB, {
      accountId: pair.b.stewardAccountId,
      peerDomain: pair.a.domain,
      actionType: "join_open_group",
      action: { groupId: publicGroup.id },
    });
    assert.equal(mediated.ok, true);
    await pair.pump();
    const refusal = await prismaA.federationInboundEvent.findFirst({
      where: { eventType: "mediated_action", error: "not_found" },
    });
    assert.ok(refusal, "a closed group must be not_found on the federated join path");
    assert.equal(await prismaA.groupMembership.count({ where: { groupId: publicGroup.id } }), 0);

    // OPEN-WEB path: the group is still public and still readable. The public
    // read path is `visibility === "public"` — it never consults the stance,
    // and no grant can flip it. This is the property D-6 requires: "closed
    // toward node X" does not imply the public page is hidden.
    const asOpenWebSees = await prismaA.group.findUniqueOrThrow({
      where: { id: publicGroup.id },
      select: { visibility: true, name: true, description: true },
    });
    assert.equal(asOpenWebSees.visibility, "public");
    assert.equal(asOpenWebSees.name, "Open Garden");
    // The public listing (find-collectives) enumerates public, unarchived
    // groups with no stance predicate — the closed group is still listed.
    const publicListing = await prismaA.group.findMany({
      where: { visibility: "public", archivedAt: null },
      select: { id: true },
    });
    assert.ok(publicListing.some((g) => g.id === publicGroup.id), "closed group stays in the public listing");
  } finally {
    await cleanupSide(prismaA, "fv_carve");
    await cleanupSide(prismaB, "fv_carve");
  }
});

test("grants suspend when the agreement ends and resume when it re-forms (F1 carry-forward)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fv_susp");
  try {
    // Form the agreement so both peers go active.
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "For the suspension test.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await pair.pump();
    await approveStewardPetition(pair.b, await stewardPetitionFor(pair.b, opened.proposalId));
    await pair.pump();
    await approveStewardPetition(pair.a, opened.petitionId);
    await pair.pump();

    const { groupId, membershipId, stewardAccountId } = await publicGroupOnA("fv_susp");
    const peerId = await activePeerId(pair);

    // Open a grant → interactive.
    const proposed = await proposeFederatedVisibility(prismaA, {
      groupId,
      peerNodeId: peerId,
      target: "interactive",
      createdByMembershipId: membershipId,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    await approveGroupPetition(proposed.petitionId, membershipId);
    assert.equal(await resolveFederatedStance(prismaA, groupId, { id: peerId, status: "active" }), "interactive");

    // End the agreement via node-wide termination.
    const stop = await proposeFederationTermination(prismaA, {
      nodeId: pair.a.node.id,
      federationId: opened.proposalId,
      requestedByAccountId: stewardAccountId,
    });
    assert.equal(stop.ok, true);
    if (!stop.ok) return;
    assert.equal((await addNodePetitionSupport(prismaA, { petitionId: stop.petitionId, accountId: stewardAccountId })).ok, true);
    await prismaA.petition.update({ where: { id: stop.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prismaA, stop.petitionId);
    await pair.pump();

    // The grant row is suspended, and the peer is demoted to proposed.
    const grant = await prismaA.federatedVisibilityGrant.findUniqueOrThrow({
      where: { groupId_federatedNodeId: { groupId, federatedNodeId: peerId } },
    });
    assert.ok(grant.suspendedAt, "grant must suspend with the agreement");
    const peerAfter = await prismaA.federatedNode.findUniqueOrThrow({ where: { id: peerId } });
    assert.equal(peerAfter.status, "proposed");
    // Stance resolves closed while suspended (and while the peer isn't active).
    assert.equal(await resolveFederatedStance(prismaA, groupId, { id: peerId, status: peerAfter.status }), "closed");

    // Re-federate: proposed-after-dissolve must behave as proposed-fresh, and
    // resume must key to the NEW agreement, not to peer status.
    const reopened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "Re-federate.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(reopened.ok, true);
    if (!reopened.ok) return;
    await pair.pump();
    await approveStewardPetition(pair.b, await stewardPetitionFor(pair.b, reopened.proposalId));
    await pair.pump();
    await approveStewardPetition(pair.a, reopened.petitionId);
    await pair.pump();

    const grantResumed = await prismaA.federatedVisibilityGrant.findUniqueOrThrow({
      where: { groupId_federatedNodeId: { groupId, federatedNodeId: peerId } },
    });
    assert.equal(grantResumed.suspendedAt, null, "grant must resume when federation re-forms");
    assert.equal(grantResumed.stance, "interactive", "the re-formed grant keeps its prior stance");
    assert.equal(await resolveFederatedStance(prismaA, groupId, { id: peerId, status: "active" }), "interactive");
  } finally {
    await cleanupSide(prismaA, "fv_susp");
    await cleanupSide(prismaB, "fv_susp");
  }
});

test("a visible (non-interactive) group is discoverable but refuses interaction", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fv_vis", { activate: true });
  try {
    const nodeA = await prismaA.node.findFirstOrThrow({ where: { domain: "fv_vis-a.example" } });
    const group = await prismaA.group.create({
      data: {
        id: "fv_vis_group",
        nodeId: nodeA.id,
        name: "Visible Not Interactive",
        membershipPolicy: "open",
        visibility: "public",
      },
    });
    const peerId = await activePeerId(pair);
    await prismaA.federatedVisibilityGrant.create({
      data: { groupId: group.id, federatedNodeId: peerId, stance: "visible" },
    });
    assert.equal(await resolveFederatedStance(prismaA, group.id, { id: peerId, status: "active" }), "visible");

    const established = await establishPresence(prismaB, { accountId: pair.b.stewardAccountId, peerDomain: pair.a.domain });
    assert.equal(established.ok, true);
    await pair.pump();
    const mediated = await mediateRemoteAction(prismaB, {
      accountId: pair.b.stewardAccountId,
      peerDomain: pair.a.domain,
      actionType: "join_open_group",
      action: { groupId: group.id },
    });
    assert.equal(mediated.ok, true);
    await pair.pump();
    const refusal = await prismaA.federationInboundEvent.findFirst({
      where: { eventType: "mediated_action", error: "group_not_interactive" },
    });
    assert.ok(refusal, "a merely-visible group must refuse interaction");
    assert.equal(await prismaA.groupMembership.count({ where: { groupId: group.id } }), 0);
  } finally {
    await cleanupSide(prismaA, "fv_vis");
    await cleanupSide(prismaB, "fv_vis");
  }
});
