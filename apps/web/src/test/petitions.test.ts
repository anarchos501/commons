import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  openPetition,
  addPetitionSupport,
  withdrawPetitionSupport,
  evaluatePetition,
  evaluateEmergencyPetition,
  withdrawPetition,
  withdrawPetitionBySubject,
  requireApprovedPetition,
  archiveStalePetitions,
  petitionFilterWhere,
  PETITION_FILTER_VALUES,
} from "../lib/petitions";
import { isProposalFamily, categoryForFamily } from "../lib/governance-proposal-families";
import { evaluateAndApplyPetition, resolveExpiredPetitions } from "../lib/petition-evaluation";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ---- ProposalFamily registry ----

test("all proposal families map to a governance category", () => {
  const families = [
    "membership_request", "project_proposal", "responsibility_proposal",
    "accountability_action", "living_document_revision",
    "bulletin_archive", "publication_archive", "publication_entry_archive", "living_document_archive",
    "emergency_declaration", "discussion_thread_close", "collective_support_request", "collective_contribution_offer",
    "contribution_category_proposal", "contribution_category_archive",
    "trusted_provider_proposal", "trusted_provider_revocation",
    "group_visibility_proposal",
  ] as const;
  for (const f of families) {
    assert.ok(isProposalFamily(f), `${f} not recognized`);
    const cat = categoryForFamily(f);
    assert.ok(cat, `${f} has no category`);
  }
  // archive_proposal is retired — the four typed archive families replaced it
  assert.equal(isProposalFamily("archive_proposal"), false);
});

test("isProposalFamily rejects unknown values", () => {
  assert.equal(isProposalFamily("membership"), false);
  assert.equal(isProposalFamily(""), false);
});

test("openPetition rejects invalid subjectType", async () => {
  const { group, memberships } = await createFixture("pet_invalid_type");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "bad_type", subjectId: "x", createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_family");
  } finally {
    await cleanupFixture("pet_invalid_type");
  }
});

test("openPetition rejects category mismatch", async () => {
  const { group, memberships } = await createFixture("pet_cat_mismatch");
  try {
    // bulletin_archive belongs to archival, not membership
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "bulletin_archive", subjectId: "x", createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "category_mismatch");
  } finally {
    await cleanupFixture("pet_cat_mismatch");
  }
});

test("openPetition creates petition with correct defaults", async () => {
  const { group, memberships } = await createFixture("pet_create");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: memberships[0].id, createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "open");
    assert.equal(petition.category, "membership");
    assert.ok(petition.governanceSnapshot);
    const snap = petition.governanceSnapshot as { threshold: number; petitionDuration: number };
    assert.equal(snap.threshold, 0.50); // default at temperature 0
    assert.equal(snap.petitionDuration, 3);
    // closesAt should be ~3 days from now
    const diffMs = petition.closesAt.getTime() - petition.opensAt.getTime();
    assert.ok(Math.abs(diffMs - 3 * 24 * 60 * 60 * 1000) < 5000);
  } finally {
    await cleanupFixture("pet_create");
  }
});

test("governanceSnapshot is frozen at open time (temperature changes do not alter snapshot)", async () => {
  const { group, memberships } = await createFixture("pet_snapshot", 10);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: memberships[0].id, createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const snapBefore = (await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } })).governanceSnapshot as { threshold: number };
    assert.ok(Math.abs(snapBefore.threshold - 0.50) < 0.001);

    // All members signal +1 means temperature = 1.0 and threshold resolves to the permissive anchor.
    for (const m of memberships) {
      await prisma.memberGovernanceSignal.upsert({
        where: { membershipId_category_parameter: { membershipId: m.id, category: "membership", parameter: "_" } },
        update: { signal: 1 },
        create: { membershipId: m.id, groupId: group.id, category: "membership", parameter: "_", signal: 1 },
      });
    }

    // Existing petition snapshot must not change
    const snapAfter = (await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } })).governanceSnapshot as { threshold: number };
    assert.ok(Math.abs(snapAfter.threshold - 0.50) < 0.001, "Snapshot must be frozen at open time");
  } finally {
    await cleanupFixture("pet_snapshot");
  }
});

test("addPetitionSupport requires active+active membership", async () => {
  const { group, memberships } = await createFixture("pet_eligibility", 2);
  try {
    // Make second member quiet
    await prisma.groupMembership.update({ where: { id: memberships[1].id }, data: { participationStatus: "quiet" } });
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "some_account", createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Quiet member cannot support
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_eligible");

    // Active member can support
    const r2 = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    assert.equal(r2.ok, true);
  } finally {
    await cleanupFixture("pet_eligibility");
  }
});

test("addPetitionSupport rejects member from wrong group", async () => {
  const { group, memberships } = await createFixture("pet_wrong_group");
  const { memberships: otherMemberships } = await createFixture("pet_other_group");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: otherMemberships[0].accountId, membershipId: otherMemberships[0].id });
    assert.equal(r.ok, false);
  } finally {
    await cleanupFixture("pet_wrong_group");
    await cleanupFixture("pet_other_group");
  }
});

