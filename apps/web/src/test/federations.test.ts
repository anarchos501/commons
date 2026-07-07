import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type {
  Federation,
  FederationMembership,
  FederationProposal,
  PrismaClient,
} from "../generated/prisma/client";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import {
  openFederationFormationProposal,
  resolveExpiredFederationProposals,
} from "../lib/federations";
import { proposeFederationTermination } from "../lib/federation-policy";
import { addNodePetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedPair,
  ensureSecondDatabase,
  rejectStewardPetition,
  stewardPetitionFor,
} from "./federation-fixtures";

// Cross-node mutual consent, exercised for real: two Prisma clients against
// two databases, wired by the in-memory transport (see federation-fixtures).

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

// ── Tests ─────────────────────────────────────────────────────────────────────

test("formation succeeds only on mutual consent and both databases converge", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_happy");
  try {
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      name: "Watershed alliance",
      content: "Our communities share a river.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    await pair.pump();

    // The proposal mirrored into B's steward queue.
    const mirrored = await prismaB.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(mirrored.action, "formation");
    const petitionB = await stewardPetitionFor(pair.b, opened.proposalId);

    // B approves first: B goes awaiting_remote, nothing is active anywhere.
    await approveStewardPetition(pair.b, petitionB);
    await pair.pump();
    const bAfterOwn = await prismaB.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(bAfterOwn.status, "awaiting_remote");
    assert.equal(await prismaB.federation.count({ where: { id: opened.proposalId } }), 0);

    // A approves: unanimity on both sides once the decisions cross.
    await approveStewardPetition(pair.a, opened.petitionId);
    await pair.pump();

    const perspectives: { client: PrismaClient; selfDomain: string; peerDomain: string }[] = [
      { client: prismaA, selfDomain: pair.a.domain, peerDomain: pair.b.domain },
      { client: prismaB, selfDomain: pair.b.domain, peerDomain: pair.a.domain },
    ];
    for (const view of perspectives) {
      const proposalRow: FederationProposal = await view.client.federationProposal.findUniqueOrThrow({
        where: { id: opened.proposalId },
      });
      assert.equal(proposalRow.status, "succeeded", `${view.selfDomain} proposal`);
      const federationRow: Federation & { memberships: FederationMembership[] } =
        await view.client.federation.findUniqueOrThrow({
          where: { id: opened.proposalId },
          include: { memberships: true },
        });
      assert.equal(federationRow.status, "active");
      assert.deepEqual(
        federationRow.memberships.map((membership) => membership.memberDomain).sort(),
        [pair.a.domain, pair.b.domain].sort(),
      );
      assert.equal(
        federationRow.memberships.find((membership) => membership.memberDomain === view.selfDomain)?.isSelf,
        true,
      );
      const peer = await view.client.federatedNode.findUniqueOrThrow({ where: { domain: view.peerDomain } });
      assert.equal(peer.status, "active", `${view.selfDomain}'s record of ${view.peerDomain}`);
    }
  } finally {
    await cleanupSide(prismaA, "fed_happy");
    await cleanupSide(prismaB, "fed_happy");
  }
});

test("either side's rejection fails the proposal on both sides; nothing activates", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_reject");
  try {
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "Proposal B will reject.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await pair.pump();

    await rejectStewardPetition(pair.b, await stewardPetitionFor(pair.b, opened.proposalId));
    await pair.pump();

    const onA = await prismaA.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(onA.status, "failed-rejected");
    // A's own still-open steward petition is superseded, not left dangling.
    const petitionA = await prismaA.petition.findUniqueOrThrow({ where: { id: opened.petitionId } });
    assert.equal(petitionA.status, "superseded");
    assert.equal(await prismaA.federation.count({ where: { id: opened.proposalId } }), 0);
    assert.equal(await prismaB.federation.count({ where: { id: opened.proposalId } }), 0);
  } finally {
    await cleanupSide(prismaA, "fed_reject");
    await cleanupSide(prismaB, "fed_reject");
  }
});

test("no steward collective fails closed in BOTH directions (register F-5)", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_nosteward", { stewardB: false });
  try {
    // Outbound: a stewardless node cannot even open a proposal.
    const fromB = await openFederationFormationProposal(prismaB, {
      nodeId: pair.b.node.id,
      peerDomain: pair.a.domain,
      content: "We have no stewards.",
      requestedByAccountId: pair.b.stewardAccountId,
    });
    assert.deepEqual(fromB, { ok: false, reason: "no_steward_group" });

    // Inbound: a proposal TO a stewardless node draws a signed refusal, not a
    // silent timeout.
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "Hello, stewardless node.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await pair.pump();

    const onA = await prismaA.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(onA.status, "failed-rejected");
    const decisions = onA.decisions as Record<string, string>;
    assert.equal(decisions[pair.b.domain], "rejected");
    // B never mirrored the proposal into a steward queue it doesn't have.
    assert.equal(await prismaB.federationProposal.count({ where: { id: opened.proposalId } }), 0);
  } finally {
    await cleanupSide(prismaA, "fed_nosteward");
    await cleanupSide(prismaB, "fed_nosteward");
  }
});

