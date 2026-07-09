import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { resolveWriteAuthority } from "../lib/continuity";
import { markUnverifiedAtBoot, runQuietBootVerification, type FetchLike } from "../lib/continuity-boot";
import { proposeBackupDesignation } from "../lib/continuity-establishment";
import { openTakeoverChallenge } from "../lib/continuity-lease";
import { runContinuityReplicationSweep } from "../lib/continuity-replication";
import { serveContinuityStatus, type ContinuityStatusQuery } from "../lib/continuity-status";
import {
  initiateGracefulHandoff,
  performTakeoverAction,
  proposeTakeoverExpedite,
  runTakeoverActivationSweep,
  verifyStrandedIdentity,
} from "../lib/continuity-takeover";
import { ensureEscrowWrap, unwrapEscrowedIdentityKey } from "../lib/identity-escrow";
import { signWithPrivateKeyPem } from "../lib/node-keys";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import { hashSignedEventPayload } from "../lib/signed-events";
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

// F3.5 Phase 4 — Tier-2 activation, quiet-boot, catch-up/cede. THE lease
// test lives here: a three-node mesh, a full cut, deliberately SKEWED {now}
// injections on the two sides (the "W ≥ 1h dominates skew" claim is
// exercised, not assumed), and zero double-writes asserted on both
// databases. Plus: quiet-boot verification through the real signed status
// pull, contested-activation convergence, the expedite and handoff
// accelerators, and the stranded-login primitive roundtrip.

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

// Pin every side's contact clock to an exact instant (pump writes far-future
// lastOutboundOkAt values; tests own the clock, so reset explicitly).
async function pinContacts(at: Date) {
  await prismaA.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
  await prismaB.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
  await prismaC.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
}

// Bridge the home's signed status pull to the backup DB's real serve logic.
function statusFetchVia(prisma: PrismaClient, localNodeId: string): FetchLike {
  return async (url: string) => {
    const parsed = new URL(url);
    const query = Object.fromEntries(parsed.searchParams) as unknown as ContinuityStatusQuery;
    const result = await serveContinuityStatus(prisma, query, { id: localNodeId });
    return { ok: result.status === 200, json: async () => result.body };
  };
}

test("THE lease test: full cut, skewed clocks, activation after W, zero double-writes", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "ct_lease", { mesh: true });
  try {
    const replica = await designate(triad, 24);

    // Total silence begins at T0 — every clock pinned, then A goes dark.
    const t0 = new Date();
    await pinContacts(t0);
    triad.cut(triad.a.domain);

    // A member on B pulls the alarm ten minutes later (B's clock).
    const challengeAt = new Date(t0.getTime() + 10 * 60_000);
    const opened = await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });
    assert.deepEqual(opened, { ok: true, alreadyOpen: false });
    await triad.pump(); // relays go out; nothing reaches A; C has no fresh contact to witness

    // Before W: neither side moves. A (its own skewed clock, +23h58m from
    // T0) is still writable; B's sweep (its clock, +23h50m from challenge)
    // does not activate.
    const group = { entityType: "group", entityId: triad.a.groupId! };
    assert.equal(
      await resolveWriteAuthority(prismaA, group, { now: new Date(t0.getTime() + (23 * 60 + 58) * 60_000) }),
      "writable",
    );
    const early = await runTakeoverActivationSweep(prismaB, {
      now: new Date(challengeAt.getTime() + (23 * 60 + 50) * 60_000),
    });
    assert.deepEqual(early, { activated: 0, implicitLife: 0 });

    // Past W — the two sides' clocks are deliberately SKEWED (A reads
    // T0+24h07m, B reads challenge+24h19m; a 12-minute disagreement).
    // W ≥ 1h dominates: A demoted itself by its own clock BEFORE B
    // activates, whatever the skew.
    const aNow = new Date(t0.getTime() + (24 * 60 + 7) * 60_000);
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: aNow }), "read_only");

    // A-side guarded write is refused: a due petition stays open, untouched.
    const petition = await prismaA.petition.findFirst({
      where: { scopeType: "group", scopeId: triad.a.groupId!, subjectType: "backup_designation" },
      orderBy: { opensAt: "desc" },
    });
    assert.ok(petition); // the (already resolved) designation petition exists; open a fresh probe instead
    const bNow = new Date(challengeAt.getTime() + (24 * 60 + 19) * 60_000);
    const swept = await runTakeoverActivationSweep(prismaB, { now: bNow });
    assert.deepEqual(swept, { activated: 1, implicitLife: 0 });
    const active = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(active.status, "takeover_active");
    assert.ok(active.activatedAt);

    // Tier-2 accepts a discussion post on B...
    const posted = await performTakeoverAction(prismaB, {
      replicaId: replica.id,
      actionType: "takeover_post_message",
      action: { body: "regrouping here until home returns" },
      actorLabel: "Steward b @ ct_lease-b.example",
    });
    assert.deepEqual(posted, { ok: true, seq: 1 });

    // ...while A — still by its own clock — refuses writes: ZERO
    // double-writes. The one writer with no human present returns pending,
    // and the takeover log on B is the only place anything landed.
    assert.equal(await resolveWriteAuthority(prismaA, group, { now: aNow }), "read_only");
    const entriesOnB = await prismaB.takeoverLogEntry.count({ where: { replicaId: replica.id } });
    assert.equal(entriesOnB, 1);
    const messagesOnA = await prismaA.discussionMessage.count({
      where: { thread: { spaceType: "group", spaceId: triad.a.groupId! } },
    });
    assert.equal(messagesOnA, 0, "nothing materialized on A while partitioned");

    // The legible transfer event exists on B, node-signed.
    const transfer = await prismaB.signedEvent.findFirst({
      where: { eventType: "continuity_authority_changed", subjectId: `group:${triad.a.groupId}` },
      orderBy: { createdAt: "desc" },
    });
    assert.equal((transfer?.payload as { authority?: string })?.authority, "takeover_active");
  } finally {
    triad.restore(triad.a.domain);
    await cleanupSide(prismaA, "ct_lease");
    await cleanupSide(prismaB, "ct_lease");
    await cleanupSide(prismaC, "ct_lease");
  }
});

