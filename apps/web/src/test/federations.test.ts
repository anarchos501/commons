import "dotenv/config";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test, { before, after } from "node:test";
import { Client } from "pg";
import type { Node, PrismaClient } from "../generated/prisma/client";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import {
  createInMemoryFederationTransport,
  deliverPendingFederationEvents,
  type FederationTransport,
} from "../lib/federation-outbox";
import {
  openFederationFormationProposal,
  resolveExpiredFederationProposals,
} from "../lib/federations";
import { proposeFederationTermination } from "../lib/federation-policy";
import { ensureNodeKeyPair } from "../lib/node-keys";
import { addNodePetitionSupport, addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";

// Cross-node mutual consent, exercised for real: two Prisma clients against
// two databases, wired by the in-memory transport — the plan's standard
// pattern for all federation tests. Node A and node B each hold their own
// proposal row and steward petition; only signed events cross between them.

const SECOND_DB_NAME = "commons_federation_test_b";
const baseUrl = process.env.DATABASE_URL!;
const secondUrl = (() => {
  const url = new URL(baseUrl);
  url.pathname = `/${SECOND_DB_NAME}`;
  return url.toString();
})();

let prismaA: PrismaClient;
let prismaB: PrismaClient;

before(async () => {
  const admin = new URL(baseUrl);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [SECOND_DB_NAME]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${SECOND_DB_NAME}"`);
  } finally {
    await client.end();
  }
  execSync("node node_modules/prisma/build/index.js migrate deploy", {
    env: { ...process.env, DATABASE_URL: secondUrl },
    stdio: "ignore",
  });
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
});

type Side = {
  prisma: PrismaClient;
  node: Node;
  domain: string;
  stewardMembershipId: string | null;
  stewardAccountId: string;
};

type Pair = { a: Side; b: Side; transport: FederationTransport; pump: () => Promise<void> };

// Each side gets a node, an account, and (optionally) a public steward group
// with that account as its sole member; then each side pins the other's real
// signing key — the state /.well-known pinning would have produced.
async function createPair(prefix: string, options: { stewardB?: boolean } = {}): Promise<Pair> {
  await cleanupSide(prismaA, prefix);
  await cleanupSide(prismaB, prefix);

  const a = await createSide(prismaA, prefix, "a", true);
  const b = await createSide(prismaB, prefix, "b", options.stewardB ?? true);

  const keyA = await ensureNodeKeyPair(prismaA, a.node.id);
  const keyB = await ensureNodeKeyPair(prismaB, b.node.id);
  await prismaA.federatedNode.create({
    data: { domain: b.domain, publicKey: keyB.publicKey, displayName: `${prefix} B` },
  });
  await prismaB.federatedNode.create({
    data: { domain: a.domain, publicKey: keyA.publicKey, displayName: `${prefix} A` },
  });

  const sides: Record<string, Side> = { [a.domain]: a, [b.domain]: b };
  const transport = createInMemoryFederationTransport(async (domain, envelope) => {
    const side = sides[domain];
    if (!side) return { ok: false, retryable: false, error: "unknown_test_domain" };
    const outcome = await receiveFederationEnvelope(
      side.prisma,
      JSON.parse(JSON.stringify(envelope)),
      { localNode: side.node },
    );
    return outcome.outcome === "applied" || outcome.outcome === "duplicate"
      ? { ok: true }
      : { ok: false, retryable: false, error: outcome.reason };
  });

  // Drains both outboxes until quiescent (far-future clock bypasses backoff).
  const pump = async () => {
    for (let round = 0; round < 6; round += 1) {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const [fromA, fromB] = [
        await deliverPendingFederationEvents(prismaA, transport, { now: future }),
        await deliverPendingFederationEvents(prismaB, transport, { now: future }),
      ];
      if (fromA.attempted === 0 && fromB.attempted === 0) return;
    }
  };

  return { a, b, transport, pump };
}

