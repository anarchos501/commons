import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { resolveWriteAuthority, runContinuityHeartbeat } from "../lib/continuity";
import { proposeBackupDesignation, proposeBackupRevocation } from "../lib/continuity-establishment";
import { openTakeoverChallenge } from "../lib/continuity-lease";
import { addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedPair,
  createFederatedTriad,
  ensureSecondDatabase,
  ensureThirdDatabase,
  type FederatedPair,
  type FederatedTriad,
} from "./federation-fixtures";

// F3.5 Phase 3 — the lease clock (register F-9). Every scenario injects its
// own {now} — deliberately skewed between the two sides where both clocks
// matter, because the safety claim is "W ≥ 1h dominates skew", and that must
// be exercised, not assumed. Life is provable; death is not: a challenge is
// cancelled by ANY signed proof — direct, relayed, or witnessed — and one
// witness of life blocks.

let prismaA: PrismaClient;
let prismaB: PrismaClient;
let prismaC: PrismaClient;

before(async () => {
  const secondUrl = await ensureSecondDatabase();
  const thirdUrl = await ensureThirdDatabase();
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
  prismaC = createPrismaClient(thirdUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
  await prismaC?.$disconnect();
});

async function designate(pair: FederatedPair | FederatedTriad, windowHours = 24) {
  const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
  const proposed = await proposeBackupDesignation(prismaA, {
    groupId: pair.a.groupId!,
    peerNodeId: peer.id,
    windowHours,
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

// Set A's federation contact (all pins) to an exact instant.
async function setContact(at: Date | null) {
  await prismaA.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
}

test("write authority: lease states, mirror self-demotion by own (skewed) clock, restore", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cl_lease", { activate: true });
  try {
    const group = { entityType: "group", entityId: pair.a.groupId! };
    // State 1 — no backup: writable, zero machinery, regardless of contact.
    await setContact(null);
    assert.equal(await resolveWriteAuthority(prismaA, group), "writable");

    await designate(pair, 24);
    const backup = await prismaA.entityBackup.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
    });

    // Fresh contact: writable. B's clock is deliberately skewed 20 minutes
    // ahead — irrelevant, because A demotes by its OWN clock only.
    const t0 = new Date("2026-07-09T12:00:00Z");
    await setContact(t0);
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: new Date(t0.getTime() + 60_000) }), "writable");

    // 23h59m of silence: still writable (W prices SUSTAINED silence).
    assert.equal(
      await resolveWriteAuthority(prismaA, group, { now: new Date(t0.getTime() + (24 * 60 - 1) * 60_000) }),
      "writable",
    );
    // 24h01m: read-only by A's own clock — the mirror rule. No daemon ran;
    // the answer changed because time passed.
    const past = new Date(t0.getTime() + (24 * 60 + 1) * 60_000);
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: past }), "read_only");

    // Contact restored (a peer delivery landed): writable again, instantly.
    await setContact(past);
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: new Date(past.getTime() + 60_000) }), "writable");

    // Quiet-boot marker: verifiedAt NULL beats everything else.
    await prismaA.entityBackup.update({ where: { id: backup.id }, data: { verifiedAt: null } });
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: past }), "unverified");
    await prismaA.entityBackup.update({ where: { id: backup.id }, data: { verifiedAt: t0 } });

    // Known remote takeover: read-only even with fresh contact.
    await prismaA.entityBackup.update({ where: { id: backup.id }, data: { takeoverState: "remote_active" } });
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: new Date(past.getTime() + 60_000) }), "read_only");
    await prismaA.entityBackup.update({ where: { id: backup.id }, data: { takeoverState: "none" } });
  } finally {
    await cleanupSide(prismaA, "cl_lease");
    await cleanupSide(prismaB, "cl_lease");
  }
});

