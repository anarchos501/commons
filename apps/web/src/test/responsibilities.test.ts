import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  createAssignment,
  declareTempStewardship,
  endAssignmentsForMember,
  expireStaleAssignments,
  getActiveAssignees,
  getResponsibilityCoverage,
  hasActiveEligibleAssignment,
  hasUnendedAssignment,
  resignAssignment,
} from "../lib/responsibilities";
import { applyParticipationTransitions, recordGroupPresence } from "../lib/participation";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- hasUnendedAssignment / hasActiveEligibleAssignment ---

test("hasActiveEligibleAssignment returns true for active assignment on active member", async () => {
  const { membershipA } = await createFixture("haa_true");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);
  } finally {
    await cleanupFixture("haa_true");
  }
});

test("hasUnendedAssignment returns false for expired assignment", async () => {
  const { membershipA } = await createFixture("haa_expired");
  try {
    const responsibility = await prisma.responsibility.upsert({
      where: { groupId_type: { groupId: `haa_expired_groupA`, type: "reviewer" } },
      update: {},
      create: { id: `haa_expired_responsibility`, groupId: `haa_expired_groupA`, type: "reviewer" },
    });
    await prisma.responsibilityAssignment.create({
      data: {
        responsibilityId: responsibility.id,
        membershipId: membershipA.id,
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });
    assert.equal(await hasUnendedAssignment(prisma, membershipA.id, "reviewer"), false);
  } finally {
    await cleanupFixture("haa_expired");
  }
});

test("hasUnendedAssignment returns false for ended assignment", async () => {
  const { membershipA } = await createFixture("haa_ended");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    await resignAssignment(prisma, membershipA.id, "reviewer");
    assert.equal(await hasUnendedAssignment(prisma, membershipA.id, "reviewer"), false);
  } finally {
    await cleanupFixture("haa_ended");
  }
});

// --- Multi-holder ---

test("multiple members can hold the same responsibility simultaneously", async () => {
  const { membershipA, membershipB } = await createFixture("mh_multi");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    await createAssignment(prisma, membershipB.id, "reviewer");
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipB.id, "reviewer"), true);

    const assignees = await getActiveAssignees(prisma, `mh_multi_groupA`, "reviewer");
    assert.equal(assignees.length, 2);
    assert.ok(assignees.includes(membershipA.id));
    assert.ok(assignees.includes(membershipB.id));
  } finally {
    await cleanupFixture("mh_multi");
  }
});

// --- Term expiration ---

test("expireStaleAssignments ends past-due assignments with reason expired", async () => {
  const { membershipA } = await createFixture("exp_stale");
  try {
    const responsibility = await prisma.responsibility.upsert({
      where: { groupId_type: { groupId: `exp_stale_groupA`, type: "reviewer" } },
      update: {},
      create: { id: `exp_stale_responsibility`, groupId: `exp_stale_groupA`, type: "reviewer" },
    });
    const assignment = await prisma.responsibilityAssignment.create({
      data: {
        responsibilityId: responsibility.id,
        membershipId: membershipA.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expireStaleAssignments(prisma, `exp_stale_groupA`);

    const updated = await prisma.responsibilityAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.ok(updated.endedAt !== null);
    assert.equal(updated.endReason, "expired");
  } finally {
    await cleanupFixture("exp_stale");
  }
});

// --- Resignation ---

test("resignAssignment ends assignment with reason resigned", async () => {
  const { membershipA } = await createFixture("res_resign");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    await resignAssignment(prisma, membershipA.id, "reviewer");

    assert.equal(await hasUnendedAssignment(prisma, membershipA.id, "reviewer"), false);
    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: { membershipId: membershipA.id },
    });
    assert.equal(assignment?.endReason, "resigned");
  } finally {
    await cleanupFixture("res_resign");
  }
});

// --- Quiet interaction ---

