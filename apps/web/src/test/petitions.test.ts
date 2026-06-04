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
} from "../lib/petitions";
import { isProposalFamily, categoryForFamily } from "../lib/governance-proposal-families";

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
    assert.equal(snap.threshold, 0.60); // default at temperature 0
    assert.equal(snap.petitionDuration, 7);
    // closesAt should be ~7 days from now
    const diffMs = petition.closesAt.getTime() - petition.opensAt.getTime();
    assert.ok(Math.abs(diffMs - 7 * 24 * 60 * 60 * 1000) < 5000);
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
    assert.ok(Math.abs(snapBefore.threshold - 0.60) < 0.001);

    // All members signal +1 → temperature = 1.0 → threshold should become 0.40 for new petitions
    for (const m of memberships) {
      await prisma.memberGovernanceSignal.upsert({
        where: { membershipId_category: { membershipId: m.id, category: "membership" } },
        update: { signal: 1 },
        create: { membershipId: m.id, groupId: group.id, category: "membership", signal: 1 },
      });
    }

    // Existing petition snapshot must not change
    const snapAfter = (await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } })).governanceSnapshot as { threshold: number };
    assert.ok(Math.abs(snapAfter.threshold - 0.60) < 0.001, "Snapshot must be frozen at open time");
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
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_eligible");

    // Active member can support
    const r2 = await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
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
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: otherMemberships[0].id });
    assert.equal(r.ok, false);
  } finally {
    await cleanupFixture("pet_wrong_group");
    await cleanupFixture("pet_other_group");
  }
});

test("withdrawPetitionSupport removes support record", async () => {
  const { group, memberships } = await createFixture("pet_withdraw_support");
  try {
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
    await withdrawPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
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
    // Default threshold at temp=0 is 0.60 → need 2 of 3 active members
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
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
    // Need 3/5 (60%) — only 2 support
    const result = await openPetition(prisma, { groupId: group.id, category: "membership", subjectType: "membership_request", subjectId: "x", createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
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

    // r1 gets 4/5 support (above 0.60 threshold); r2 gets 1/5
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: r1.petitionId, membershipId: memberships[i].id });
    }
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, membershipId: memberships[0].id });

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
    await addPetitionSupport(prisma, { petitionId: r1.petitionId, membershipId: memberships[0].id });
    await addPetitionSupport(prisma, { petitionId: r1.petitionId, membershipId: memberships[1].id });
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, membershipId: memberships[2].id });
    await addPetitionSupport(prisma, { petitionId: r2.petitionId, membershipId: memberships[3].id });

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

    // Default emergency threshold = 0.80 → need 4 of 5 active members
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[i].id });
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
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[0].id });
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
    const r = await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
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
    await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
    // Elapse window
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    // Withdrawal after closesAt must be rejected
    const r = await withdrawPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
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
  const project = await prisma.project.create({ data: { id: "pet_vs_rej_proj", groupId: group.id, name: "VS Proj", status: "active" } });
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
    const supportResult = await addPetitionSupport(prisma, { petitionId: result.petitionId, membershipId: memberships[1].id });
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
  const project = await prisma.project.create({ data: { id: "pet_vs_ok_proj", groupId: group.id, name: "VS Proj OK", status: "active" } });
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
    const supportResult = await addPetitionSupport(prisma, { petitionId: result.petitionId, projectMembershipId: projectMembership.id });
    assert.equal(supportResult.ok, true);
  } finally {
    await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: group.id } } });
    await prisma.petition.deleteMany({ where: { groupId: group.id } });
    await prisma.projectMembership.deleteMany({ where: { projectId: "pet_vs_ok_proj" } });
    await prisma.project.deleteMany({ where: { id: "pet_vs_ok_proj" } });
    await cleanupFixture("pet_vs_ok");
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
  const project = await prisma.project.create({ data: { id: "pet_vc_proj_p", groupId: group.id, name: "VC Proj", status: "active" } });
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
  const project = await prisma.project.create({ data: { id: "pet_vc_proj_only_p", groupId: group.id, name: "VC Project Only", status: "active" } });
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
  await prisma.projectMembership.deleteMany({ where: { project: { groupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