test("remote silence times out via the proposal sweep", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_timeout");
  try {
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "B will never answer.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    // Deliberately no pump: B never even receives it. A approves its side.
    await approveStewardPetition(pair.a, opened.petitionId);

    await prismaA.federationProposal.update({
      where: { id: opened.proposalId },
      data: { closesAt: new Date(Date.now() - 1000) },
    });
    const swept = await resolveExpiredFederationProposals(prismaA);
    assert.ok(swept.resolved >= 1);
    const proposal = await prismaA.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.status, "failed-timeout");
  } finally {
    await cleanupSide(prismaA, "fed_timeout");
    await cleanupSide(prismaB, "fed_timeout");
  }
});

test("replayed decision events are deduped and cannot change a terminal outcome", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_replay");
  try {
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "Replay test.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await pair.pump();
    await rejectStewardPetition(pair.b, await stewardPetitionFor(pair.b, opened.proposalId));

    // Capture B's decision envelope before delivery, deliver it twice.
    const outbox = await prismaB.federationOutboxItem.findFirstOrThrow({
      where: { eventType: "federation_proposal_decision", status: "pending" },
    });
    const envelope = outbox.envelope as object;
    const first = await receiveFederationEnvelope(prismaA, JSON.parse(JSON.stringify(envelope)), {
      localNode: pair.a.node,
    });
    assert.equal(first.outcome, "applied");
    const replay = await receiveFederationEnvelope(prismaA, JSON.parse(JSON.stringify(envelope)), {
      localNode: pair.a.node,
    });
    assert.equal(replay.outcome, "duplicate");

    const proposal = await prismaA.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(proposal.status, "failed-rejected");
  } finally {
    await cleanupSide(prismaA, "fed_replay");
    await cleanupSide(prismaB, "fed_replay");
  }
});

test("a node-wide termination vote ends the agreement on both sides", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "fed_term");
  try {
    // Form the agreement first.
    const opened = await openFederationFormationProposal(prismaA, {
      nodeId: pair.a.node.id,
      peerDomain: pair.b.domain,
      content: "To be terminated.",
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await pair.pump();
    await approveStewardPetition(pair.b, await stewardPetitionFor(pair.b, opened.proposalId));
    await pair.pump();
    await approveStewardPetition(pair.a, opened.petitionId);
    await pair.pump();
    assert.equal(
      (await prismaA.federation.findUniqueOrThrow({ where: { id: opened.proposalId } })).status,
      "active",
    );

    // Any member opens the node-wide STOP valve on A; the whole node votes.
    const stop = await proposeFederationTermination(prismaA, {
      nodeId: pair.a.node.id,
      federationId: opened.proposalId,
      requestedByAccountId: pair.a.stewardAccountId,
    });
    assert.equal(stop.ok, true);
    if (!stop.ok) return;
    const supported = await addNodePetitionSupport(prismaA, {
      petitionId: stop.petitionId,
      accountId: pair.a.stewardAccountId,
    });
    assert.equal(supported.ok, true);
    await prismaA.petition.update({ where: { id: stop.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prismaA, stop.petitionId);
    await pair.pump();

    const clients: PrismaClient[] = [prismaA, prismaB];
    for (const client of clients) {
      const federationRow: Federation & { memberships: FederationMembership[] } =
        await client.federation.findUniqueOrThrow({
          where: { id: opened.proposalId },
          include: { memberships: true },
        });
      assert.equal(federationRow.status, "dissolved");
      assert.ok(federationRow.memberships.every((membership) => membership.endedAt !== null));
    }
    // The agreement ends but the PIN survives: each side's record of the
    // other demotes to proposed (still known, can re-federate) — severing the
    // pin entirely would have dead-lettered the goodbye notice itself.
    assert.equal(
      (await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } })).status,
      "proposed",
    );
    assert.equal(
      (await prismaB.federatedNode.findUniqueOrThrow({ where: { domain: pair.a.domain } })).status,
      "proposed",
    );
  } finally {
    await cleanupSide(prismaA, "fed_term");
    await cleanupSide(prismaB, "fed_term");
  }
});