test("petition support cannot use another account's group membership", async () => {
  const { group, memberships } = await createFixture("pet_actor_group", 2);
  try {
    const result = await openPetition(prisma, {
      groupId: group.id,
      category: "membership",
      subjectType: "membership_request",
      subjectId: "x",
      createdByMembershipId: memberships[0].id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const addResult = await addPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[1].accountId,
      membershipId: memberships[0].id,
    });
    assert.deepEqual(addResult, { ok: false, reason: "not_eligible" });

    await addPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[0].accountId,
      membershipId: memberships[0].id,
    });
    const withdrawResult = await withdrawPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[1].accountId,
      membershipId: memberships[0].id,
    });
    assert.deepEqual(withdrawResult, { ok: false, reason: "not_eligible" });
    assert.equal(
      await prisma.petitionSupport.count({
        where: { petitionId: result.petitionId, membershipId: memberships[0].id },
      }),
      1,
    );
  } finally {
    await cleanupFixture("pet_actor_group");
  }
});

test("withdrawPetitionSupport removes support record", async () => {
  const { group, memberships } = await createFixture("pet_withdraw_support");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    await withdrawPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    const count = await prisma.petitionSupport.count({ where: { petitionId: result.petitionId } });
    assert.equal(count, 0);
  } finally {
    await cleanupFixture("pet_withdraw_support");
  }
});

test("evaluatePetition returns pending before closesAt", async () => {
  const { group, memberships } = await createFixture("pet_pending");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    const evalResult = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "pending");
  } finally {
    await cleanupFixture("pet_pending");
  }
});

test("evaluatePetition returns blocked when no active members", async () => {
  const { group, memberships } = await createFixture("pet_blocked");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    // Make member inactive
    await prisma.groupMembership.update({ where: { id: memberships[0].id }, data: { status: "inactive" } });
    // Backdate closesAt so petition has "expired"
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const evalResult = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "blocked");
  } finally {
    await cleanupFixture("pet_blocked");
  }
});

test("evaluatePetition: threshold met → approved", async () => {
  const { group, memberships } = await createFixture("pet_approved", 3);
  try {
    // Default threshold at temp=0 is 0.50, so 2 of 3 active members crosses it.
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    // Backdate closesAt
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const evalResult = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "approved");
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "approved");
  } finally {
    await cleanupFixture("pet_approved");
  }
});

test("evaluatePetition: threshold not met → rejected", async () => {
  const { group, memberships } = await createFixture("pet_rejected", 5);
  try {
    // Need 3/5 at the default 50% threshold; only 2 support.
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const evalResult = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "rejected");
  } finally {
    await cleanupFixture("pet_rejected");
  }
});

test("competing petitions: highest support wins; others rejected", async () => {
  const { group, memberships } = await createFixture("pet_compete", 5);
  try {
    const subjectId = "doc_abc";
    const [r1, r2] = await Promise.all([
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[0].id }),
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[1].id }),
    ]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;

    // r1 gets 4/5 support above the default threshold; r2 gets 1/5.
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: r1.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });

    // Expire both
    await prisma.petition.updateMany({ where: { id: { in: [r1.petitionId, r2.petitionId] } }, data: { closesAt: new Date(Date.now() - 1000) } });

    const evalResult = await evaluatePetition(prisma, r1.petitionId);
    assert.equal(evalResult.outcome, "approved");

    const p2 = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.equal(p2.status, "rejected");
  } finally {
    await cleanupFixture("pet_compete");
  }
});

test("competing petitions: tie → all rejected", async () => {
  const { group, memberships } = await createFixture("pet_tie", 4);
  try {
    const subjectId = "doc_tie";
    const [r1, r2] = await Promise.all([
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[0].id }),
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[1].id }),
    ]);
    if (!r1.ok || !r2.ok) return;

    // Both get 2/4 support (50% < 60% threshold — also a tie)
    await addPetitionSupport(prisma, { petitionId: r1.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: r1.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, actorAccountId: memberships[2].accountId, membershipId: memberships[2].id });
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, actorAccountId: memberships[3].accountId, membershipId: memberships[3].id });

    await prisma.petition.updateMany({ where: { id: { in: [r1.petitionId, r2.petitionId] } }, data: { closesAt: new Date(Date.now() - 1000) } });

    const evalResult = await evaluatePetition(prisma, r1.petitionId);
    assert.equal(evalResult.outcome, "rejected");
    const p2 = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.equal(p2.status, "rejected");
  } finally {
    await cleanupFixture("pet_tie");
  }
});

test("withdrawPetition does not affect competing petitions", async () => {
  const { group, memberships } = await createFixture("pet_withdraw_isolated");
  try {
    const subjectId = "doc_withdraw";
    const [r1, r2] = await Promise.all([
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[0].id }),
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[0].id }),
    ]);
    if (!r1.ok || !r2.ok) return;

    await withdrawPetition(prisma, r1.petitionId, memberships[0].id);

    const p1 = await prisma.petition.findUniqueOrThrow({ where: { id: r1.petitionId } });
    const p2 = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.equal(p1.status, "withdrawn");
    assert.equal(p2.status, "open"); // not affected
  } finally {
    await cleanupFixture("pet_withdraw_isolated");
  }
});

test("withdrawPetitionBySubject closes petition when volunteer withdraws", async () => {
  const { group, memberships } = await createFixture("pet_volunteer_withdraw");
  try {
    const volunteerId = memberships[0].id;
    const result = await openPetition(prisma, { groupId: group.id, category: "responsibility", subjectType: "responsibility_proposal", subjectId: volunteerId, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await withdrawPetitionBySubject(prisma, { subjectType: "responsibility_proposal", subjectId: volunteerId });
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "withdrawn");
  } finally {
    await cleanupFixture("pet_volunteer_withdraw");
  }
});

test("emergency petition evaluates immediately on threshold", async () => {
  const { group, memberships } = await createFixture("pet_emergency", 5);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "emergency", subjectType: "emergency_declaration", subjectId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;

    // Default emergency threshold = 0.50, so 3 of 5 active members crosses it.
    for (let i = 0; i < 3; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }

    // evaluateEmergencyPetition can be called before closesAt
    const evalResult = await evaluateEmergencyPetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "approved");
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "approved");
  } finally {
    await cleanupFixture("pet_emergency");
  }
});

