import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { requireCoalitionWritable } from "../lib/coalition-authorization";
import { resolveWriteAuthority } from "../lib/continuity";
import { markUnverifiedAtBoot, runQuietBootVerification } from "../lib/continuity-boot";
import { proposeProjectBackupDesignation, proposeProjectBackupRevocation } from "../lib/continuity-establishment";
import { openTakeoverChallenge } from "../lib/continuity-lease";
import { runContinuityReplicationSweep } from "../lib/continuity-replication";
import { serveContinuityStatus, type ContinuityStatusQuery } from "../lib/continuity-status";
import { performTakeoverAction, runTakeoverActivationSweep } from "../lib/continuity-takeover";
import { openCoalitionBackupDesignationProposal, openCoalitionFormationProposal } from "../lib/coalitions";
import { broadcastCoalitionMessage, proposeCoalitionBackupWithdrawal } from "../lib/federated-coalitions";
import type { FetchLike } from "../lib/continuity-boot";
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
  rejectStewardPetition,
  type FederatedPair,
  type FederatedTriad,
  type Side,
} from "./federation-fixtures";

// F3.5 Phase 5 — project + coalition continuity entrances, and THE coalition
// write-authority gate. The coalition consent shape under test is the decided
// one: designation is a coalition decision through EVERY member group's own
// governance — remote included, via the cross-node proposal machinery — and
// revocation is consent-withdrawal (any one member group, local or remote,
// through its own petition alone). Membership is not tiered by data locality.

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

async function pinContacts(at: Date) {
  await prismaA.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
  await prismaB.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
  await prismaC.federatedNode.updateMany({ data: { lastSeenAt: at, lastOutboundOkAt: at } });
}

function statusFetchVia(prisma: PrismaClient, localNodeId: string): FetchLike {
  return async (url: string) => {
    const parsed = new URL(url);
    const query = Object.fromEntries(parsed.searchParams) as unknown as ContinuityStatusQuery;
    const result = await serveContinuityStatus(prisma, query, { id: localNodeId });
    return { ok: result.status === 200, json: async () => result.body };
  };
}

async function approvePetitionAsProjectMember(
  prisma: PrismaClient,
  petitionId: string,
  accountId: string,
  projectMembershipId: string,
) {
  const supported = await addPetitionSupport(prisma, { petitionId, actorAccountId: accountId, projectMembershipId });
  assert.equal(supported.ok, true, JSON.stringify(supported));
  await prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(prisma, petitionId);
}

// Petition sets follow membership order (alphabetical group ids), so pick
// the right membership per petition instead of assuming an order.
async function approveByGroup(
  prisma: PrismaClient,
  petitionIds: string[],
  accountId: string,
  membershipByGroupId: Record<string, string>,
  limit?: number,
) {
  let approved = 0;
  for (const petitionId of petitionIds) {
    if (limit !== undefined && approved >= limit) return;
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: petitionId }, select: { groupId: true } });
    const membershipId = membershipByGroupId[petition.groupId ?? ""];
    assert.ok(membershipId, `no membership for group ${petition.groupId}`);
    await approveGroupPetition(prisma, petitionId, accountId, membershipId);
    approved += 1;
  }
}