async function createSide(prisma: PrismaClient, prefix: string, suffix: string, withSteward: boolean): Promise<Side> {
  const domain = `${prefix}-${suffix}.example`;
  const node = await prisma.node.create({
    data: { id: `${prefix}_node_${suffix}`, name: `${prefix} ${suffix}`, domain, federationPolicy: "allowlisted" },
  });
  const account = await prisma.account.create({
    data: {
      id: `${prefix}_account_${suffix}`,
      homeNodeId: node.id,
      displayName: `Steward ${suffix}`,
      accountType: "participant",
    },
  });
  let stewardMembershipId: string | null = null;
  if (withSteward) {
    const group = await prisma.group.create({
      data: {
        id: `${prefix}_steward_${suffix}`,
        nodeId: node.id,
        name: `${prefix} stewards ${suffix}`,
        membershipPolicy: "open",
        visibility: "public",
      },
    });
    const membership = await prisma.groupMembership.create({
      data: {
        id: `${prefix}_membership_${suffix}`,
        accountId: account.id,
        groupId: group.id,
        status: "active",
        participationStatus: "active",
      },
    });
    stewardMembershipId = membership.id;
    await prisma.node.update({ where: { id: node.id }, data: { stewardGroupId: group.id } });
  }
  const fresh = await prisma.node.findUniqueOrThrow({ where: { id: node.id } });
  return { prisma, node: fresh, domain, stewardMembershipId, stewardAccountId: account.id };
}

async function approveStewardPetition(side: Side, petitionId: string) {
  const membership = await side.prisma.groupMembership.findFirstOrThrow({
    where: { id: side.stewardMembershipId! },
    select: { id: true, accountId: true },
  });
  const supported = await addPetitionSupport(side.prisma, {
    petitionId,
    actorAccountId: membership.accountId,
    membershipId: membership.id,
  });
  assert.equal(supported.ok, true);
  await side.prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(side.prisma, petitionId);
}

async function rejectStewardPetition(side: Side, petitionId: string) {
  // No support + past close ⇒ rejected on evaluation.
  await side.prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(side.prisma, petitionId);
}

async function stewardPetitionFor(side: Side, proposalId: string): Promise<string> {
  const link = await side.prisma.federationProposalPetition.findFirstOrThrow({
    where: { proposalId },
    select: { petitionId: true },
  });
  return link.petitionId;
}

async function cleanupSide(prisma: PrismaClient, prefix: string) {
  await prisma.federationProposal.deleteMany({ where: { initiatedByDomain: { startsWith: prefix } } });
  await prisma.federation.deleteMany({
    where: { memberships: { some: { memberDomain: { startsWith: prefix } } } },
  });
  await prisma.federatedNode.deleteMany({ where: { domain: { startsWith: prefix } } });
  await prisma.nodePetitionSupport.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.petitionSupport.deleteMany({
    where: { petition: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] } },
  });
  await prisma.petition.deleteMany({
    where: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] },
  });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("formation succeeds only on mutual consent and both databases converge", async () => {
  const pair = await createPair("fed_happy");
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

    for (const [prisma, selfDomain, peerDomain] of [
      [prismaA, pair.a.domain, pair.b.domain],
      [prismaB, pair.b.domain, pair.a.domain],
    ] as const) {
      const proposal = await prisma.federationProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
      assert.equal(proposal.status, "succeeded", `${selfDomain} proposal`);
      const federation = await prisma.federation.findUniqueOrThrow({
        where: { id: opened.proposalId },
        include: { memberships: true },
      });
      assert.equal(federation.status, "active");
      assert.deepEqual(
        federation.memberships.map((m) => m.memberDomain).sort(),
        [pair.a.domain, pair.b.domain].sort(),
      );
      assert.equal(federation.memberships.find((m) => m.memberDomain === selfDomain)?.isSelf, true);
      const peer = await prisma.federatedNode.findUniqueOrThrow({ where: { domain: peerDomain } });
      assert.equal(peer.status, "active", `${selfDomain}'s record of ${peerDomain}`);
    }
  } finally {
    await cleanupSide(prismaA, "fed_happy");
    await cleanupSide(prismaB, "fed_happy");
  }
});

test("either side's rejection fails the proposal on both sides; nothing activates", async () => {
  const pair = await createPair("fed_reject");
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
  const pair = await createPair("fed_nosteward", { stewardB: false });
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
  const pair = await createPair("fed_timeout");
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
  const pair = await createPair("fed_replay");
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
  const pair = await createPair("fed_term");
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

    for (const prisma of [prismaA, prismaB]) {
      const federation = await prisma.federation.findUniqueOrThrow({
        where: { id: opened.proposalId },
        include: { memberships: true },
      });
      assert.equal(federation.status, "dissolved");
      assert.ok(federation.memberships.every((m) => m.endedAt !== null));
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