test("standard evaluatePetition does not evaluate emergency petition before closesAt", async () => {
  const { group, memberships } = await createFixture("pet_no_early");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });
    // Do NOT backdate closesAt — petition still open
    const evalResult = await evaluatePetition(prisma, result.petitionId);
    assert.equal(evalResult.outcome, "pending"); // not early-activated
  } finally {
    await cleanupFixture("pet_no_early");
  }
});

// ---- Security fix tests ----

test("Fix 1: addPetitionSupport rejected after closesAt even when status is open", async () => {
  const { group, memberships } = await createFixture("pet_sec_add", 2);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    // Backdate closesAt to make petition window appear elapsed (status still "open")
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "petition_not_open");
  } finally {
    await cleanupFixture("pet_sec_add");
  }
});

test("Fix 1: withdrawPetitionSupport rejected after closesAt", async () => {
  const { group, memberships } = await createFixture("pet_sec_withdraw", 2);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    // Add support while window is open
    await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    // Elapse window
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    // Withdrawal after closesAt must be rejected
    const r = await withdrawPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "petition_not_open");
    // Support record must still exist (not silently deleted)
    const count = await prisma.petitionSupport.count({ where: { petitionId: result.petitionId } });
    assert.equal(count, 1);
  } finally {
    await cleanupFixture("pet_sec_withdraw");
  }
});

test("Fix 2: requireApprovedPetition throws for non-approved petition", async () => {
  const { group, memberships } = await createFixture("pet_sec_guard", 1);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    // Petition is still open — should throw
    await assert.rejects(
      () => requireApprovedPetition(prisma, result.petitionId, "membership_request"),
      /not approved/,
    );
  } finally {
    await cleanupFixture("pet_sec_guard");
  }
});

test("Fix 2: requireApprovedPetition throws for wrong family", async () => {
  const { group, memberships } = await createFixture("pet_sec_family", 3);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    // Petition is approved (membership_request) but wrong family passed
    await assert.rejects(
      () => requireApprovedPetition(prisma, result.petitionId, "bulletin_archive"),
      /bulletin_archive/,
    );
  } finally {
    await cleanupFixture("pet_sec_family");
  }
});

test("Fix 3: openPetition rejects creator from a different group", async () => {
  const { group } = await createFixture("pet_sec_creator");
  const { memberships: otherMemberships } = await createFixture("pet_sec_other");
  try {
    // Creator membership belongs to a different group
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: otherMemberships[0].id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "creator_not_eligible");
  } finally {
    await cleanupFixture("pet_sec_creator");
    await cleanupFixture("pet_sec_other");
  }
});

test("Fix 1 (emergency guard): evaluateEmergencyPetition throws on non-emergency petition", async () => {
  const { group, memberships } = await createFixture("pet_sec_eme_guard", 3);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await assert.rejects(
      () => evaluateEmergencyPetition(prisma, result.petitionId),
      /emergency_declaration/,
    );
  } finally {
    await cleanupFixture("pet_sec_eme_guard");
  }
});