async function approveGroupPetition(prisma: PrismaClient, petitionId: string, accountId: string, membershipId: string) {
  const supported = await addPetitionSupport(prisma, { petitionId, actorAccountId: accountId, membershipId });
  assert.equal(supported.ok, true, JSON.stringify(supported));
  await prisma.petition.update({ where: { id: petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(prisma, petitionId);
}

test("project entrance: designate → replicate → resolver gate under lapsed lease → revoke", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cx_proj", { activate: true });
  try {
    const project = await prismaA.project.create({
      data: { id: "cx_proj_p1", foundingGroupId: pair.a.groupId!, name: "cx_proj harvest" },
    });
    const projectMembership = await prismaA.projectMembership.create({
      data: { id: "cx_proj_pm1", accountId: pair.a.stewardAccountId, projectId: project.id },
    });

    const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
    const proposed = await proposeProjectBackupDesignation(prismaA, {
      projectId: project.id,
      peerNodeId: peer.id,
      windowHours: 24,
      directive: "none",
      createdByProjectMembershipId: projectMembership.id,
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;
    await approvePetitionAsProjectMember(prismaA, proposed.petitionId, pair.a.stewardAccountId, projectMembership.id);
    await pair.pump();

    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "project", entityId: project.id },
    });
    assert.equal(replica.status, "active");
    assert.equal(replica.entityName, "cx_proj harvest");
    assert.equal(replica.memberCount, 1);

    // Manifest converges through the entity-generic sweep.
    const sweep = await runContinuityReplicationSweep(prismaA);
    assert.ok(sweep.replicated >= 1, JSON.stringify(sweep));
    await pair.pump();
    const held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal((held.manifest as { name: string }).name, "cx_proj harvest");
    assert.equal((held.manifest as { entityType: string }).entityType, "project");

    // The Phase-3 resolver gate is scope-generic: a due PROJECT petition
    // stays pending while the project's lease is lapsed.
    const revoke = await proposeProjectBackupRevocation(prismaA, {
      projectId: project.id,
      peerNodeId: peer.id,
      createdByProjectMembershipId: projectMembership.id,
    });
    assert.equal(revoke.ok, true, JSON.stringify(revoke));
    if (!revoke.ok) return;
    const supported = await addPetitionSupport(prismaA, {
      petitionId: revoke.petitionId,
      actorAccountId: pair.a.stewardAccountId,
      projectMembershipId: projectMembership.id,
    });
    assert.equal(supported.ok, true);
    await prismaA.petition.update({ where: { id: revoke.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });

    await pinContacts(new Date(Date.now() - 25 * 3_600_000));
    const gated = await evaluateAndApplyPetition(prismaA, revoke.petitionId);
    assert.equal(gated.outcome, "pending");
    assert.equal(
      (await prismaA.petition.findUniqueOrThrow({ where: { id: revoke.petitionId } })).status,
      "open",
    );

    await pinContacts(new Date());
    const resolved = await evaluateAndApplyPetition(prismaA, revoke.petitionId);
    assert.equal(resolved.outcome, "approved");
    await pair.pump();
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "ended",
    );
  } finally {
    await prismaA.projectMembership.deleteMany({ where: { projectId: "cx_proj_p1" } });
    await prismaA.entityBackup.deleteMany({ where: { entityId: "cx_proj_p1" } });
    await prismaA.petition.deleteMany({ where: { scopeType: "project", scopeId: "cx_proj_p1" } });
    await prismaA.project.deleteMany({ where: { id: "cx_proj_p1" } });
    await cleanupSide(prismaA, "cx_proj");
    await cleanupSide(prismaB, "cx_proj");
  }
});

// Local coalition helper: two groups on A, one shared member account.
async function formLocalCoalition(pair: FederatedPair, prefix: string) {
  const secondGroup = await prismaA.group.create({
    data: {
      id: `${prefix}_g2`,
      nodeId: pair.a.node.id,
      name: `${prefix} second`,
      membershipPolicy: "open",
      visibility: "public",
    },
  });
  const secondMembership = await prismaA.groupMembership.create({
    data: {
      id: `${prefix}_g2_m`,
      accountId: pair.a.stewardAccountId,
      groupId: secondGroup.id,
      status: "active",
      participationStatus: "active",
    },
  });
  const opened = await openCoalitionFormationProposal(prismaA, {
    name: `${prefix} coalition`,
    content: "Two collectives, one purpose.",
    participants: [
      { groupId: pair.a.groupId!, createdByMembershipId: pair.a.stewardMembershipId! },
      { groupId: secondGroup.id },
    ],
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  if (!opened.ok) throw new Error("unreachable");
  for (const petitionId of opened.petitionIds) {
    const petition = await prismaA.petition.findUniqueOrThrow({ where: { id: petitionId }, select: { groupId: true } });
    const membershipId = petition.groupId === pair.a.groupId ? pair.a.stewardMembershipId! : secondMembership.id;
    await approveGroupPetition(prismaA, petitionId, pair.a.stewardAccountId, membershipId);
  }
  const coalition = await prismaA.coalition.findFirstOrThrow({ where: { name: `${prefix} coalition` } });
  return { coalition, secondGroup, secondMembership };
}

test("local coalition: all member groups approve designation; one group's withdrawal revokes for everyone", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cx_loco", { activate: true });
  try {
    const { coalition, secondMembership } = await formLocalCoalition(pair, "cx_loco");
    const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });

    const opened = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: peer.id,
      windowHours: 24,
      directive: "reconstitute",
      createdByMembershipId: pair.a.stewardMembershipId!,
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    if (!opened.ok) return;
    assert.equal(opened.petitionIds.length, 2, "one petition per member group");

    // Single-open is DB-enforced (F-7): a second proposal cannot open.
    const dup = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: peer.id,
      windowHours: 24,
      directive: "none",
      createdByMembershipId: pair.a.stewardMembershipId!,
    });
    assert.deepEqual(dup, { ok: false, reason: "proposal_already_open" });

    // First approval alone must NOT apply (all-approve).
    const memberships = {
      [pair.a.groupId!]: pair.a.stewardMembershipId!,
      cx_loco_g2: secondMembership.id,
    };
    await approveByGroup(prismaA, opened.petitionIds, pair.a.stewardAccountId, memberships, 1);
    assert.equal(
      await prismaA.entityBackup.count({ where: { entityType: "coalition", entityId: coalition.id } }),
      0,
      "designation applies only on unanimity",
    );
    await approveByGroup(prismaA, [...opened.petitionIds].reverse(), pair.a.stewardAccountId, memberships, 1);
    // (reversed single-approval hits the OTHER petition; both are now approved
    // exactly once each because approveGroupPetition is per-petition)

    const backup = await prismaA.entityBackup.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "coalition", entityId: coalition.id } },
    });
    assert.equal(backup.directive, "reconstitute");
    await pair.pump();
    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "coalition", entityId: coalition.id },
    });
    assert.equal(replica.status, "active");
    assert.equal(replica.memberCount, 2, "member COLLECTIVES, honestly labeled by entityType");

    // Manifest: the coalition branch of the review-gated builder.
    await runContinuityReplicationSweep(prismaA);
    await pair.pump();
    const held = await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } });
    assert.equal((held.manifest as { entityType: string }).entityType, "coalition");
    assert.equal((held.escrowEntries as unknown[]).length, 0, "coalition replicas carry no escrow entries");

    // Withdrawal: ONE member group's own petition revokes for everyone.
    const withdrawal = await proposeCoalitionBackupWithdrawal(prismaA, {
      coalitionId: coalition.id,
      groupId: "cx_loco_g2",
      createdByMembershipId: secondMembership.id,
    });
    assert.equal(withdrawal.ok, true, JSON.stringify(withdrawal));
    if (!withdrawal.ok) return;
    await approveGroupPetition(prismaA, withdrawal.petitionId, pair.a.stewardAccountId, secondMembership.id);
    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({ where: { id: backup.id } })).status,
      "revoked",
    );
    await pair.pump();
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "ended",
    );
  } finally {
    await cleanupSide(prismaA, "cx_loco");
    await cleanupSide(prismaB, "cx_loco");
  }
});

