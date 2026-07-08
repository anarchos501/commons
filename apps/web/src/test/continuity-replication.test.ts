import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { proposeBackupDesignation } from "../lib/continuity-establishment";
import { runContinuityReplicationSweep, buildStructuralManifest } from "../lib/continuity-replication";
import { ensureEscrowWrap, unwrapEscrowedIdentityKey } from "../lib/identity-escrow";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedPair,
  ensureSecondDatabase,
  type FederatedPair,
} from "./federation-fixtures";

// F3.5 Phase 2 — structural delta replication (register D-10): the manifest
// is skeleton-only, deltas flow only on change, the replica converges, and —
// load-bearing — hosting a replica changes NOTHING in the backup node's own
// community surfaces (no Group/Account rows, so no listing, no denominator,
// no notification fan-out).

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

async function establishBackup(pair: FederatedPair) {
  const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
  const proposed = await proposeBackupDesignation(prismaA, {
    groupId: pair.a.groupId!,
    peerNodeId: peer.id,
    windowHours: 24,
    directive: "reconstitute",
    createdByMembershipId: pair.a.stewardMembershipId!,
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  if (!proposed.ok) throw new Error("unreachable");
  await approveStewardPetition(pair.a, proposed.petitionId);
  await pair.pump();
  const replica = await prismaB.backupReplica.findFirstOrThrow({
    where: { entityType: "group", entityId: pair.a.groupId! },
  });
  assert.equal(replica.status, "active");
  return replica;
}

test("delta replication: manifest converges, no-change sweeps send zero bytes, stale replay is idempotent", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cr_delta", { activate: true });
  try {
    const replica = await establishBackup(pair);

    // First sweep carries the initial manifest.
    const first = await runContinuityReplicationSweep(prismaA);
    assert.equal(first.replicated, 1, JSON.stringify(first));
    await pair.pump();
    const groupName = (await prismaA.group.findUniqueOrThrow({ where: { id: pair.a.groupId! } })).name;
    let held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(held.manifestSeq, 1);
    const manifest = held.manifest as { name: string; memberCount: number; petitions: unknown[] };
    assert.equal(manifest.name, groupName);
    assert.equal(manifest.memberCount, 1);
    assert.equal(held.entityName, groupName);

    // Nothing changed: the sweep must send zero bytes.
    const outboxBefore = await prismaA.federationOutboxItem.count({ where: { eventType: "backup_delta" } });
    const second = await runContinuityReplicationSweep(prismaA);
    assert.equal(second.replicated, 0);
    assert.equal(second.skipped, 1);
    assert.equal(
      await prismaA.federationOutboxItem.count({ where: { eventType: "backup_delta" } }),
      outboxBefore,
      "no change must enqueue no delta",
    );

    // A structural change (rename) produces exactly one new delta; the
    // petition skeleton carries family/status, never content.
    await prismaA.group.update({ where: { id: pair.a.groupId! }, data: { name: "cr_delta renamed" } });
    const third = await runContinuityReplicationSweep(prismaA);
    assert.equal(third.replicated, 1);
    await pair.pump();
    held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(held.manifestSeq, 2);
    assert.equal(held.entityName, "cr_delta renamed");

    // Stale replay: re-deliver the seq-1 delta after seq-2 applied — the
    // handler must accept-and-ignore (idempotent ok), never regress.
    const { receiveFederationEnvelope } = await import("../lib/federation-inbox");
    const seq1 = await prismaA.federationOutboxItem.findFirstOrThrow({
      where: { eventType: "backup_delta" },
      orderBy: { createdAt: "asc" },
    });
    const envelope = JSON.parse(JSON.stringify(seq1.envelope));
    const replay = await receiveFederationEnvelope(prismaB, envelope, { localNode: pair.b.node });
    assert.equal(replay.outcome, "duplicate");
    held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(held.manifestSeq, 2, "stale delta must not regress the replica");
    assert.equal(held.entityName, "cr_delta renamed");

    // And past the dedupe layer: the handler's own stale-seq guard (a
    // re-signed old delta, new eventId) must accept-and-ignore.
    const { handleBackupDelta } = await import("../lib/continuity-replication");
    const originAtB = await prismaB.federatedNode.findUniqueOrThrow({ where: { domain: pair.a.domain } });
    const staleOutcome = await handleBackupDelta(prismaB, {
      origin: originAtB,
      envelope: { ...envelope, eventId: "cr_delta_restale" },
      localNode: pair.b.node,
    });
    assert.deepEqual(staleOutcome, { ok: true });
    held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(held.manifestSeq, 2);
    assert.equal(held.entityName, "cr_delta renamed");
  } finally {
    await cleanupSide(prismaA, "cr_delta");
    await cleanupSide(prismaB, "cr_delta");
  }
});

test("manifest is skeleton-only and escrow blobs ride the cannot-read tier", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cr_wall", { activate: true });
  try {
    // Give A's steward a password-wrapped identity so escrow entries exist.
    await prismaA.account.update({
      where: { id: pair.a.stewardAccountId },
      data: { passwordHash: "x" },
    });
    await ensureEscrowWrap(prismaA, { accountId: pair.a.stewardAccountId, password: "correct horse" });

    // Titles are the leak vector (D-10): a host-only event's title must be
    // omitted from the manifest; a public event's title may ride.
    const secret = "cr_wall SECRET meeting title that must never replicate";
    const eventBase = {
      category: "meeting",
      hostType: "group",
      hostId: pair.a.groupId!,
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 90_000_000),
      timezone: "UTC",
      createdByAccountId: pair.a.stewardAccountId,
    } as const;
    await prismaA.calendarEvent.create({
      data: { ...eventBase, id: "cr_wall_private_ev", title: secret, visibility: "host_only" },
    });
    await prismaA.calendarEvent.create({
      data: { ...eventBase, id: "cr_wall_public_ev", title: "cr_wall open assembly", visibility: "public" },
    });
    const manifest = await buildStructuralManifest(prismaA, { entityType: "group", entityId: pair.a.groupId! });
    assert.ok(manifest);
    assert.equal(JSON.stringify(manifest).includes("SECRET"), false);
    assert.ok(JSON.stringify(manifest).includes("cr_wall open assembly"));
    assert.equal(manifest!.calendar.length, 2);

    const replica = await establishBackup(pair);
    const sweep = await runContinuityReplicationSweep(prismaA);
    assert.equal(sweep.replicated, 1);
    await pair.pump();

    const held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(JSON.stringify(held.manifest).includes(secret), false);

    // Escrow entries arrived as ciphertext the backup cannot open without
    // the member's password — and CAN open with it (the stranded-login path).
    const entries = held.escrowEntries as Array<{ did: string; salt: string; wrapped: string }>;
    assert.ok(Array.isArray(entries) && entries.length === 1, JSON.stringify(held.escrowEntries));
    assert.throws(() => unwrapEscrowedIdentityKey("wrong password", entries[0]));
    const pem = unwrapEscrowedIdentityKey("correct horse", entries[0]);
    assert.ok(pem.includes("PRIVATE KEY"));

    // WALL-OFF (register F-8/D-10, load-bearing): hosting the replica created
    // no Group, no Account, no GroupMembership, no notification row on B —
    // the backup's own listings and quorum denominators are untouched by
    // construction, pinned here.
    assert.equal(await prismaB.group.count({ where: { nodeId: pair.b.node.id, id: { not: pair.b.groupId! } } }), 0);
    assert.equal(await prismaB.account.count({ where: { homeNodeId: pair.b.node.id } }), 1, "B still has exactly its own steward account");
    assert.equal(
      await prismaB.groupMembership.count({ where: { account: { homeNodeId: pair.b.node.id } } }),
      1,
      "B's denominator surfaces see only its own membership",
    );
    assert.equal(await prismaB.calendarEvent.count({ where: { id: { startsWith: "cr_wall" } } }), 0);
  } finally {
    await prismaA.calendarEvent.deleteMany({ where: { id: { startsWith: "cr_wall" } } });
    await cleanupSide(prismaA, "cr_wall");
    await cleanupSide(prismaB, "cr_wall");
  }
});