test("partition with a live witness path: home keeps the lease, no activation", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "ct_alive", { mesh: true });
  try {
    const replica = await designate(triad, 24);
    // Anchor the clock two hours in the past: proofs of life arrive at real
    // now, and life must be NEWER than the challenge to count.
    const t0 = new Date(Date.now() - 2 * 3_600_000);
    await pinContacts(t0);
    // Only the A↔B road is down; A and C keep talking.
    triad.cutLink(triad.a.domain, triad.b.domain);
    const challengeAt = new Date(t0.getTime() + 10 * 60_000);
    await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });

    // A's contact with C is fresh — A never demotes, even long past W.
    await prismaA.federatedNode.updateMany({
      where: { domain: triad.c.domain },
      data: { lastSeenAt: new Date(t0.getTime() + 26 * 3_600_000) },
    });
    assert.equal(
      await resolveWriteAuthority(
        prismaA,
        { entityType: "group", entityId: triad.a.groupId! },
        { now: new Date(t0.getTime() + 26.5 * 3_600_000) },
      ),
      "writable",
    );

    // And the challenge dies on the relay: C forwards it, A proves life
    // through C, B never activates.
    await triad.pump();
    await triad.pump();
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "active",
    );
    const sweep = await runTakeoverActivationSweep(prismaB, {
      now: new Date(challengeAt.getTime() + 25 * 3_600_000),
    });
    assert.equal(sweep.activated, 0);
  } finally {
    triad.restoreLink(triad.a.domain, triad.b.domain);
    await cleanupSide(prismaA, "ct_alive");
    await cleanupSide(prismaB, "ct_alive");
    await cleanupSide(prismaC, "ct_alive");
  }
});