// Cross-node coalition helper: A home + B remote member.
async function formCrossNodeCoalition(triad: FederatedTriad, name: string) {
  const opened = await openCoalitionFormationProposal(prismaA, {
    name,
    content: "Two nodes, one coalition.",
    participants: [{ groupId: triad.a.groupId!, createdByMembershipId: triad.a.stewardMembershipId! }],
    remoteParticipants: [{ domain: triad.b.domain, remoteGroupId: triad.b.groupId!, name: "B collective" }],
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  if (!opened.ok) throw new Error("unreachable");
  await triad.pump();
  await approveStewardPetition(triad.b, await memberSidePetition(triad.b, opened.proposalId));
  await triad.pump();
  await approveStewardPetition(triad.a, opened.petitionIds[0]);
  await triad.pump();
  return prismaA.coalition.findFirstOrThrow({ where: { name } });
}

async function memberSidePetition(side: Side, proposalId: string): Promise<string> {
  const link = await side.prisma.coalitionProposalPetition.findFirstOrThrow({
    where: { proposalId, groupId: side.groupId! },
    select: { petitionId: true },
  });
  return link.petitionId;
}

test("cross-node designation: remote member consents through its own node; remote withdrawal revokes", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "cx_far");
  try {
    const coalition = await formCrossNodeCoalition(triad, "cx_far coalition");
    const backupPeer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: triad.c.domain } });

    const opened = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: backupPeer.id,
      windowHours: 24,
      directive: "reconstitute",
      createdByMembershipId: triad.a.stewardMembershipId!,
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    if (!opened.ok) return;
    await triad.pump();

    // The mirror on B renders the REAL terms — B is consenting to THAT
    // backup node, not "a backup".
    const mirror = await prismaB.coalitionProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(mirror.action, "backup_designation");
    const mirrorTerms = (mirror.participantSnapshot as { backupTerms?: { peerDomain?: string; windowHours?: number } }).backupTerms;
    assert.equal(mirrorTerms?.peerDomain, triad.c.domain);
    assert.equal(mirrorTerms?.windowHours, 24);

    // Local approval alone must not apply — the remote decision is pending.
    await approveStewardPetition(triad.a, opened.petitionIds[0]);
    assert.equal(
      await prismaA.entityBackup.count({ where: { entityType: "coalition", entityId: coalition.id } }),
      0,
      "unanimity includes remote decisions",
    );

    await approveStewardPetition(triad.b, await memberSidePetition(triad.b, opened.proposalId));
    await triad.pump();
    await triad.pump();

    const backup = await prismaA.entityBackup.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "coalition", entityId: coalition.id } },
    });
    assert.equal(backup.status, "active");
    const replica = await prismaC.backupReplica.findFirstOrThrow({
      where: { entityType: "coalition", entityId: coalition.id },
    });
    assert.equal(replica.status, "active");

    // Remote withdrawal: B's group, through B's OWN governance, alone.
    const withdrawal = await proposeCoalitionBackupWithdrawal(prismaB, {
      coalitionId: coalition.id,
      groupId: triad.b.groupId!,
      createdByMembershipId: triad.b.stewardMembershipId!,
    });
    assert.equal(withdrawal.ok, true, JSON.stringify(withdrawal));
    if (!withdrawal.ok) return;
    await approveStewardPetition(triad.b, withdrawal.petitionId);
    await triad.pump();

    assert.equal(
      (await prismaA.entityBackup.findUniqueOrThrow({ where: { id: backup.id } })).status,
      "revoked",
      "one remote member's withdrawal revokes for everyone — no tiering by locality",
    );
    await triad.pump();
    assert.equal(
      (await prismaC.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "ended",
    );
  } finally {
    await cleanupSide(prismaA, "cx_far");
    await cleanupSide(prismaB, "cx_far");
    await cleanupSide(prismaC, "cx_far");
  }
});