test("resolver gate: a lapsed lease leaves due petitions pending and untouched; restore resolves them", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cl_gate", { activate: true });
  try {
    await designate(pair, 24);
    const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });

    // A revocation petition on the backed-up group, supported and due.
    const revoke = await proposeBackupRevocation(prismaA, {
      groupId: pair.a.groupId!,
      peerNodeId: peer.id,
      createdByMembershipId: pair.a.stewardMembershipId!,
    });
    assert.equal(revoke.ok, true);
    if (!revoke.ok) return;
    const supported = await addPetitionSupport(prismaA, {
      petitionId: revoke.petitionId,
      actorAccountId: pair.a.stewardAccountId,
      membershipId: pair.a.stewardMembershipId!,
    });
    assert.equal(supported.ok, true);
    await prismaA.petition.update({ where: { id: revoke.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });

    // Lease lapsed: the resolver — the one writer with no human present —
    // must return pending and leave the petition row untouched.
    await setContact(new Date(Date.now() - 25 * 3_600_000));
    const gated = await evaluateAndApplyPetition(prismaA, revoke.petitionId);
    assert.equal(gated.outcome, "pending");
    assert.equal(
      (await prismaA.petition.findUniqueOrThrow({ where: { id: revoke.petitionId } })).status,
      "open",
      "a gated petition stays open, not rejected",
    );

    // Contact returns: the same petition resolves normally.
    await setContact(new Date());
    const resolved = await evaluateAndApplyPetition(prismaA, revoke.petitionId);
    assert.equal(resolved.outcome, "approved");
    await pair.pump();
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
      })).status,
      "revoked",
    );
  } finally {
    await cleanupSide(prismaA, "cl_gate");
    await cleanupSide(prismaB, "cl_gate");
  }
});

test("challenge: direct proof of life cancels; idempotent while open; cooldown after close", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cl_prove", { activate: true });
  try {
    const replica = await designate(pair, 24);

    const opened = await openTakeoverChallenge(prismaB, { replicaId: replica.id });
    assert.deepEqual(opened, { ok: true, alreadyOpen: false });
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "challenge_open",
    );
    // Second click while open: idempotent, no second fuse.
    assert.deepEqual(await openTakeoverChallenge(prismaB, { replicaId: replica.id }), { ok: true, alreadyOpen: true });

    // The challenge crosses; the home answers; the proof crosses back.
    await pair.pump();
    const closed = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(closed.status, "active", "direct proof of life closes the challenge");
    assert.ok(closed.lastProofOfLifeAt && closed.challengeOpenedAt && closed.lastProofOfLifeAt > closed.challengeOpenedAt);

    // Reopening within the hour is refused (cooldown-lite).
    const tooSoon = await openTakeoverChallenge(prismaB, {
      replicaId: replica.id,
      now: new Date(closed.challengeOpenedAt!.getTime() + 30 * 60_000),
    });
    assert.deepEqual(tooSoon, { ok: false, reason: "cooldown" });
    // After the hour it opens again.
    const again = await openTakeoverChallenge(prismaB, {
      replicaId: replica.id,
      now: new Date(closed.challengeOpenedAt!.getTime() + 61 * 60_000),
    });
    assert.deepEqual(again, { ok: true, alreadyOpen: false });
  } finally {
    await cleanupSide(prismaA, "cl_prove");
    await cleanupSide(prismaB, "cl_prove");
  }
});

test("relay: with the direct link cut, the challenge and the proof both travel through a peer", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "cl_relay", { mesh: true });
  try {
    const replica = await designate(triad, 24);

    // Cut ONLY the A↔B road. B's challenge must reach A via C, and A's
    // proof must come back via C — verified at B against the PINNED A key,
    // never C's (the trust anchor does not move to the relay).
    triad.cutLink(triad.a.domain, triad.b.domain);
    const opened = await openTakeoverChallenge(prismaB, { replicaId: replica.id });
    assert.deepEqual(opened, { ok: true, alreadyOpen: false });
    await triad.pump();
    await triad.pump();

    const closed = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(closed.status, "active", "relayed proof of life closes the challenge");
    assert.ok(closed.lastProofOfLifeAt);

    // The proof B accepted really is A's: A's inbound log shows the
    // challenge arrived (via C), origin-verified.
    const challengeAtA = await prismaA.federationInboundEvent.findFirst({
      where: { eventType: "takeover_challenge" },
      orderBy: { receivedAt: "desc" },
    });
    assert.equal(challengeAtA?.outcome, "applied");
  } finally {
    triad.restoreLink(triad.a.domain, triad.b.domain);
    await cleanupSide(prismaA, "cl_relay");
    await cleanupSide(prismaB, "cl_relay");
    await cleanupSide(prismaC, "cl_relay");
  }
});

