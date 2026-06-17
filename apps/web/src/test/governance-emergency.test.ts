import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  isEmergencyActive,
  openEmergencyPetition,
  onEmergencyPetitionApproved,
  signalAndEvaluateEmergency,
} from "../lib/emergency";
import { evaluateEmergencyPetition, addPetitionSupport } from "../lib/petitions";
import { grantAbility, hasAbilityNow } from "../lib/responsibility-abilities";
import { createAssignment } from "../lib/responsibilities";
import { proposeBulletinCreation } from "../lib/bulletins";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("isEmergencyActive returns false when no emergency period exists", async () => {
  const { group } = await createFixture("ge_none");
  try {
    const active = await isEmergencyActive(prisma, group.id);
    assert.equal(active, false);
  } finally {
    await cleanupFixture("ge_none");
  }
});

test("emergency petition activates immediately on threshold", async () => {
  const { group, memberships } = await createFixture("ge_activate", 5);
  try {
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Default threshold = 0.50, so 3 of 5 active members crosses it.
    for (let i = 0; i < 3; i++) {
      const { eval: evalResult } = await signalAndEvaluateEmergency(prisma, { petitionId: result.petitionId, accountId: memberships[i].accountId, membershipId: memberships[i].id });
      if (i < 2) {
        // Not yet at threshold
        assert.ok(evalResult === null || evalResult.outcome !== "approved");
      } else {
        // 3rd support crosses threshold
        assert.equal(evalResult?.outcome, "approved");
      }
    }

    await onEmergencyPetitionApproved(prisma, result.petitionId);
    const active = await isEmergencyActive(prisma, group.id);
    assert.equal(active, true);
  } finally {
    await cleanupFixture("ge_activate");
  }
});

test("isEmergencyActive returns false after expiresAt", async () => {
  const { group, memberships } = await createFixture("ge_expired", 5);
  try {
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    // Backdate expiresAt to make it appear expired
    await prisma.emergencyPeriod.updateMany({
      where: { groupId: group.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const active = await isEmergencyActive(prisma, group.id);
    assert.equal(active, false);
  } finally {
    await cleanupFixture("ge_expired");
  }
});

test("emergency duration uses governanceSnapshot (not live resolver)", async () => {
  const { group, memberships } = await createFixture("ge_snapshot", 5);
  try {
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;

    const snapshotDuration = ((await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } })).governanceSnapshot as { duration: number }).duration;

    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    const period = await prisma.emergencyPeriod.findFirst({ where: { groupId: group.id } });
    assert.ok(period);

    const durationDays = (period.expiresAt.getTime() - period.startedAt.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(durationDays - snapshotDuration) < 0.01, `Expected ${snapshotDuration} days, got ${durationDays}`);
  } finally {
    await cleanupFixture("ge_snapshot");
  }
});

test("emergency duration at default temperature is 14 days", async () => {
  const { group, memberships } = await createFixture("ge_30days", 5);
  try {
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    const period = await prisma.emergencyPeriod.findFirst({ where: { groupId: group.id } });
    assert.ok(period);
    const durationDays = (period.expiresAt.getTime() - period.startedAt.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(durationDays - 14) < 0.01, `Expected 14 days, got ${durationDays}`);
  } finally {
    await cleanupFixture("ge_30days");
  }
});

test("always_available ability is active regardless of emergency state", async () => {
  const { group, membership } = await createFixture("ge_always");
  try {
    await createAssignment(prisma, membership.id, "steward");
    const responsibility = await prisma.responsibility.findFirst({ where: { groupId: group.id } });
    assert.ok(responsibility);
    await grantAbility(prisma, responsibility.id, "create_bulletins", "always_available");

    // No emergency active
    const available = await hasAbilityNow(prisma, responsibility.id, "create_bulletins");
    assert.equal(available, true);
  } finally {
    await cleanupFixture("ge_always");
  }
});

test("available_during_emergency ability is inactive when no emergency is active", async () => {
  const { group, membership } = await createFixture("ge_eme_inactive");
  try {
    await createAssignment(prisma, membership.id, "coord");
    const responsibility = await prisma.responsibility.findFirst({ where: { groupId: group.id } });
    assert.ok(responsibility);
    await grantAbility(prisma, responsibility.id, "approve_membership", "available_during_emergency");

    const available = await hasAbilityNow(prisma, responsibility.id, "approve_membership");
    assert.equal(available, false);
  } finally {
    await cleanupFixture("ge_eme_inactive");
  }
});