test("remote rejection and remote silence both fail the designation with nothing half-formed anywhere", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "cx_no");
  try {
    const coalition = await formCrossNodeCoalition(triad, "cx_no coalition");
    const backupPeer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: triad.c.domain } });

    // Rejection.
    const first = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: backupPeer.id,
      windowHours: 24,
      directive: "none",
      createdByMembershipId: triad.a.stewardMembershipId!,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    await triad.pump();
    await approveStewardPetition(triad.a, first.petitionIds[0]);
    await rejectStewardPetition(triad.b, await memberSidePetition(triad.b, first.proposalId));
    await triad.pump();
    await triad.pump();

    assert.equal(
      (await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: first.proposalId } })).status,
      "failed-rejected",
    );
    assert.equal(await prismaA.entityBackup.count({ where: { entityType: "coalition", entityId: coalition.id } }), 0);
    assert.equal(await prismaC.backupReplica.count({ where: { entityType: "coalition", entityId: coalition.id } }), 0);

    // Silence: the calm-weather property — an unreachable member times out.
    triad.cut(triad.b.domain);
    const second = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: backupPeer.id,
      windowHours: 24,
      directive: "none",
      createdByMembershipId: triad.a.stewardMembershipId!,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    await approveStewardPetition(triad.a, second.petitionIds[0]);
    // Force the remote deadline into the past and re-evaluate.
    const proposal = await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: second.proposalId } });
    const snapshot = proposal.participantSnapshot as Record<string, unknown>;
    await prismaA.coalitionProposal.update({
      where: { id: second.proposalId },
      data: {
        participantSnapshot: { ...snapshot, remoteDeadline: new Date(Date.now() - 1000).toISOString() } as never,
      },
    });
    await evaluateAndApplyPetition(prismaA, second.petitionIds[0]);
    assert.equal(
      (await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: second.proposalId } })).status,
      "failed-timeout",
      "consent cannot be presumed from silence",
    );
    assert.equal(await prismaA.entityBackup.count({ where: { entityType: "coalition", entityId: coalition.id } }), 0);
  } finally {
    triad.restore(triad.b.domain);
    await cleanupSide(prismaA, "cx_no");
    await cleanupSide(prismaB, "cx_no");
    await cleanupSide(prismaC, "cx_no");
  }
});

