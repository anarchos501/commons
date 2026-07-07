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
import { ensureNodeKeyPair } from "../lib/node-keys";
import { addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";

// Shared two-database fixture for cross-node federation tests: node A and
// node B each live in their own database; only signed envelopes cross,
// carried by the in-memory transport (the plan's standard test pattern).

const SECOND_DB_NAME = "commons_federation_test_b";

export function secondDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL required for federation tests");
  const url = new URL(baseUrl);
  url.pathname = `/${SECOND_DB_NAME}`;
  return url.toString();
}

export async function ensureSecondDatabase(): Promise<string> {
  const baseUrl = process.env.DATABASE_URL!;
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
  const url = secondDatabaseUrl();
  execSync("node node_modules/prisma/build/index.js migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  return url;
}

export type Side = {
  prisma: PrismaClient;
  node: Node;
  domain: string;
  stewardMembershipId: string | null;
  stewardAccountId: string;
};

export type FederatedPair = { a: Side; b: Side; transport: FederationTransport; pump: () => Promise<void> };

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
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  // Shadow accounts are homed on peer Node rows created by presence flows;
  // their ids are cuids, so remove them via the identity linkage.
  await prisma.account.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { homeNode: { domain: { startsWith: prefix }, id: { not: { startsWith: prefix } } } },
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