test("available_during_emergency ability becomes active when emergency is declared", async () => {
  const { group, membership, memberships } = await createFixture("ge_eme_active", 5);
  try {
    await createAssignment(prisma, membership.id, "coord");
    const responsibility = await prisma.responsibility.findFirst({ where: { groupId: group.id } });
    assert.ok(responsibility);
    await grantAbility(prisma, responsibility.id, "approve_membership", "available_during_emergency");

    // Not yet active
    assert.equal(await hasAbilityNow(prisma, responsibility.id, "approve_membership"), false);

    // Declare emergency
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    // Now active
    assert.equal(await hasAbilityNow(prisma, responsibility.id, "approve_membership"), true);
  } finally {
    await cleanupFixture("ge_eme_active");
  }
});

test("available_during_emergency ability becomes inactive after emergency expires", async () => {
  const { group, membership, memberships } = await createFixture("ge_eme_expire", 5);
  try {
    await createAssignment(prisma, membership.id, "coord");
    const responsibility = await prisma.responsibility.findFirst({ where: { groupId: group.id } });
    assert.ok(responsibility);
    await grantAbility(prisma, responsibility.id, "approve_membership", "available_during_emergency");

    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    // Active during emergency
    assert.equal(await hasAbilityNow(prisma, responsibility.id, "approve_membership"), true);

    // Expire the emergency
    await prisma.emergencyPeriod.updateMany({ where: { groupId: group.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    // Now inactive
    assert.equal(await hasAbilityNow(prisma, responsibility.id, "approve_membership"), false);
  } finally {
    await cleanupFixture("ge_eme_expire");
  }
});

// ---- F1: emergency-only ability is observable end-to-end via the responsibility-acting path ----

test("emergency-only create_bulletins is enforced on the acting-as path and unlocked only during an emergency (F1.2/F1.3)", async () => {
  const { group, membership, memberships } = await createFixture("ge_acting", 5);
  try {
    await createAssignment(prisma, membership.id, "comms");
    const responsibility = await prisma.responsibility.findFirstOrThrow({ where: { groupId: group.id, type: "comms" } });
    await grantAbility(prisma, responsibility.id, "create_bulletins", "available_during_emergency");

    const actingArgs = {
      spaceType: "group" as const,
      spaceId: group.id,
      groupId: group.id,
      createdByMembershipId: membership.id,
      actingResponsibilityId: responsibility.id,
      title: "Acting bulletin",
      body: "Posted as the Comms responsibility.",
    };

    // No emergency: the emergency-only ability is not available now → acting-as path is refused.
    const blocked = await proposeBulletinCreation(prisma, actingArgs);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "ability_required");

    // The egalitarian baseline is untouched: the SAME member proposing as themselves always succeeds.
    const baseline = await proposeBulletinCreation(prisma, {
      spaceType: "group",
      spaceId: group.id,
      groupId: group.id,
      createdByMembershipId: membership.id,
      title: "Member bulletin",
      body: "Posted as a plain member.",
    });
    assert.equal(baseline.ok, true);

    // Declare an emergency.
    const result = await openEmergencyPetition(prisma, { groupId: group.id, createdByMembershipId: memberships[0].id });
    if (!result.ok) return;
    for (let i = 0; i < 4; i++) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: memberships[i].accountId, membershipId: memberships[i].id });
    }
    await evaluateEmergencyPetition(prisma, result.petitionId);
    await onEmergencyPetitionApproved(prisma, result.petitionId);

    // Now the acting-as path is unlocked — emergency state observably changes behavior.
    const allowed = await proposeBulletinCreation(prisma, actingArgs);
    assert.equal(allowed.ok, true);
  } finally {
    await cleanupFixture("ge_acting");
  }
});

// ---- fixtures ----

async function createFixture(prefix: string, memberCount = 1) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.eme.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const a = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const m = await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: a.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(m);
  }
  return { node, group, membership: memberships[0], memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contentCreationDraft.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.emergencyPeriod.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
