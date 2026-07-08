import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import {
  proposeBackupDesignation,
  proposeBackupRevocation,
  proposeBackupSizeThreshold,
} from "../lib/continuity-establishment";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import { addNodePetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedPair,
  ensureSecondDatabase,
  type FederatedPair,
} from "./federation-fixtures";

// F3.5 Phase 1 — the consent matrix (register F-10): backup consent derives
// from the receiving node's registration mode; the threshold escalates, never
// refuses; stewardless nodes fail closed; federation is only the channel.

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

// A's steward group doubles as the designating collective; B is the backup.
async function designate(pair: FederatedPair, windowHours = 24, directive = "reconstitute") {
  const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
  const proposed = await proposeBackupDesignation(prismaA, {
    groupId: pair.a.groupId!,
    peerNodeId: peer.id,
    windowHours,
    directive,
    createdByMembershipId: pair.a.stewardMembershipId!,
  });
  return { peer, proposed };
}

async function approveDesignation(pair: FederatedPair, petitionId: string) {
  await approveStewardPetition(pair.a, petitionId);
  await pair.pump();
}

test("open node, no threshold: designation auto-accepts and both sides converge", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_open", { activate: true });
  try {
    const { proposed } = await designate(pair);
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;
    await approveDesignation(pair, proposed.petitionId);

    const backup = await prismaA.entityBackup.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
    });
    assert.equal(backup.status, "active");
    assert.equal(backup.directive, "reconstitute");
    assert.equal(backup.windowHours, 24);
    assert.ok(backup.verifiedAt, "fresh establishment is verified by construction");

    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "group", entityId: pair.a.groupId! },
    });
    assert.equal(replica.status, "active");
    assert.equal(replica.directive, "reconstitute");
    assert.equal(replica.memberCount, 1);
  } finally {
    await cleanupSide(prismaA, "ce_open");
    await cleanupSide(prismaB, "ce_open");
  }
});

test("open node over threshold: escalates to steward consent (never refuses); approval activates", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_thresh", { activate: true });
  try {
    // B's community sets a threshold of 0 → any arrival escalates.
    await prismaB.node.update({ where: { id: pair.b.node.id }, data: { backupMemberThreshold: 0 } });
    // Wait: threshold floor is 1 via petitions; set 1 and add a second member on A to exceed it.
    await prismaB.node.update({ where: { id: pair.b.node.id }, data: { backupMemberThreshold: 1 } });
    const extra = await prismaA.account.create({
      data: { id: "ce_thresh_extra", homeNodeId: pair.a.node.id, displayName: "Second", accountType: "participant" },
    });
    await prismaA.groupMembership.create({
      data: { id: "ce_thresh_extra_m", accountId: extra.id, groupId: pair.a.groupId!, status: "active", participationStatus: "active" },
    });

    const { proposed } = await designate(pair);
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    await approveDesignation(pair, proposed.petitionId);

    // Not active yet: a consent petition sits before B's stewards.
    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "group", entityId: pair.a.groupId! },
    });
    assert.equal(replica.status, "pending_consent");
    assert.ok(replica.consentPetitionId);
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "proposed",
    );

    await approveStewardPetition(pair.b, replica.consentPetitionId!);
    await pair.pump();

    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "active",
    );
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "active",
    );
  } finally {
    await cleanupSide(prismaA, "ce_thresh");
    await cleanupSide(prismaB, "ce_thresh");
  }
});

test("consent rejection refuses honestly; stewardless-over-threshold fails closed", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_refuse", { activate: true });
  try {
    await prismaB.node.update({ where: { id: pair.b.node.id }, data: { backupHostingPolicy: "approve_each", registrationMode: "invite_only" } });

    const { proposed } = await designate(pair);
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    await approveDesignation(pair, proposed.petitionId);
    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "group", entityId: pair.a.groupId! },
    });
    assert.equal(replica.status, "pending_consent");

    // Stewards reject → refusal crosses back.
    await prismaB.petition.update({
      where: { id: replica.consentPetitionId! },
      data: { closesAt: new Date(Date.now() - 1000) },
    });
    await evaluateAndApplyPetition(prismaB, replica.consentPetitionId!);
    await pair.pump();

    assert.equal((await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status, "refused");
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "refused",
    );

    // Stewardless gated node: fail closed with an honest refusal.
    await prismaB.node.update({ where: { id: pair.b.node.id }, data: { stewardGroupId: null } });
    const { proposed: again } = await designate(pair);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    await approveDesignation(pair, again.petitionId);
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "refused",
    );
  } finally {
    await cleanupSide(prismaA, "ce_refuse");
    await cleanupSide(prismaB, "ce_refuse");
  }
});

