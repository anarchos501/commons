import "dotenv/config";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { Client } from "pg";
import type { Node, PrismaClient } from "../generated/prisma/client";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import {
  createInMemoryFederationTransport,
  deliverPendingFederationEvents,
  type FederationTransport,
} from "../lib/federation-outbox";
import type { FederationEnvelope } from "../lib/federation-envelope";
import { ensureNodeKeyPair } from "../lib/node-keys";
import { addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";

// Shared two-database fixture for cross-node federation tests: node A and
// node B each live in their own database; only signed envelopes cross,
// carried by the in-memory transport (the plan's standard test pattern).

const SECOND_DB_NAME = "commons_federation_test_b";
const THIRD_DB_NAME = "commons_federation_test_c";

function testDatabaseUrl(name: string): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL required for federation tests");
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function ensureTestDatabase(name: string): Promise<string> {
  const baseUrl = process.env.DATABASE_URL!;
  const admin = new URL(baseUrl);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  const url = testDatabaseUrl(name);
  execSync("node node_modules/prisma/build/index.js migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  return url;
}

export async function ensureSecondDatabase(): Promise<string> {
  return ensureTestDatabase(SECOND_DB_NAME);
}

export async function ensureThirdDatabase(): Promise<string> {
  return ensureTestDatabase(THIRD_DB_NAME);
}

export type Side = {
  prisma: PrismaClient;
  node: Node;
  domain: string;
  stewardMembershipId: string | null;
  stewardAccountId: string;
  groupId: string | null;
};

export type TransportCuts = {
  // Total isolation: nothing to or from this domain gets through.
  cut: (domain: string) => void;
  restore: (domain: string) => void;
  // Directed-pair cut: only the X↔Y link fails (for relay-path tests).
  cutLink: (x: string, y: string) => void;
  restoreLink: (x: string, y: string) => void;
};

function createTransportCuts() {
  const cutDomains = new Set<string>();
  const cutLinks = new Set<string>();
  const linkKey = (x: string, y: string) => [x, y].sort().join("|");
  const cuts: TransportCuts = {
    cut: (domain) => void cutDomains.add(domain),
    restore: (domain) => void cutDomains.delete(domain),
    cutLink: (x, y) => void cutLinks.add(linkKey(x, y)),
    restoreLink: (x, y) => void cutLinks.delete(linkKey(x, y)),
  };
  // Cuts model the NETWORK, so they key on the sending node (whose outbox is
  // delivering), never the envelope's logical origin — a relayed envelope
  // keeps its origin while traveling a different road.
  const isCut = (targetDomain: string, senderDomain: string) =>
    cutDomains.has(targetDomain) || cutDomains.has(senderDomain) || cutLinks.has(linkKey(targetDomain, senderDomain));
  return { cuts, isCut };
}

export type FederatedPair = { a: Side; b: Side; transport: FederationTransport; pump: () => Promise<void> } & TransportCuts;

// Each side gets a node, an account, and (optionally) a public steward group
// with that account as its sole member; then each side pins the other's real
// signing key — the state /.well-known pinning would have produced. With
// options.activate, both pins are flipped to active (the post-agreement
// state), for tests that start from an established federation.
export async function createFederatedPair(
  prismaA: PrismaClient,
  prismaB: PrismaClient,
  prefix: string,
  options: { stewardB?: boolean; activate?: boolean } = {},
): Promise<FederatedPair> {
  await cleanupSide(prismaA, prefix);
  await cleanupSide(prismaB, prefix);

  const a = await createSide(prismaA, prefix, "a", true);
  const b = await createSide(prismaB, prefix, "b", options.stewardB ?? true);

  const keyA = await ensureNodeKeyPair(prismaA, a.node.id);
  const keyB = await ensureNodeKeyPair(prismaB, b.node.id);
  const status = options.activate ? "active" : "proposed";
  await prismaA.federatedNode.create({
    data: { domain: b.domain, publicKey: keyB.publicKey, displayName: `${prefix} B`, status },
  });
  await prismaB.federatedNode.create({
    data: { domain: a.domain, publicKey: keyA.publicKey, displayName: `${prefix} A`, status },
  });

  const sides: Record<string, Side> = { [a.domain]: a, [b.domain]: b };
  const { cuts, isCut } = createTransportCuts();
  const receiveAt = async (domain: string, envelope: FederationEnvelope) => {
    const side = sides[domain];
    if (!side) return { ok: false as const, retryable: false, error: "unknown_test_domain" };
    // Re-read the node per delivery — production resolves the current node
    // per request, so mid-test changes (registration mode, thresholds,
    // steward) must be visible to handlers.
    const freshNode = await side.prisma.node.findUniqueOrThrow({ where: { id: side.node.id } });
    const outcome = await receiveFederationEnvelope(
      side.prisma,
      JSON.parse(JSON.stringify(envelope)),
      { localNode: freshNode },
    );
    return outcome.outcome === "applied" || outcome.outcome === "duplicate"
      ? { ok: true as const }
      : { ok: false as const, retryable: false, error: outcome.reason };
  };
  const transportFrom = (senderDomain: string) =>
    createInMemoryFederationTransport(async (domain, envelope) => {
      if (isCut(domain, senderDomain)) return { ok: false, retryable: true, error: "transport_cut" };
      return receiveAt(domain, envelope);
    });
  const transport = createInMemoryFederationTransport(receiveAt);

  // Drains both outboxes until quiescent (far-future clock bypasses backoff).
  const pump = async () => {
    for (let round = 0; round < 6; round += 1) {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const [fromA, fromB] = [
        await deliverPendingFederationEvents(prismaA, transportFrom(a.domain), { now: future }),
        await deliverPendingFederationEvents(prismaB, transportFrom(b.domain), { now: future }),
      ];
      if (fromA.attempted === 0 && fromB.attempted === 0) return;
    }
  };

  return { a, b, transport, pump, ...cuts };
}

export type FederatedTriad = {
  a: Side;
  b: Side;
  c: Side;
  pump: () => Promise<void>;
} & TransportCuts;

// Hub topology (A4): A holds ACTIVE agreements with B and with C; B and C
// hold NO pin of each other at all — any content that crosses B→C can only
// have traveled via the hub.
export async function createFederatedTriad(
  prismaA: PrismaClient,
  prismaB: PrismaClient,
  prismaC: PrismaClient,
  prefix: string,
  options: { mesh?: boolean } = {},
): Promise<FederatedTriad> {
  await cleanupSide(prismaA, prefix);
  await cleanupSide(prismaB, prefix);
  await cleanupSide(prismaC, prefix);

  const a = await createSide(prismaA, prefix, "a", true);
  const b = await createSide(prismaB, prefix, "b", true);
  const c = await createSide(prismaC, prefix, "c", true);

  const keyA = await ensureNodeKeyPair(prismaA, a.node.id);
  const keyB = await ensureNodeKeyPair(prismaB, b.node.id);
  const keyC = await ensureNodeKeyPair(prismaC, c.node.id);
  await prismaA.federatedNode.create({ data: { domain: b.domain, publicKey: keyB.publicKey, status: "active" } });
  await prismaA.federatedNode.create({ data: { domain: c.domain, publicKey: keyC.publicKey, status: "active" } });
  await prismaB.federatedNode.create({ data: { domain: a.domain, publicKey: keyA.publicKey, status: "active" } });
  await prismaC.federatedNode.create({ data: { domain: a.domain, publicKey: keyA.publicKey, status: "active" } });
  if (options.mesh) {
    // Full mesh (the continuity-lease topology): B and C also pin each other.
    await prismaB.federatedNode.create({ data: { domain: c.domain, publicKey: keyC.publicKey, status: "active" } });
    await prismaC.federatedNode.create({ data: { domain: b.domain, publicKey: keyB.publicKey, status: "active" } });
  }

  const sides: Record<string, Side> = { [a.domain]: a, [b.domain]: b, [c.domain]: c };
  const { cuts, isCut } = createTransportCuts();
  const receiveAt = async (domain: string, envelope: FederationEnvelope) => {
    const side = sides[domain];
    if (!side) return { ok: false as const, retryable: false, error: "unknown_test_domain" };
    const freshNode = await side.prisma.node.findUniqueOrThrow({ where: { id: side.node.id } });
    const outcome = await receiveFederationEnvelope(
      side.prisma,
      JSON.parse(JSON.stringify(envelope)),
      { localNode: freshNode },
    );
    return outcome.outcome === "applied" || outcome.outcome === "duplicate"
      ? { ok: true as const }
      : { ok: false as const, retryable: false, error: outcome.reason };
  };
  const transportFrom = (senderDomain: string) =>
    createInMemoryFederationTransport(async (domain, envelope) => {
      if (isCut(domain, senderDomain)) return { ok: false, retryable: true, error: "transport_cut" };
      return receiveAt(domain, envelope);
    });

  const pump = async () => {
    for (let round = 0; round < 8; round += 1) {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const results = [
        await deliverPendingFederationEvents(prismaA, transportFrom(a.domain), { now: future }),
        await deliverPendingFederationEvents(prismaB, transportFrom(b.domain), { now: future }),
        await deliverPendingFederationEvents(prismaC, transportFrom(c.domain), { now: future }),
      ];
      if (results.every((result) => result.attempted === 0)) return;
    }
  };

  return { a, b, c, pump, ...cuts };
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
  return {
    prisma,
    node: fresh,
    domain,
    stewardMembershipId,
    stewardAccountId: account.id,
    groupId: withSteward ? `${prefix}_steward_${suffix}` : null,
  };
}

export async function approveStewardPetition(side: Side, petitionId: string) {
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

export async function rejectStewardPetition(side: Side, petitionId: string) {
  // No support + past close ⇒ rejected on evaluation.
  await side.prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(side.prisma, petitionId);
}

export async function stewardPetitionFor(side: Side, proposalId: string): Promise<string> {
  const link = await side.prisma.federationProposalPetition.findFirstOrThrow({
    where: { proposalId },
    select: { petitionId: true },
  });
  return link.petitionId;
}

export async function cleanupSide(prisma: PrismaClient, prefix: string) {
  await prisma.entityBackup.deleteMany({
    where: { OR: [{ peer: { domain: { startsWith: prefix } } }, { entityId: { startsWith: prefix } }] },
  });
  await prisma.backupReplica.deleteMany({
    where: { OR: [{ origin: { domain: { startsWith: prefix } } }, { entityId: { startsWith: prefix } }] },
  });
  await prisma.federatedCoalitionMessage.deleteMany({
    where: { presence: { OR: [{ group: { nodeId: { startsWith: prefix } } }, { homeFederatedNode: { domain: { startsWith: prefix } } }] } },
  });
  await prisma.federatedCoalitionPresence.deleteMany({
    where: { OR: [{ group: { nodeId: { startsWith: prefix } } }, { homeFederatedNode: { domain: { startsWith: prefix } } }] },
  });
  await prisma.coalitionMembership.deleteMany({
    where: {
      OR: [
        { coalition: { nodeId: { startsWith: prefix } } },
        { federatedGroupPresence: { federatedNode: { domain: { startsWith: prefix } } } },
      ],
    },
  });
  await prisma.discussionMessage.deleteMany({
    where: { thread: { spaceType: "coalition", spaceId: { in: (await prisma.coalition.findMany({ where: { nodeId: { startsWith: prefix } }, select: { id: true } })).map((coalition) => coalition.id) } } },
  });
  await prisma.discussionThread.deleteMany({
    where: { spaceType: "coalition", spaceId: { in: (await prisma.coalition.findMany({ where: { nodeId: { startsWith: prefix } }, select: { id: true } })).map((coalition) => coalition.id) } },
  });
  await prisma.coalitionProposalPetition.deleteMany({
    where: { OR: [{ group: { nodeId: { startsWith: prefix } } }, { proposal: { proposedByGroup: { nodeId: { startsWith: prefix } } } }] },
  });
  await prisma.coalitionProposal.deleteMany({ where: { proposedByGroup: { nodeId: { startsWith: prefix } } } });
  await prisma.coalition.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.federatedGroupPresence.deleteMany({ where: { federatedNode: { domain: { startsWith: prefix } } } });
  await prisma.federationProposal.deleteMany({ where: { initiatedByDomain: { startsWith: prefix } } });
  await prisma.federation.deleteMany({
    where: { memberships: { some: { memberDomain: { startsWith: prefix } } } },
  });
  await prisma.federatedNode.deleteMany({ where: { domain: { startsWith: prefix } } });
  await prisma.signedEvent.deleteMany({ where: { node: { id: { startsWith: prefix } } } });
  await prisma.linkedNodePresence.deleteMany({
    where: { OR: [{ nodeId: { startsWith: prefix } }, { homeNodeDomain: { startsWith: prefix } }] },
  });
  await prisma.nodePetitionSupport.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.petitionSupport.deleteMany({
    where: { petition: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] } },
  });
  await prisma.petition.deleteMany({
    where: { OR: [{ scopeId: { startsWith: prefix } }, { group: { nodeId: { startsWith: prefix } } }] },
  });
  await prisma.actionLog.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  // Group-space discussion threads (e.g. the F3.5 "Failover annex") hold FKs
  // to prefix accounts — remove them before the accounts go. Key on BOTH the
  // space and the creator/author (a partially-failed earlier cleanup can
  // leave a thread whose group is already gone).
  const prefixGroupIds = (
    await prisma.group.findMany({ where: { nodeId: { startsWith: prefix } }, select: { id: true } })
  ).map((group) => group.id);
  await prisma.discussionMessage.deleteMany({
    where: {
      OR: [
        { thread: { spaceType: "group", spaceId: { in: prefixGroupIds } } },
        { thread: { creator: { homeNode: { id: { startsWith: prefix } } } } },
        { author: { homeNode: { id: { startsWith: prefix } } } },
      ],
    },
  });
  await prisma.discussionThread.deleteMany({
    where: {
      OR: [
        { spaceType: "group", spaceId: { in: prefixGroupIds } },
        { creator: { homeNode: { id: { startsWith: prefix } } } },
      ],
    },
  });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  // Shadow accounts are homed on peer Node rows created by presence flows;
  // their ids are cuids, so remove them via the identity linkage.
  await prisma.account.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { homeNode: { domain: { startsWith: prefix }, id: { not: { startsWith: prefix } } } },
        // Cuid-id system accounts homed on prefix nodes (e.g. the F3.5
        // "Failover annex" author).
        { homeNode: { id: { startsWith: prefix } } },
      ],
    },
  });
  await prisma.portableIdentity.deleteMany({
    where: { linkedNodePresences: { none: {} }, accounts: { none: {} } },
  });
  await prisma.node.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { domain: { startsWith: prefix } }] },
  });
}