test("applyParticipationTransitions ends assignments when member goes quiet", async () => {
  const { membershipA } = await createFixture("qi_quiet");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");

    // Back-date lastSeenAt to trigger quiet transition
    await prisma.groupMembership.update({
      where: { id: membershipA.id },
      data: { lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    });
    await applyParticipationTransitions(prisma, `qi_quiet_groupA`);

    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: { membershipId: membershipA.id },
    });
    assert.ok(assignment?.endedAt !== null);
    assert.equal(assignment?.endReason, "quiet");
    assert.equal(await hasUnendedAssignment(prisma, membershipA.id, "reviewer"), false);
  } finally {
    await cleanupFixture("qi_quiet");
  }
});

// --- Dormant interaction ---

test("applyParticipationTransitions ends assignments when member goes dormant", async () => {
  const { membershipA } = await createFixture("qi_dormant");
  try {
    // Set member to quiet first
    await prisma.groupMembership.update({
      where: { id: membershipA.id },
      data: { participationStatus: "quiet", lastSeenAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
    });
    await createAssignment(prisma, membershipA.id, "reviewer");

    await applyParticipationTransitions(prisma, `qi_dormant_groupA`);

    const assignment = await prisma.responsibilityAssignment.findFirst({
      where: { membershipId: membershipA.id },
    });
    assert.ok(assignment?.endedAt !== null);
    assert.equal(assignment?.endReason, "dormant");
  } finally {
    await cleanupFixture("qi_dormant");
  }
});

// --- Active return does NOT restore assignments ---

test("recordGroupPresence reactivates participation but does not restore assignments", async () => {
  const { accountA, membershipA } = await createFixture("ar_restore");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");

    // Transition to quiet (ends assignment)
    await prisma.groupMembership.update({
      where: { id: membershipA.id },
      data: { participationStatus: "quiet", lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    });
    await endAssignmentsForMember(prisma, membershipA.id, "quiet");

    // Return to active
    await recordGroupPresence(prisma, accountA.id, `ar_restore_groupA`);

    const membership = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membershipA.id } });
    assert.equal(membership.participationStatus, "active"); // participation restored
    assert.equal(await hasUnendedAssignment(prisma, membershipA.id, "reviewer"), false); // assignment was ended; not restored
  } finally {
    await cleanupFixture("ar_restore");
  }
});

// --- Coverage tracking ---

test("getResponsibilityCoverage returns covered with at least one active holder", async () => {
  const { membershipA } = await createFixture("cov_covered");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    const coverage = await getResponsibilityCoverage(prisma, `cov_covered_groupA`, "reviewer");
    assert.equal(coverage, "covered");
  } finally {
    await cleanupFixture("cov_covered");
  }
});

test("getResponsibilityCoverage returns coverage_failure when all holders are ended", async () => {
  const { membershipA } = await createFixture("cov_fail");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer");
    await resignAssignment(prisma, membershipA.id, "reviewer");
    const coverage = await getResponsibilityCoverage(prisma, `cov_fail_groupA`, "reviewer");
    assert.equal(coverage, "coverage_failure");
  } finally {
    await cleanupFixture("cov_fail");
  }
});

// --- Emergency coverage ---

test("declareTempStewardship creates assignment during coverage failure", async () => {
  const { membershipA } = await createFixture("ecs_create");
  try {
    await declareTempStewardship(prisma, membershipA.id, "reviewer");
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);
    const coverage = await getResponsibilityCoverage(prisma, `ecs_create_groupA`, "reviewer");
    assert.equal(coverage, "covered");
  } finally {
    await cleanupFixture("ecs_create");
  }
});

test("declareTempStewardship: first declaration succeeds; normal confirmation required once coverage is restored", async () => {
  // "Multiple allowed" means no single-seat lock: any active member can declare during a
  // coverage failure without competing for a seat. But once coverage is restored by any
  // declaration, the emergency path is closed — further declarations are refused.
  const { membershipA, membershipB } = await createFixture("ecs_multi");
  try {
    await declareTempStewardship(prisma, membershipA.id, "reviewer"); // succeeds — coverage was failing
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);
    // Coverage is now restored; second emergency declaration is correctly refused
    await assert.rejects(
      () => declareTempStewardship(prisma, membershipB.id, "reviewer"),
      /coverage failure/i,
    );
  } finally {
    await cleanupFixture("ecs_multi");
  }
});