test("Fix 2 (staggered winners): late-closing competing petition is rejected when earlier one already approved", async () => {
  const { group, memberships } = await createFixture("pet_sec_stagger", 5);
  try {
    const subjectId = "doc_stagger";
    // Two competing petitions — r1 closes earlier than r2
    const [r1, r2] = await Promise.all([
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[0].id }),
      openPetition(prisma, { groupId: group.id, category: "living_document", subjectType: "living_document_revision", subjectId, createdByMembershipId: memberships[1].id }),
    ]);
    if (!r1.ok || !r2.ok) return;

    // Both get enough support to meet threshold (60% of 5 = 3)
    for (let i = 0; i < 4; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: r1.petitionId, membershipId: memberships[i].id } });
    }
    for (let i = 0; i < 4; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: r2.petitionId, membershipId: memberships[i].id } });
    }

    // r1 closes first, r2 still has future closesAt
    await prisma.petition.update({ where: { id: r1.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, r1.petitionId);

    const p1After = await prisma.petition.findUniqueOrThrow({ where: { id: r1.petitionId } });
    assert.equal(p1After.status, "approved");

    // Now r2 closes — must be rejected because r1 already won
    await prisma.petition.update({ where: { id: r2.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    const evalResult = await evaluatePetition(prisma, r2.petitionId);
    assert.equal(evalResult.outcome, "rejected");

    const p2After = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.equal(p2After.status, "rejected");
  } finally {
    await cleanupFixture("pet_sec_stagger");
  }
});

test("Fix 3: openPetition rejects creator who is not active-participation", async () => {
  const { group, memberships } = await createFixture("pet_sec_quiet_creator", 2);
  try {
    await prisma.groupMembership.update({ where: { id: memberships[0].id }, data: { participationStatus: "quiet" } });
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "creator_not_eligible");
  } finally {
    await cleanupFixture("pet_sec_quiet_creator");
  }
});

// ---- voterScope tests ----

test("addPetitionSupport rejects group-member support on project-scoped petition", async () => {
  const { group, memberships } = await createFixture("pet_vs_rej", 2);
  const project = await prisma.project.create({ data: { id: "pet_vs_rej_proj", foundingGroupId: group.id, name: "VS Proj", status: "active" } });
  try {
    // memberships[0] is NOT a project member
    const result = await openPetition(prisma, {
      groupId: group.id,
      category: "contribution_category",
      subjectType: "contribution_category_proposal",
      subjectId: "dummy_draft_id",
      createdByMembershipId: memberships[0].id,
      voterScope: { type: "project", scopeId: project.id },
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    const supportResult = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[1].accountId, membershipId: memberships[1].id });
    assert.equal(supportResult.ok, false);
    if (!supportResult.ok) assert.equal(supportResult.reason, "not_eligible");
  } finally {
    await prisma.petition.deleteMany({ where: { groupId: group.id } });
    await prisma.project.deleteMany({ where: { id: "pet_vs_rej_proj" } });
    await cleanupFixture("pet_vs_rej");
  }
});

test("addPetitionSupport succeeds for project member on project-scoped petition", async () => {
  const { group, memberships } = await createFixture("pet_vs_ok", 2);
  const project = await prisma.project.create({ data: { id: "pet_vs_ok_proj", foundingGroupId: group.id, name: "VS Proj OK", status: "active" } });
  try {
    const acct1 = await prisma.groupMembership.findUniqueOrThrow({ where: { id: memberships[0].id }, select: { accountId: true } });
    const projectMembership = await prisma.projectMembership.create({ data: { accountId: acct1.accountId, projectId: project.id, status: "active", participationStatus: "active" } });
    const result = await openPetition(prisma, {
      groupId: group.id,
      category: "contribution_category",
      subjectType: "contribution_category_proposal",
      subjectId: "dummy_draft_ok",
      createdByMembershipId: memberships[0].id,
      voterScope: { type: "project", scopeId: project.id },
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    const supportResult = await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: projectMembership.accountId, projectMembershipId: projectMembership.id });
    assert.equal(supportResult.ok, true);
  } finally {
    await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: group.id } } });
    await prisma.petition.deleteMany({ where: { groupId: group.id } });
    await prisma.projectMembership.deleteMany({ where: { projectId: "pet_vs_ok_proj" } });
    await prisma.project.deleteMany({ where: { id: "pet_vs_ok_proj" } });
    await cleanupFixture("pet_vs_ok");
  }
});

test("petition support cannot use another account's project membership", async () => {
  const { group, memberships } = await createFixture("pet_actor_project", 2);
  const project = await prisma.project.create({
    data: {
      id: "pet_actor_project_proj",
      foundingGroupId: group.id,
      name: "Actor ownership project",
      status: "active",
    },
  });
  try {
    const projectMembership = await prisma.projectMembership.create({
      data: {
        accountId: memberships[0].accountId,
        projectId: project.id,
        status: "active",
        participationStatus: "active",
      },
    });
    const result = await openPetition(prisma, {
      groupId: group.id,
      category: "contribution_category",
      subjectType: "contribution_category_proposal",
      subjectId: "pet_actor_project_draft",
      createdByMembershipId: memberships[0].id,
      voterScope: { type: "project", scopeId: project.id },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const addResult = await addPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[1].accountId,
      projectMembershipId: projectMembership.id,
    });
    assert.deepEqual(addResult, { ok: false, reason: "not_eligible" });

    await addPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[0].accountId,
      projectMembershipId: projectMembership.id,
    });
    const withdrawResult = await withdrawPetitionSupport(prisma, {
      petitionId: result.petitionId,
      actorAccountId: memberships[1].accountId,
      projectMembershipId: projectMembership.id,
    });
    assert.deepEqual(withdrawResult, { ok: false, reason: "not_eligible" });
    assert.equal(
      await prisma.petitionSupport.count({
        where: { petitionId: result.petitionId, projectMembershipId: projectMembership.id },
      }),
      1,
    );
  } finally {
    await cleanupFixture("pet_actor_project");
  }
});

test("getActiveVoterCount returns group count for null-scoped petition", async () => {
  const { group } = await createFixture("pet_vc_group", 3);
  try {
    const { getActiveVoterCount } = await import("../lib/participation");
    const count = await getActiveVoterCount(prisma, { groupId: group.id, voterScope: null });
    assert.equal(count, 3);
  } finally {
    await cleanupFixture("pet_vc_group");
  }
});

test("getActiveVoterCount returns project member count for project-scoped petition", async () => {
  const { group, memberships } = await createFixture("pet_vc_proj", 3);
  const project = await prisma.project.create({ data: { id: "pet_vc_proj_p", foundingGroupId: group.id, name: "VC Proj", status: "active" } });
  try {
    // Only memberships[0] and [1] are project members
    for (let i = 0; i < 2; i++) {
      const acct = await prisma.groupMembership.findUniqueOrThrow({ where: { id: memberships[i].id }, select: { accountId: true } });
      await prisma.projectMembership.create({ data: { accountId: acct.accountId, projectId: project.id, status: "active", participationStatus: "active" } });
    }
    const { getActiveVoterCount } = await import("../lib/participation");
    const count = await getActiveVoterCount(prisma, { groupId: group.id, voterScope: { type: "project", scopeId: project.id } });
    assert.equal(count, 2);
  } finally {
    await prisma.projectMembership.deleteMany({ where: { projectId: "pet_vc_proj_p" } });
    await prisma.project.deleteMany({ where: { id: "pet_vc_proj_p" } });
    await cleanupFixture("pet_vc_proj");
  }
});