test("THE coalition gate: lapsed lease freezes every write path; takeover annex replays to the coalition thread", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "cx_gate", { activate: true });
  try {
    const { coalition, secondMembership } = await formLocalCoalition(pair, "cx_gate");
    const peer = await prismaA.federatedNode.findUniqueOrThrow({ where: { domain: pair.b.domain } });
    const opened = await openCoalitionBackupDesignationProposal(prismaA, {
      coalitionId: coalition.id,
      peerNodeId: peer.id,
      windowHours: 24,
      directive: "reconstitute",
      createdByMembershipId: pair.a.stewardMembershipId!,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await approveByGroup(prismaA, opened.petitionIds, pair.a.stewardAccountId, {
      [pair.a.groupId!]: pair.a.stewardMembershipId!,
      cx_gate_g2: secondMembership.id,
    });
    await pair.pump();
    const replica = await prismaB.backupReplica.findFirstOrThrow({
      where: { entityType: "coalition", entityId: coalition.id },
    });
    assert.equal(replica.status, "active");

    // Lease lapses (past-anchored so later real-time events postdate it).
    const t0 = new Date(Date.now() - 26 * 3_600_000);
    await pinContacts(t0);
    pair.cut(pair.a.domain);

    assert.equal(
      await resolveWriteAuthority(prismaA, { entityType: "coalition", entityId: coalition.id }),
      "read_only",
    );
    // Gate 2 (page actions): the shared guard throws.
    await assert.rejects(requireCoalitionWritable(prismaA, coalition.id), /read-only/);
    // Gate 3 (broadcast): fans out nothing under a lapsed lease.
    const outboxBefore = await prismaA.federationOutboxItem.count({ where: { eventType: "coalition_content_appended" } });
    await broadcastCoalitionMessage(prismaA, { id: pair.a.node.id, domain: pair.a.domain }, {
      coalitionId: coalition.id,
      messageId: "cx_gate_m1",
      originDomain: pair.a.domain,
      authorLabel: "Someone @ a",
      body: "should not fan out",
      postedAt: new Date(),
    });
    assert.equal(
      await prismaA.federationOutboxItem.count({ where: { eventType: "coalition_content_appended" } }),
      outboxBefore,
    );
    // Gate 4 (membership changes): a due join proposal stays pending.
    const third = await prismaA.group.create({
      data: { id: "cx_gate_g3", nodeId: pair.a.node.id, name: "cx_gate third", membershipPolicy: "open", visibility: "public" },
    });
    const thirdMembership = await prismaA.groupMembership.create({
      data: { id: "cx_gate_g3_m", accountId: pair.a.stewardAccountId, groupId: third.id, status: "active", participationStatus: "active" },
    });
    const { openCoalitionJoinProposal } = await import("../lib/coalitions");
    const join = await openCoalitionJoinProposal(prismaA, {
      coalitionId: coalition.id,
      applicant: { groupId: third.id, createdByMembershipId: thirdMembership.id },
      memberSponsors: [{ groupId: pair.a.groupId! }, { groupId: "cx_gate_g2" }],
      content: "Third collective asks to join.",
    });
    assert.equal(join.ok, true, JSON.stringify(join));
    if (!join.ok) return;
    // Every child petition approves — the PROPOSAL still holds on the gate.
    await approveByGroup(prismaA, join.petitionIds, pair.a.stewardAccountId, {
      [pair.a.groupId!]: pair.a.stewardMembershipId!,
      cx_gate_g2: secondMembership.id,
      cx_gate_g3: thirdMembership.id,
    });
    assert.equal(
      (await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: join.proposalId } })).status,
      "open",
      "membership changes hold — pending, never failed — while the lease is lapsed",
    );

    // Tier 2 on the backup: challenge → W elapses → takeover → annex post.
    const challengeAt = new Date(t0.getTime() + 5 * 60_000);
    await openTakeoverChallenge(prismaB, { replicaId: replica.id, now: challengeAt });
    const swept = await runTakeoverActivationSweep(prismaB, { now: new Date(challengeAt.getTime() + 25 * 3_600_000) });
    assert.equal(swept.activated, 1);
    const posted = await performTakeoverAction(prismaB, {
      replicaId: replica.id,
      actionType: "takeover_post_message",
      action: { body: "coalition annex note during failover" },
      actorLabel: `Member @ ${pair.b.domain}`,
    });
    assert.equal(posted.ok, true);

    // Home returns: quiet-boot reconciles; the annex replays into the
    // COALITION thread (the replay generalization) and the backup cedes.
    pair.restore(pair.a.domain);
    await pinContacts(new Date());
    await markUnverifiedAtBoot(prismaA);
    const result = await runQuietBootVerification(prismaA, { fetchImpl: statusFetchVia(prismaB, pair.b.node.id) });
    assert.equal(result.caughtUp, 1, JSON.stringify(result));
    await pair.pump();

    const thread = await prismaA.discussionThread.findFirstOrThrow({
      where: { spaceType: "coalition", spaceId: coalition.id, title: "Failover annex" },
      include: { messages: true },
    });
    assert.ok(thread.messages.some((m) => m.body.includes("coalition annex note")));
    assert.equal(
      (await prismaB.backupReplica.findUniqueOrThrow({ where: { id: replica.id } })).status,
      "active",
    );
    // The pump also delivered B's ORIGINAL takeover_activated broadcast —
    // stale news after the pull already reconciled. One deliberate blip
    // (unverified), cleared by the next tick's pull. Same as the group case.
    assert.equal(
      await resolveWriteAuthority(prismaA, { entityType: "coalition", entityId: coalition.id }),
      "unverified",
    );
    const reverify = await runQuietBootVerification(prismaA, { fetchImpl: statusFetchVia(prismaB, pair.b.node.id) });
    assert.equal(reverify.verified, 1, JSON.stringify(reverify));
    assert.equal(
      await resolveWriteAuthority(prismaA, { entityType: "coalition", entityId: coalition.id }),
      "writable",
    );
    // The held join proposal now resolves.
    for (const petitionId of join.petitionIds) {
      await evaluateAndApplyPetition(prismaA, petitionId);
    }
    assert.equal(
      (await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: join.proposalId } })).status,
      "succeeded",
    );
  } finally {
    pair.restore(pair.a.domain);
    await cleanupSide(prismaA, "cx_gate");
    await cleanupSide(prismaB, "cx_gate");
  }
});