test("declareTempStewardship is refused when coverage is already present", async () => {
  const { membershipA, membershipB } = await createFixture("ecs_refuse");
  try {
    await createAssignment(prisma, membershipA.id, "reviewer"); // coverage present
    await assert.rejects(
      () => declareTempStewardship(prisma, membershipB.id, "reviewer"),
      /coverage failure/i,
    );
  } finally {
    await cleanupFixture("ecs_refuse");
  }
});

// --- Group isolation (the key RFC-004 invariant) ---

test("group isolation: going quiet in Group B terminates assignment; Group A reviewer unaffected", async () => {
  // This test proves the constitutional property that:
  //   1. Membership is group-scoped (Alice can be Active in Group A and Quiet in Group B)
  //   2. Going Quiet TERMINATES the assignment (not merely suspends it)
  //   3. The participation transition, which calls endAssignmentsForMember, is the mechanism
  const { membershipA, membershipB_groupB } = await createFixture("gi_iso");
  try {
    // Alice gets reviewer assignment in both Group A and Group B
    await createAssignment(prisma, membershipA.id, "reviewer");
    await createAssignment(prisma, membershipB_groupB.id, "reviewer");

    // Both are active and eligible before transition
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipB_groupB.id, "reviewer"), true);

    // Trigger the Quiet transition for Group B by back-dating lastSeenAt
    await prisma.groupMembership.update({
      where: { id: membershipB_groupB.id },
      data: { lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    });
    await applyParticipationTransitions(prisma, `gi_iso_groupB`);

    // Group A: unaffected — assignment still active
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipA.id, "reviewer"), true);

    // Group B: assignment was TERMINATED (endedAt set), not just suspended
    assert.equal(await hasActiveEligibleAssignment(prisma, membershipB_groupB.id, "reviewer"), false);
    assert.equal(await hasUnendedAssignment(prisma, membershipB_groupB.id, "reviewer"), false);

    // Coverage reflects the group-scoped state
    assert.equal(await getResponsibilityCoverage(prisma, `gi_iso_groupA`, "reviewer"), "covered");
    assert.equal(await getResponsibilityCoverage(prisma, `gi_iso_groupB`, "reviewer"), "coverage_failure");
  } finally {
    await cleanupFixture("gi_iso");
  }
});

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });

  const groupA = await prisma.group.create({
    data: { id: `${prefix}_groupA`, nodeId: node.id, name: `Group A ${prefix}`, membershipPolicy: "open" },
  });

  const groupB = await prisma.group.create({
    data: { id: `${prefix}_groupB`, nodeId: node.id, name: `Group B ${prefix}`, membershipPolicy: "open" },
  });

  const accountA = await prisma.account.create({
    data: { id: `${prefix}_accountA`, homeNodeId: node.id, displayName: `Alice ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const accountB = await prisma.account.create({
    data: { id: `${prefix}_accountB`, homeNodeId: node.id, displayName: `Bob ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const membershipA = await prisma.groupMembership.create({
    data: { accountId: accountA.id, groupId: groupA.id, status: "active", participationStatus: "active" },
  });

  const membershipB = await prisma.groupMembership.create({
    data: { accountId: accountB.id, groupId: groupA.id, status: "active", participationStatus: "active" },
  });

  // membershipB_groupB: accountA in Group B (for group isolation test)
  const membershipB_groupB = await prisma.groupMembership.create({
    data: { accountId: accountA.id, groupId: groupB.id, status: "active", participationStatus: "active" },
  });

  return { node, groupA, groupB, accountA, accountB, membershipA, membershipB, membershipB_groupB };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.responsibilityAssignment.deleteMany({
    where: { membership: { groupId: { startsWith: prefix } } },
  });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