test("getActiveVoterCount includes project members without host-group membership", async () => {
  const { group } = await createFixture("pet_vc_proj_only", 1);
  const project = await prisma.project.create({ data: { id: "pet_vc_proj_only_p", foundingGroupId: group.id, name: "VC Project Only", status: "active" } });
  try {
    const account = await prisma.account.create({
      data: {
        id: "pet_vc_proj_only_acct_project",
        homeNodeId: `${"pet_vc_proj_only"}_node`,
        displayName: "Project Only Member",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });

    const { getActiveVoterCount } = await import("../lib/participation");
    const count = await getActiveVoterCount(prisma, {
      groupId: group.id,
      scopeType: "project",
      scopeId: project.id,
      voterScope: { type: "project", scopeId: project.id },
    });
    assert.equal(count, 1);
  } finally {
    await prisma.projectMembership.deleteMany({ where: { projectId: "pet_vc_proj_only_p" } });
    await prisma.project.deleteMany({ where: { id: "pet_vc_proj_only_p" } });
    await cleanupFixture("pet_vc_proj_only");
  }
});

// ---- withdrawPetition outcome ----

test("withdrawPetition: creator withdraws an open petition", async () => {
  const { group, memberships } = await createFixture("pet_wd_creator");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    const outcome = await withdrawPetition(prisma, result.petitionId, memberships[0].id);
    assert.deepEqual(outcome, { outcome: "withdrawn" });
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "withdrawn");
    assert.notEqual(petition.resolvedAt, null);
  } finally {
    await cleanupFixture("pet_wd_creator");
  }
});

test("withdrawPetition: non-creator cannot withdraw", async () => {
  const { group, memberships } = await createFixture("pet_wd_noncreator", 2);
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    const outcome = await withdrawPetition(prisma, result.petitionId, memberships[1].id);
    assert.deepEqual(outcome, { outcome: "not_eligible" });
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "open");
  } finally {
    await cleanupFixture("pet_wd_noncreator");
  }
});

test("withdrawPetition: creator cannot withdraw an already-resolved petition", async () => {
  const { group, memberships } = await createFixture("pet_wd_resolved");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved", resolvedAt: new Date() } });
    const outcome = await withdrawPetition(prisma, result.petitionId, memberships[0].id);
    assert.deepEqual(outcome, { outcome: "not_eligible" });
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "approved");
  } finally {
    await cleanupFixture("pet_wd_resolved");
  }
});

// ---- archiveStalePetitions ----

test("archiveStalePetitions archives resolved petitions past the 30-day cutoff", async () => {
  const { group, memberships } = await createFixture("pet_archive");
  try {
    const r1 = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "old", createdByMembershipId: memberships[0].id });
    const r2 = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "recent", createdByMembershipId: memberships[0].id });
    if (!r1.ok || !r2.ok) return;

    const now = new Date("2026-06-01T00:00:00Z");
    const exactlyCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const newerThanCutoff = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    await prisma.petition.update({ where: { id: r1.petitionId }, data: { status: "approved", resolvedAt: exactlyCutoff } });
    await prisma.petition.update({ where: { id: r2.petitionId }, data: { status: "approved", resolvedAt: newerThanCutoff } });

    await archiveStalePetitions(prisma, group.id, now);

    const p1 = await prisma.petition.findUniqueOrThrow({ where: { id: r1.petitionId } });
    const p2 = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.deepEqual(p1.archivedAt, now);
    assert.equal(p2.archivedAt, null);

    // Idempotent: re-running is a no-op (does not re-stamp archivedAt)
    const later = new Date(now.getTime() + 1000);
    await archiveStalePetitions(prisma, group.id, later);
    const p1Again = await prisma.petition.findUniqueOrThrow({ where: { id: r1.petitionId } });
    assert.deepEqual(p1Again.archivedAt, now);
  } finally {
    await cleanupFixture("pet_archive");
  }
});

test("archiveStalePetitions leaves open petitions untouched", async () => {
  const { group, memberships } = await createFixture("pet_archive_open");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await archiveStalePetitions(prisma, group.id, farFuture);
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "open");
    assert.equal(petition.archivedAt, null);
  } finally {
    await cleanupFixture("pet_archive_open");
  }
});

// ---- petitionFilterWhere (pure helper) ----

test("petitionFilterWhere returns the expected where clause for each filter value", () => {
  assert.deepEqual(petitionFilterWhere("all"), { archivedAt: null });
  assert.deepEqual(petitionFilterWhere("open"), { status: "open", archivedAt: null });
  assert.deepEqual(petitionFilterWhere("closed"), { status: { not: "open" }, archivedAt: null });
  assert.deepEqual(petitionFilterWhere("approved"), { status: "approved", archivedAt: null });
  assert.deepEqual(petitionFilterWhere("rejected"), { status: "rejected", archivedAt: null });
  assert.deepEqual(petitionFilterWhere("archived"), { archivedAt: { not: null } });
  assert.equal(PETITION_FILTER_VALUES.length, 6);
});

// ---- evaluateAndApplyPetition / resolveExpiredPetitions ----