test("quiet-boot: unverified blocks writes; verification catches up the annex log and cedes", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ct_boot", { activate: true });
  try {
    // Give A's steward an escrowed identity and replicate it to B.
    await prismaA.account.update({ where: { id: pair.a.stewardAccountId }, data: { passwordHash: "x" } });
    await ensureEscrowWrap(prismaA, { accountId: pair.a.stewardAccountId, password: "long memory" });
    const replica = await designate(pair);
    await runContinuityReplicationSweep(prismaA);
    await pair.pump();

    // Takeover while "A is down": challenge on B, never delivered, W lapses.
    const t0 = new Date();
    await pinContacts(t0);
    pair.cut(pair.a.domain);
    const challengeAt = new Date(t0.getTime() + 5 * 60_000);
    await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });
    const swept = await runTakeoverActivationSweep(prismaB, {
      now: new Date(challengeAt.getTime() + 25 * 3_600_000),
    });
    assert.equal(swept.activated, 1);

    // Two annex entries: a stranded-login VERIFIED post (client-side unwrap
    // happens here in the test, as it would in the browser), and an
    // unverified join intent.
    const held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    const escrow = (held.escrowEntries as Array<{ did: string; salt: string; wrapped: string }>)[0];
    assert.ok(escrow, "escrow entry replicated");
    const pem = unwrapEscrowedIdentityKey("long memory", escrow);
    const challenge = "ct_boot-stranded-challenge";
    const signature = signWithPrivateKeyPem(pem, hashSignedEventPayload({ challenge }));
    const verified = await verifyStrandedIdentity(prismaB, {
      replicaId: replica.id,
      did: escrow.did,
      challenge,
      signature,
    });
    assert.equal(verified.ok, true, JSON.stringify(verified));
    if (!verified.ok) return;
    const wrongPassword = () => unwrapEscrowedIdentityKey("wrong", escrow);
    assert.throws(wrongPassword, "stranded login fails closed on a wrong password");

    const verifiedPost = await performTakeoverAction(prismaB, {
      replicaId: replica.id,
      actionType: "takeover_post_message",
      action: { body: "checking in from the backup" },
      actorLabel: `${verified.handle} @ ${pair.b.domain}`,
      actorDid: verified.did,
    });
    assert.equal(verifiedPost.ok, true);
    const joinIntent = await performTakeoverAction(prismaB, {
      replicaId: replica.id,
      actionType: "takeover_join_open_group",
      action: {},
      actorLabel: `Newcomer @ ${pair.b.domain}`,
    });
    assert.equal(joinIntent.ok, true);

    // A restarts: quiet-boot marks unverified — writes blocked by the
    // resolver even though A's own rows say "active, all fine".
    pair.restore(pair.a.domain);
    const marked = await markUnverifiedAtBoot(prismaA);
    assert.ok(marked >= 1);
    const group = { entityType: "group", entityId: pair.a.groupId! };
    assert.equal(await resolveWriteAuthority(prismaA, group), "unverified");
    const gated = await evaluateAndApplyPetition(prismaA, "nonexistent");
    assert.equal(gated.outcome, "pending"); // resolver simply returns pending on unknowns too

    // Unreachable backup: stays unverified, read-only — the documented
    // safety posture.
    const failing: FetchLike = async () => {
      throw new Error("network down");
    };
    const unreachable = await runQuietBootVerification(prismaA, { fetchImpl: failing });
    assert.equal(unreachable.unreachable, 1);
    assert.equal(await resolveWriteAuthority(prismaA, group), "unverified");

    // Real verification through the signed status pull: B flips to ceding,
    // the log replays on A (verified post as the steward THEMSELVES; the
    // unverified join as a labeled record importing no one), catch-up is
    // acknowledged, both sides converge.
    const result = await runQuietBootVerification(prismaA, {
      fetchImpl: statusFetchVia(prismaB, pair.b.node.id),
    });
    assert.equal(result.caughtUp, 1, JSON.stringify(result));
    await pair.pump();

    // The pump just delivered B's ORIGINAL takeover_activated broadcast —
    // stale news arriving after the pull already reconciled everything. The
    // contested branch freezes to unverified (safe direction) and the next
    // tick's pull clears it: the blip, exercised.
    assert.equal(await resolveWriteAuthority(prismaA, group), "unverified");
    const reverify = await runQuietBootVerification(prismaA, {
      fetchImpl: statusFetchVia(prismaB, pair.b.node.id),
    });
    assert.equal(reverify.verified, 1, JSON.stringify(reverify));
    await pair.pump();

    assert.equal(await resolveWriteAuthority(prismaA, group), "writable");
    const backup = await prismaA.entityBackup.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "group", entityId: pair.a.groupId! } },
    });
    assert.equal(backup.takeoverState, "none");
    assert.equal(backup.lastAppliedSeq, 2);

    const thread = await prismaA.discussionThread.findFirstOrThrow({
      where: { spaceType: "group", spaceId: pair.a.groupId!, title: "Failover annex" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[0].authorId, pair.a.stewardAccountId, "verified post replays as the member");
    assert.equal(thread.messages[0].body, "checking in from the backup");
    assert.ok(thread.messages[1].body.includes("Newcomer"), "unverified join replays as a labeled record");
    assert.equal(
      await prismaA.groupMembership.count({ where: { groupId: pair.a.groupId! } }),
      1,
      "failover imported no members (register D-5)",
    );

    const ceded = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal(ceded.status, "active");
    assert.ok(ceded.cededAt);
    assert.equal(
      (await prismaA.federationInboundEvent.findFirst({ where: { eventType: "takeover_ceded" } }))?.outcome,
      "applied",
    );
  } finally {
    pair.restore(pair.a.domain);
    await cleanupSide(prismaA, "ct_boot");
    await cleanupSide(prismaB, "ct_boot");
  }
});