test("invite_only accept/refuse policy bits answer without petitions", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_policy", { activate: true });
  try {
    await prismaB.node.update({
      where: { id: pair.b.node.id },
      data: { registrationMode: "invite_only", backupHostingPolicy: "accept" },
    });
    const { proposed: first } = await designate(pair);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    await approveDesignation(pair, first.petitionId);
    assert.equal(
      (await prismaB.backupReplica.findFirstOrThrow({ where: { entityId: pair.a.groupId! } })).status,
      "active",
    );

    // Revoke, then retry against refuse policy.
    const peerId = (await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } })).id;
    const revoke = await proposeBackupRevocation(prismaA, {
      groupId: pair.a.groupId!,
      peerNodeId: peerId,
      createdByMembershipId: pair.a.stewardMembershipId!,
    });
    assert.equal(revoke.ok, true);
    if (!revoke.ok) return;
    await approveDesignation(pair, revoke.petitionId);
    assert.equal(
      (await prismaB.backupReplica.findFirstOrThrow({ where: { entityId: pair.a.groupId! } })).status,
      "ended",
    );

    await prismaB.node.update({ where: { id: pair.b.node.id }, data: { backupHostingPolicy: "refuse" } });
    const { proposed: second } = await designate(pair);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    await approveDesignation(pair, second.petitionId);
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "refused",
    );
  } finally {
    await cleanupSide(prismaA, "ce_policy");
    await cleanupSide(prismaB, "ce_policy");
  }
});

test("guards: no active agreement, invalid window/directive, duplicate designation", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_guard"); // proposed, not active
  try {
    const { proposed } = await designate(pair);
    assert.deepEqual(proposed, { ok: false, reason: "no_active_agreement" });

    await prismaA.federatedNode.update({ where: { domain: pair.b.domain }, data: { status: "active" } });
    const { proposed: badWindow } = await designate(pair, 0);
    assert.deepEqual(badWindow, { ok: false, reason: "invalid_window" });
    const { proposed: badDirective } = await designate(pair, 24, "resurrect");
    assert.deepEqual(badDirective, { ok: false, reason: "invalid_directive" });

    const { proposed: good } = await designate(pair);
    assert.equal(good.ok, true);
    if (!good.ok) return;
    // Second designation petition while one is open: the DB partial index is
    // the single-open invariant (register F-7).
    const { proposed: dup } = await designate(pair);
    assert.deepEqual(dup, { ok: false, reason: "petition_already_open" });
  } finally {
    await cleanupSide(prismaA, "ce_guard");
    await cleanupSide(prismaB, "ce_guard");
  }
});

test("duplicate establish requests are idempotent; threshold petition sets the node value", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ce_idem", { activate: true });
  try {
    const { proposed } = await designate(pair);
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    await approveDesignation(pair, proposed.petitionId);
    const outbox = await prismaA.federationOutboxItem.findFirstOrThrow({
      where: { eventType: "backup_establish_request" },
    });
    const replay = await receiveFederationEnvelope(prismaB, JSON.parse(JSON.stringify(outbox.envelope)), {
      localNode: pair.b.node,
    });
    assert.equal(replay.outcome, "duplicate");
    assert.equal(await prismaB.backupReplica.count({ where: { entityId: pair.a.groupId! } }), 1);

    // Node-wide threshold petition on B.
    const thresh = await proposeBackupSizeThreshold(prismaB, {
      nodeId: pair.b.node.id,
      value: 50,
      requestedByAccountId: pair.b.stewardAccountId,
    });
    assert.equal(thresh.ok, true);
    if (!thresh.ok) return;
    assert.equal(
      (await addNodePetitionSupport(prismaB, { petitionId: thresh.petitionId, accountId: pair.b.stewardAccountId })).ok,
      true,
    );
    await prismaB.petition.update({ where: { id: thresh.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prismaB, thresh.petitionId);
    assert.equal(
      (await prismaB.node.findUniqueOrThrow({ where: { id: pair.b.node.id } })).backupMemberThreshold,
      50,
    );
  } finally {
    await cleanupSide(prismaA, "ce_idem");
    await cleanupSide(prismaB, "ce_idem");
  }
});