test("evaluateAndApplyPetition: emergency petition activates early when threshold crossed", async () => {
  const { group, memberships } = await createFixture("pet_eval_emer1", 5);
  try {
    const r = await openPetition(prisma, { groupId: group.id, category: "emergency", subjectType: "emergency_declaration", subjectId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    // 3 of 5 = 60% > 50% default threshold
    for (let i = 0; i < 3; i++) {
      await addPetitionSupport(prisma, { petitionId: r.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }

    // closesAt is NOT backdated — this tests early activation
    const result = await evaluateAndApplyPetition(prisma, r.petitionId);
    assert.equal(result.outcome, "approved");

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: r.petitionId } });
    assert.equal(petition.status, "approved");

    const periods = await prisma.emergencyPeriod.findMany({ where: { groupId: group.id } });
    assert.equal(periods.length, 1);
  } finally {
    await prisma.emergencyPeriod.deleteMany({ where: { groupId: { startsWith: "pet_eval_emer1" } } });
    await cleanupFixture("pet_eval_emer1");
  }
});

test("evaluateAndApplyPetition: emergency petition rejects at closesAt when threshold not met", async () => {
  const { group, memberships } = await createFixture("pet_eval_emer2", 5);
  try {
    const r = await openPetition(prisma, { groupId: group.id, category: "emergency", subjectType: "emergency_declaration", subjectId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    // Only 1 of 5 = 20% — below threshold
    await addPetitionSupport(prisma, { petitionId: r.petitionId, actorAccountId: memberships[0].accountId, membershipId: memberships[0].id });

    await prisma.petition.update({ where: { id: r.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });

    const result = await evaluateAndApplyPetition(prisma, r.petitionId);
    assert.equal(result.outcome, "rejected");

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: r.petitionId } });
    assert.equal(petition.status, "rejected");

    const periods = await prisma.emergencyPeriod.findMany({ where: { groupId: group.id } });
    assert.equal(periods.length, 0);
  } finally {
    await cleanupFixture("pet_eval_emer2");
  }
});

test("evaluateAndApplyPetition: loser-first evaluation dispatches winner's side effect", async () => {
  const { group, memberships } = await createFixture("pet_eval_compete", 5);
  try {
    const proposal = await prisma.proposal.create({
      data: {
        groupId: group.id,
        title: "Compete Winner Project",
        body: "",
        createdByAccountId: memberships[0].accountId,
        status: "open",
      },
    });

    const snapshot = { threshold: 0.5 };
    const closesAt = new Date(Date.now() - 1000);
    const opensAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const competitionKey = `${group.id}:project_proposal:compete_test_shared`;

    const winnerPetition = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "project", subjectType: "project_proposal", subjectId: proposal.id,
        competitionKey, status: "open",
        governanceSnapshot: snapshot as object,
        opensAt, closesAt,
      },
    });

    const loserPetition = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "project", subjectType: "project_proposal", subjectId: "pet_ec_loser_noproposal",
        competitionKey, status: "open",
        governanceSnapshot: snapshot as object,
        opensAt, closesAt,
      },
    });

    // Winner: 4/5 support (80%); loser: 1/5 (20%)
    for (let i = 0; i < 4; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: winnerPetition.id, membershipId: memberships[i].id } });
    }
    await prisma.petitionSupport.create({ data: { petitionId: loserPetition.id, membershipId: memberships[0].id } });

    // Evaluate the LOSER — winner's side effect must be dispatched via result.winnerId
    const result = await evaluateAndApplyPetition(prisma, loserPetition.id);
    assert.equal(result.outcome, "rejected");

    const winner = await prisma.petition.findUniqueOrThrow({ where: { id: winnerPetition.id } });
    assert.equal(winner.status, "approved");

    // Winner's side effect: Project was created from the Proposal
    const project = await prisma.project.findFirst({ where: { foundingGroupId: group.id, name: "Compete Winner Project" } });
    assert.ok(project, "Project should have been created for the winner");

    const updatedProposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    assert.equal(updatedProposal.status, "implemented");

    // Re-evaluating the already-resolved winner returns "pending" (no-op)
    const result2 = await evaluateAndApplyPetition(prisma, winnerPetition.id);
    assert.equal(result2.outcome, "pending");
  } finally {
    await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: "pet_eval_compete" } } });
    await prisma.projectHosting.deleteMany({ where: { project: { foundingGroupId: { startsWith: "pet_eval_compete" } } } });
    await prisma.proposal.deleteMany({ where: { groupId: { startsWith: "pet_eval_compete" } } });
    await cleanupFixture("pet_eval_compete");
  }
});