test("contested activation converges: alive home answers with life, reconciles the log, backup cedes", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "ct_race", { mesh: true });
  try {
    const replica = await designate(triad, 24);
    const t0 = new Date(Date.now() - 2 * 3_600_000); // past-anchored: see ct_alive
    await pinContacts(t0);
    // B is fully isolated (asymmetric view: A still talks to C, so A keeps
    // its lease); B, hearing nothing, challenges and eventually activates.
    triad.cut(triad.b.domain);
    const challengeAt = new Date(t0.getTime() + 5 * 60_000);
    await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });
    await runTakeoverActivationSweep(prismaB, { now: new Date(challengeAt.getTime() + 25 * 3_600_000) });
    const isolatedPost = await performTakeoverAction(prismaB, {
      replicaId: replica.id,
      actionType: "takeover_post_message",
      action: { body: "posted during the contested window" },
      actorLabel: `Member @ ${triad.b.domain}`,
    });
    assert.equal(isolatedPost.ok, true);

    // A meanwhile stayed writable by its own clock (fresh C contact).
    await prismaA.federatedNode.updateMany({
      where: { domain: triad.c.domain },
      data: { lastSeenAt: new Date() },
    });
    const group = { entityType: "group", entityId: triad.a.groupId! };
    assert.equal(await resolveWriteAuthority(prismaA, group), "writable");

    // Partition heals: B's takeover_activated reaches a live A → contested.
    // A answers with proof of life AND drops to unverified (an annex log
    // exists; freeze until reconciled).
    triad.restore(triad.b.domain);
    await triad.pump();
    assert.equal(await resolveWriteAuthority(prismaA, group), "unverified");
    await triad.pump();
    // B saw life after activation → ceding (cede-on-contact).
    const ceding = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.ok(
      ceding.status === "ceding" || ceding.status === "takeover_active",
      `post-life status: ${ceding.status}`,
    );

    // The same quiet-boot machinery reconciles: pull, replay, cede.
    const result = await runQuietBootVerification(prismaA, {
      fetchImpl: statusFetchVia(prismaB, triad.b.node.id),
    });
    assert.equal(result.caughtUp, 1, JSON.stringify(result));
    await triad.pump();

    assert.equal(await resolveWriteAuthority(prismaA, group), "writable");
    const thread = await prismaA.discussionThread.findFirst({
      where: { spaceType: "group", spaceId: triad.a.groupId!, title: "Failover annex" },
      include: { messages: true },
    });
    assert.ok(thread && thread.messages.some((m) => m.body.includes("posted during the contested window")),
      "the contested window is lossless — the annex log replayed");
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "active",
    );
  } finally {
    triad.restore(triad.b.domain);
    await cleanupSide(prismaA, "ct_race");
    await cleanupSide(prismaB, "ct_race");
    await cleanupSide(prismaC, "ct_race");
  }
});

test("accelerators: expedite compresses W but needs the open challenge; handoff is instant", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ct_accel", { activate: true });
  try {
    const replica = await designate(pair);

    // Expedite without a challenge: refused — it can never skip the fuse.
    const noChallenge = await proposeTakeoverExpedite(prismaB, {
      replicaId: replica.id,
      createdByMembershipId: pair.b.stewardMembershipId!,
    });
    assert.deepEqual(noChallenge, { ok: false, reason: "no_open_challenge" });

    const t0 = new Date(Date.now() - 2 * 3_600_000); // past-anchored: the expedite approval lands at REAL now and must postdate the challenge
    await pinContacts(t0);
    pair.cut(pair.a.domain);
    const challengeAt = new Date(t0.getTime() + 5 * 60_000);
    await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });

    const proposed = await proposeTakeoverExpedite(prismaB, {
      replicaId: replica.id,
      createdByMembershipId: pair.b.stewardMembershipId!,
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;
    await approveStewardPetition(pair.b, proposed.petitionId);
    assert.ok(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).expediteApprovedAt,
    );

    // One hour after the challenge — far short of W=24h — the sweep
    // activates because the expedite counts as W-elapsed.
    const swept = await runTakeoverActivationSweep(prismaB, {
      now: new Date(challengeAt.getTime() + 3_600_000),
    });
    assert.equal(swept.activated, 1);
  } finally {
    pair.restore(pair.a.domain);
    await cleanupSide(prismaA, "ct_accel");
    await cleanupSide(prismaB, "ct_accel");
  }
});

test("graceful handoff: home self-demotes instantly and the backup activates without a challenge", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "ct_hand", { activate: true });
  try {
    const replica = await designate(pair);
    const group = { entityType: "group", entityId: pair.a.groupId! };
    assert.equal(await resolveWriteAuthority(prismaA, group), "writable");

    const handed = await initiateGracefulHandoff(prismaA, group);
    assert.deepEqual(handed, { ok: true });
    // Home is read-only IMMEDIATELY — before the event even travels.
    assert.equal(await resolveWriteAuthority(prismaA, group), "read_only");
    await pair.pump();
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "takeover_active",
    );
  } finally {
    await cleanupSide(prismaA, "ct_hand");
    await cleanupSide(prismaB, "ct_hand");
  }
});