test("witness: home fully cut, but one peer that has heard from it blocks the challenge", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "cl_wit", { mesh: true });
  try {
    const replica = await designate(triad, 24);

    // A goes completely dark...
    triad.cut(triad.a.domain);
    // ...but C heard from A AFTER the challenge below opens (challenge
    // backdated 2h; C's contact is fresh). One witness of life blocks.
    const challengeAt = new Date(Date.now() - 2 * 3_600_000);
    await prismaC.federatedNode.updateMany({
      where: { domain: triad.a.domain },
      data: { lastSeenAt: new Date() },
    });

    const opened = await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });
    assert.deepEqual(opened, { ok: true, alreadyOpen: false });
    await triad.pump();
    await triad.pump();

    const witnessed = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(witnessed.status, "active", "a witness of life closes the challenge without the home speaking");
    // A never received or answered anything.
    assert.equal(await prismaA.federationInboundEvent.count({ where: { eventType: "takeover_challenge" } }), 0);
    assert.equal(await prismaB.federationInboundEvent.count({ where: { eventType: "proof_of_life" } }), 0);
    const witnessReport = await prismaB.federationInboundEvent.findFirst({
      where: { eventType: "proof_of_life_relay" },
    });
    assert.equal(witnessReport?.outcome, "applied");
  } finally {
    triad.restore(triad.a.domain);
    await cleanupSide(prismaA, "cl_wit");
    await cleanupSide(prismaB, "cl_wit");
    await cleanupSide(prismaC, "cl_wit");
  }
});

test("heartbeat: pings only with an active backup and stale contact; logs authority transitions", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cl_beat", { activate: true });
  try {
    // No backups: no heartbeat at all (state-1 honesty).
    const idle = await runContinuityHeartbeat(prismaA, { now: new Date() });
    assert.deepEqual(idle, { pinged: 0, transitionsLogged: 0 });

    await designate(pair, 24);
    await pair.pump();

    // Fresh contact (< W/6 = 4h): no ping.
    const t0 = new Date("2026-07-09T12:00:00Z");
    await setContact(t0);
    const fresh = await runContinuityHeartbeat(prismaA, { now: new Date(t0.getTime() + 3_600_000) });
    assert.equal(fresh.pinged, 0);

    // Stale (> W/6): ping every active peer; transition to read_only past W
    // is logged as a SignedEvent — legibility, never authority.
    const late = new Date(t0.getTime() + 25 * 3_600_000);
    const stale = await runContinuityHeartbeat(prismaA, { now: late });
    assert.ok(stale.pinged >= 1, JSON.stringify(stale));
    assert.equal(stale.transitionsLogged, 1);
    const logged = await prismaA.signedEvent.findFirst({
      where: { eventType: "continuity_authority_changed", subjectId: `group:${pair.a.groupId}` },
      orderBy: { createdAt: "desc" },
    });
    assert.equal((logged?.payload as { authority: string }).authority, "read_only");

    // Same state next tick: no duplicate log.
    const repeat = await runContinuityHeartbeat(prismaA, { now: new Date(late.getTime() + 60_000) });
    assert.equal(repeat.transitionsLogged, 0);
  } finally {
    await prismaA.signedEvent.deleteMany({ where: { subjectId: `group:cl_beat_steward_a` } });
    await cleanupSide(prismaA, "cl_beat");
    await cleanupSide(prismaB, "cl_beat");
  }
});