// Competing node_steward_appointment petitions: the loser is evaluated first,
// and the winner's side effect must be dispatched through the SPECIALIZED
// handler (evaluateNodeStewardProposalForPetition → applyProposal), not the
// generic applyApprovedPetition dispatch. node_steward_appointment is the only
// family that actually competes in production (deriveCompetitionKey returns
// `${nodeId}:node_steward_appointment`, shared across candidates).
test("evaluateAndApplyPetition: competing node-steward winner is dispatched via the specialized handler", async () => {
  const prefix = "pet_eval_steward";
  const { node, group, memberships } = await createFixture(prefix, 5);
  try {
    const snapshot = { threshold: 0.5, petitionDuration: 7 };
    const opensAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const closesAt = new Date(Date.now() - 1000);
    const competitionKey = `${node.id}:node_steward_appointment`;

    // A fresh node (stewardRevision 0, no steward) satisfies
    // proposalContextStillValid for an appointment with a null/0 baseline.
    async function makeAppointment() {
      const proposal = await prisma.nodeStewardProposal.create({
        data: {
          nodeId: node.id,
          action: "appointment",
          origin: "group",
          candidateGroupId: group.id,
          initiatingGroupId: group.id,
          initiatedByAccountId: memberships[0].accountId,
          baselineStewardGroupId: null,
          baselineStewardRevision: 0,
          status: "awaiting_node_vote",
          snapshot: { node: { id: node.id } },
        },
      });
      const petition = await prisma.petition.create({
        data: {
          groupId: null,
          scopeType: "node",
          scopeId: node.id,
          category: "node_stewardship",
          subjectType: "node_steward_appointment",
          subjectId: proposal.id,
          competitionKey,
          status: "open",
          governanceSnapshot: snapshot as object,
          opensAt,
          closesAt,
        },
      });
      await prisma.nodeStewardProposal.update({
        where: { id: proposal.id },
        data: { nodePetitionId: petition.id },
      });
      return { proposalId: proposal.id, petitionId: petition.id };
    }

    const winner = await makeAppointment();
    const loser = await makeAppointment();

    // Winner: 3/5 node votes (60% ≥ 0.5); loser: 1/5.
    for (let i = 0; i < 3; i++) {
      await prisma.nodePetitionSupport.create({ data: { petitionId: winner.petitionId, nodeId: node.id, accountId: memberships[i].accountId } });
    }
    await prisma.nodePetitionSupport.create({ data: { petitionId: loser.petitionId, nodeId: node.id, accountId: memberships[3].accountId } });

    // Evaluate the LOSER — the winner's appointment must still be applied, via
    // applyResolvedPetition(tx, result.winnerId) routing through the specialized
    // node-steward handler rather than the generic dispatch.
    const result = await evaluateAndApplyPetition(prisma, loser.petitionId);
    assert.equal(result.outcome, "rejected");

    const loserPetition = await prisma.petition.findUniqueOrThrow({ where: { id: loser.petitionId } });
    const winnerPetition = await prisma.petition.findUniqueOrThrow({ where: { id: winner.petitionId } });
    assert.equal(loserPetition.status, "rejected");
    assert.equal(winnerPetition.status, "approved");

    const winnerProposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: winner.proposalId } });
    const loserProposal = await prisma.nodeStewardProposal.findUniqueOrThrow({ where: { id: loser.proposalId } });
    assert.equal(winnerProposal.status, "succeeded", "winner proposal must advance via the specialized handler");
    assert.equal(loserProposal.status, "failed-rejected", "loser proposal must be failed via failProposal");

    const updatedNode = await prisma.node.findUniqueOrThrow({ where: { id: node.id } });
    assert.equal(updatedNode.stewardRevision, 1, "applyProposal must have incremented stewardRevision");
    assert.equal(updatedNode.stewardGroupId, group.id, "winner candidate group must be installed as steward");

    // Re-evaluating the already-resolved winner is a no-op (non-open short-circuit).
    const result2 = await evaluateAndApplyPetition(prisma, winner.petitionId);
    assert.equal(result2.outcome, "pending");
    const nodeAfter = await prisma.node.findUniqueOrThrow({ where: { id: node.id } });
    assert.equal(nodeAfter.stewardRevision, 1, "re-evaluation must not re-apply the appointment");
  } finally {
    await prisma.nodePetitionSupport.deleteMany({ where: { nodeId: { startsWith: prefix } } });
    await prisma.petition.deleteMany({ where: { scopeId: { startsWith: prefix } } });
    await prisma.nodeStewardProposal.deleteMany({ where: { nodeId: { startsWith: prefix } } });
    await prisma.actionLog.deleteMany({ where: { nodeId: { startsWith: prefix } } });
    await cleanupFixture(prefix);
  }
});

test("resolveExpiredPetitions: failed petition stays open while successful one resolves", async () => {
  const { group, memberships } = await createFixture("pet_eval_sweep", 3);
  try {
    // Drain any due petitions from prior runs before creating our test data
    await resolveExpiredPetitions(prisma);

    const closesAt = new Date(Date.now() - 1000);
    const opensAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const snapshot = { threshold: 0.5 };

    // Petition A: no support → rejected (counts as resolved)
    const petitionA = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "membership", subjectType: "membership_request", subjectId: "pet_es_fake_member",
        competitionKey: `${group.id}:membership_request:pet_es_fake_member`,
        status: "open", governanceSnapshot: snapshot as object, opensAt, closesAt,
      },
    });

    // Petition B: 2/3 support but missing Proposal → would approve but throws at dispatch
    const petitionB = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "project", subjectType: "project_proposal", subjectId: "pet_es_missing_proposal",
        competitionKey: `${group.id}:project_proposal:pet_es_missing_proposal`,
        status: "open", governanceSnapshot: snapshot as object, opensAt, closesAt,
      },
    });
    for (let i = 0; i < 2; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: petitionB.id, membershipId: memberships[i].id } });
    }

    const stats = await resolveExpiredPetitions(prisma);

    // resolveExpiredPetitions is global; assert tolerantly (a shared/seeded DB may carry other due
    // petitions, e.g. a stuck seed proposal). The per-petition outcomes below are the real check.
    assert.ok(stats.attempted >= 2, `attempted ${stats.attempted} should include our two`);
    assert.ok(stats.resolved >= 1, `resolved ${stats.resolved} should include petition A`);
    assert.ok(stats.failed >= 1, `failed ${stats.failed} should include petition B`);

    const afterA = await prisma.petition.findUniqueOrThrow({ where: { id: petitionA.id } });
    const afterB = await prisma.petition.findUniqueOrThrow({ where: { id: petitionB.id } });
    assert.equal(afterA.status, "rejected");
    assert.equal(afterB.status, "open");
    assert.equal(afterB.resolvedAt, null);
  } finally {
    await cleanupFixture("pet_eval_sweep");
  }
});

test("evaluateAndApplyPetition: concurrent calls produce exactly one EmergencyPeriod", async () => {
  const { group, memberships } = await createFixture("pet_eval_race", 5);
  const prisma2 = createPrismaClient();
  try {
    const r = await openPetition(prisma, { groupId: group.id, category: "emergency", subjectType: "emergency_declaration", subjectId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    for (let i = 0; i < 3; i++) {
      await addPetitionSupport(prisma, { petitionId: r.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }

    const [res1, res2] = await Promise.all([
      evaluateAndApplyPetition(prisma, r.petitionId),
      evaluateAndApplyPetition(prisma2, r.petitionId),
    ]);

    // One transaction wins the updateMany guard; the other serializes and finds status no longer "open"
    const outcomes = [res1.outcome, res2.outcome].sort();
    assert.deepEqual(outcomes, ["approved", "pending"]);

    const periods = await prisma.emergencyPeriod.findMany({ where: { groupId: group.id } });
    assert.equal(periods.length, 1);
  } finally {
    await prisma2.$disconnect();
    await prisma.emergencyPeriod.deleteMany({ where: { groupId: { startsWith: "pet_eval_race" } } });
    await cleanupFixture("pet_eval_race");
  }
});

test("evaluateAndApplyPetition: side-effect failure rolls back the status transition", async () => {
  const { group, memberships } = await createFixture("pet_eval_rollback", 3);
  try {
    const closesAt = new Date(Date.now() - 1000);
    const opensAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

    const petition = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "project", subjectType: "project_proposal", subjectId: "pet_er_missing_proposal",
        competitionKey: `${group.id}:project_proposal:pet_er_missing_proposal`,
        status: "open", governanceSnapshot: { threshold: 0.5 } as object, opensAt, closesAt,
      },
    });

    // 2/3 support → would cross 50% threshold
    for (let i = 0; i < 2; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: petition.id, membershipId: memberships[i].id } });
    }

    // Entire transaction rolls back when createProjectFromPetition throws for missing Proposal
    await assert.rejects(
      () => evaluateAndApplyPetition(prisma, petition.id),
      /not found/,
    );

    const p = await prisma.petition.findUniqueOrThrow({ where: { id: petition.id } });
    assert.equal(p.status, "open");
    assert.equal(p.resolvedAt, null);

    const project = await prisma.project.findFirst({ where: { foundingGroupId: group.id } });
    assert.equal(project, null);
  } finally {
    await cleanupFixture("pet_eval_rollback");
  }
});

test("evaluateAndApplyPetition: successful resolution commits status and side effect atomically", async () => {
  const { group, memberships } = await createFixture("pet_eval_commit", 3);
  try {
    const proposal = await prisma.proposal.create({
      data: {
        groupId: group.id,
        title: "Commit Test Project",
        body: "",
        createdByAccountId: memberships[0].accountId,
        status: "open",
      },
    });

    const closesAt = new Date(Date.now() - 1000);
    const opensAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

    const petition = await prisma.petition.create({
      data: {
        groupId: group.id, scopeType: "group", scopeId: group.id,
        category: "project", subjectType: "project_proposal", subjectId: proposal.id,
        competitionKey: `${group.id}:project_proposal:${proposal.id}`,
        status: "open", governanceSnapshot: { threshold: 0.5 } as object, opensAt, closesAt,
      },
    });

    // 2/3 support → approved
    for (let i = 0; i < 2; i++) {
      await prisma.petitionSupport.create({ data: { petitionId: petition.id, membershipId: memberships[i].id } });
    }

    const result = await evaluateAndApplyPetition(prisma, petition.id);
    assert.equal(result.outcome, "approved");

    const p = await prisma.petition.findUniqueOrThrow({ where: { id: petition.id } });
    assert.equal(p.status, "approved");

    const project = await prisma.project.findFirst({ where: { foundingGroupId: group.id, name: "Commit Test Project" } });
    assert.ok(project, "Project should exist");

    const hosting = await prisma.projectHosting.findFirst({ where: { projectId: project!.id } });
    assert.ok(hosting, "ProjectHosting should exist");

    const pm = await prisma.projectMembership.findFirst({ where: { projectId: project!.id } });
    assert.ok(pm, "ProjectMembership should exist");

    const updatedProposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    assert.equal(updatedProposal.status, "implemented");
  } finally {
    await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: "pet_eval_commit" } } });
    await prisma.projectHosting.deleteMany({ where: { project: { foundingGroupId: { startsWith: "pet_eval_commit" } } } });
    await prisma.proposal.deleteMany({ where: { groupId: { startsWith: "pet_eval_commit" } } });
    await cleanupFixture("pet_eval_commit");
  }
});

// ---- fixtures ----

async function createFixture(prefix: string, memberCount = 1) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.pet.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const m = await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(m);
  }
  return { node, group, memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { foundingGroupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
