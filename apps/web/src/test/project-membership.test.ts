import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  applyGroupDormancyToProjectMemberships,
  applyProjectParticipationTransitions,
  leaveProject,
  recordProjectPresence,
  requireProjectMembership,
  syncProjectHostingLifecycle,
} from "../lib/project-membership";
import { applyParticipationTransitions } from "../lib/participation";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- requireProjectMembership ---

test("requireProjectMembership passes for active member", async () => {
  const { account, project } = await createFixture("rpm_pass");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });
    await assert.doesNotReject(() => requireProjectMembership(prisma, account.id, project.id));
  } finally {
    await cleanupFixture("rpm_pass");
  }
});

test("requireProjectMembership throws for non-member", async () => {
  const { account, project } = await createFixture("rpm_nonmember");
  try {
    await assert.rejects(
      () => requireProjectMembership(prisma, account.id, project.id),
      /Active project membership required/,
    );
  } finally {
    await cleanupFixture("rpm_nonmember");
  }
});

test("requireProjectMembership throws for inactive member", async () => {
  const { account, project } = await createFixture("rpm_inactive");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "inactive" },
    });
    await assert.rejects(
      () => requireProjectMembership(prisma, account.id, project.id),
      /Active project membership required/,
    );
  } finally {
    await cleanupFixture("rpm_inactive");
  }
});

// --- leaveProject ---

test("leaveProject sets membership status to inactive", async () => {
  const { account, project } = await createFixture("lp_leave");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });
    await leaveProject(prisma, account.id, project.id);
    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(m.status, "inactive");
  } finally {
    await cleanupFixture("lp_leave");
  }
});

test("leaveProject is blocked while a project is pending closure", async () => {
  const { account, group, project } = await createFixture("lp_pending");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.project.update({ where: { id: project.id }, data: { pendingClosureAt: new Date() } });

    await assert.rejects(
      () => leaveProject(prisma, account.id, project.id),
      /pending closure/,
    );
  } finally {
    await cleanupFixture("lp_pending");
  }
});

// --- recordProjectPresence ---

test("recordProjectPresence reactivates a Quiet member", async () => {
  const { account, project } = await createFixture("rpp_reactivate");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "quiet" },
    });
    await recordProjectPresence(prisma, account.id, project.id);
    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(m.participationStatus, "active");
  } finally {
    await cleanupFixture("rpp_reactivate");
  }
});

test("recordProjectPresence reactivates quiet member and updates Project.status to active", async () => {
  const { account, project } = await createFixture("rpp_sync_status");
  try {
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "quiet" },
    });
    await prisma.project.update({ where: { id: project.id }, data: { status: "quiet" } });
    await recordProjectPresence(prisma, account.id, project.id);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.status, "active");
  } finally {
    await cleanupFixture("rpp_sync_status");
  }
});

test("recordProjectPresence is rate-limited for already-active members", async () => {
  const { account, project } = await createFixture("rpp_ratelimit");
  try {
    const recentSeen = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", lastSeenAt: recentSeen },
    });
    await recordProjectPresence(prisma, account.id, project.id);
    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    // lastSeenAt should not have changed
    assert.equal(m.lastSeenAt?.getTime(), recentSeen.getTime());
  } finally {
    await cleanupFixture("rpp_ratelimit");
  }
});

// --- applyProjectParticipationTransitions ---

test("applyProjectParticipationTransitions transitions Active → Quiet after 90-day threshold", async () => {
  const { account, project } = await createFixture("appt_quiet");
  try {
    await prisma.projectMembership.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        status: "active",
        participationStatus: "active",
        lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    });
    await applyProjectParticipationTransitions(prisma, project.id);
    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(m.participationStatus, "quiet");
    // Project should now be quiet (no active members, one quiet)
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.status, "quiet");
  } finally {
    await cleanupFixture("appt_quiet");
  }
});

test("applyProjectParticipationTransitions transitions Quiet → Dormant and updates Project.status", async () => {
  const { account, project } = await createFixture("appt_dormant");
  try {
    await prisma.projectMembership.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        status: "active",
        participationStatus: "quiet",
        lastSeenAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
    });
    await applyProjectParticipationTransitions(prisma, project.id);
    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(m.participationStatus, "dormant");
    // Project should be dormant (no members, but host group remains)
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.status, "dormant");
  } finally {
    await cleanupFixture("appt_dormant");
  }
});

// --- Group dormancy interaction ---

test("group dormancy in all host groups removes project membership", async () => {
  const { account, group, project } = await createFixture("gd_all_hosts");
  try {
    // Account is an active group member and active project member
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    });
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });

    // Member goes dormant in the only host group
    await prisma.groupMembership.updateMany({
      where: { accountId: account.id, groupId: group.id },
      data: { participationStatus: "dormant" },
    });

    await applyGroupDormancyToProjectMemberships(prisma, group.id, [account.id]);

    const pm = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(pm.status, "inactive");
  } finally {
    await cleanupFixture("gd_all_hosts");
  }
});

test("group dormancy in one host group preserves membership if other host group is active", async () => {
  const { account, group, group2, project } = await createFixture("gd_multi_host");
  try {
    // Account is active in both host groups
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    });
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group2.id, status: "active", participationStatus: "active" },
    });
    // Project is hosted by both groups
    await prisma.projectHosting.create({ data: { projectId: project.id, groupId: group2.id } });
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });

    // Member goes dormant in group1 only; group2 still active
    await prisma.groupMembership.updateMany({
      where: { accountId: account.id, groupId: group.id },
      data: { participationStatus: "dormant" },
    });

    await applyGroupDormancyToProjectMemberships(prisma, group.id, [account.id]);

    const pm = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    // Membership preserved — still active in group2
    assert.equal(pm.status, "active");
  } finally {
    await cleanupFixture("gd_multi_host");
  }
});

// --- Real group transition path (end-to-end invariant) ---

test("applyParticipationTransitions dormancy removes project membership through the real group path", async () => {
  // Verifies the full chain:
  //   applyParticipationTransitions (group)
  //     → Quiet → Dormant transition
  //       → applyGroupDormancyToProjectMemberships
  //         → ProjectMembership.status = inactive (member is dormant in all host groups)
  const { account, group, project } = await createFixture("apt_chain");
  try {
    // Set up group membership that is quiet and overdue for dormant transition
    await prisma.groupMembership.create({
      data: {
        accountId: account.id,
        groupId: group.id,
        status: "active",
        participationStatus: "quiet",
        lastSeenAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
      },
    });
    // Project member in a project hosted only by this group
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });

    // Trigger the real group transition path
    await applyParticipationTransitions(prisma, group.id);

    // Group member should now be dormant
    const gm = await prisma.groupMembership.findFirstOrThrow({
      where: { accountId: account.id, groupId: group.id },
    });
    assert.equal(gm.participationStatus, "dormant");

    // Project membership should be removed (dormant in all host groups)
    const pm = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    assert.equal(pm.status, "inactive");
  } finally {
    await cleanupFixture("apt_chain");
  }
});

// --- archivedAt query invariant ---

test("archived project does not appear in active project list (archivedAt filter)", async () => {
  const { group, project } = await createFixture("arch_filter");
  try {
    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });
    const activeProjects = await prisma.project.findMany({
      where: { foundingGroupId: group.id, status: "active", archivedAt: null },
    });
    assert.equal(activeProjects.length, 0);
  } finally {
    await cleanupFixture("arch_filter");
  }
});

// --- syncProjectHostingLifecycle (RFC-007 derived hosting / pending closure) ---

test("syncProjectHostingLifecycle opens pending closure when the last host withdraws", async () => {
  const { group, project } = await createFixture("shl_open");
  try {
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await syncProjectHostingLifecycle(prisma, project.id);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.notEqual(p.pendingClosureAt, null);
    assert.equal(p.status, "active"); // participation axis untouched by the hosting episode
  } finally {
    await cleanupFixture("shl_open");
  }
});

test("syncProjectHostingLifecycle supersedes unrelated open project petitions when pending closure opens", async () => {
  const { account, group, project } = await createFixture("shl_supersede_petitions");
  try {
    const projectMembership = await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });
    const petition = await prisma.petition.create({
      data: {
        groupId: group.id,
        scopeType: "project",
        scopeId: project.id,
        category: "publishing",
        subjectType: "bulletin_creation",
        subjectId: "shl_supersede_petitions_draft",
        status: "open",
        governanceSnapshot: { threshold: 0.5, petitionDuration: 7 },
        voterScope: { type: "project", scopeId: project.id },
        opensAt: new Date(),
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByProjectMembershipId: projectMembership.id,
      },
    });
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });

    await syncProjectHostingLifecycle(prisma, project.id);

    const superseded = await prisma.petition.findUniqueOrThrow({ where: { id: petition.id } });
    assert.equal(superseded.status, "superseded");
    assert.notEqual(superseded.resolvedAt, null);
  } finally {
    await cleanupFixture("shl_supersede_petitions");
  }
});

test("syncProjectHostingLifecycle cancels pending closure when a successor host arrives", async () => {
  const { group, group2, project } = await createFixture("shl_cancel");
  try {
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.project.update({ where: { id: project.id }, data: { pendingClosureAt: daysAgoForTest(5) } });

    await prisma.projectHosting.create({ data: { projectId: project.id, groupId: group2.id } });
    await syncProjectHostingLifecycle(prisma, project.id);

    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.pendingClosureAt, null);
  } finally {
    await cleanupFixture("shl_cancel");
  }
});

test("syncProjectHostingLifecycle closes and archives the project once the grace period elapses with no successor", async () => {
  const { group, project } = await createFixture("shl_close");
  try {
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.project.update({ where: { id: project.id }, data: { pendingClosureAt: daysAgoForTest(31) } });

    await syncProjectHostingLifecycle(prisma, project.id);

    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.status, "closed");
    assert.notEqual(p.archivedAt, null);
    assert.notEqual(p.pendingClosureAt, null); // preserved as the historical record of when the grace period began
  } finally {
    await cleanupFixture("shl_close");
  }
});

test("syncProjectHostingLifecycle leaves a completed project untouched (one-way exit)", async () => {
  const { group, project } = await createFixture("shl_completed");
  try {
    await prisma.project.update({ where: { id: project.id }, data: { status: "completed" } });
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });

    await syncProjectHostingLifecycle(prisma, project.id);

    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(p.status, "completed");
    assert.equal(p.pendingClosureAt, null);
  } finally {
    await cleanupFixture("shl_completed");
  }
});

// --- Frozen pending-closure electorate ---

test("applyProjectParticipationTransitions freezes participation transitions while a project is hostless and pending closure", async () => {
  const { account, group, project } = await createFixture("freeze_hostless");
  try {
    await prisma.projectMembership.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        status: "active",
        participationStatus: "active",
        lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // overdue for Active → Quiet
      },
    });
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.project.update({ where: { id: project.id }, data: { pendingClosureAt: new Date() } });

    await applyProjectParticipationTransitions(prisma, project.id);

    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    // Frozen — the electorate must not erode purely as a side effect of the hosting crisis
    assert.equal(m.participationStatus, "active");
  } finally {
    await cleanupFixture("freeze_hostless");
  }
});

test("applyProjectParticipationTransitions applies transitions normally once a project is hosted again, even with pendingClosureAt still set", async () => {
  const { account, group, group2, project } = await createFixture("freeze_rehosted");
  try {
    await prisma.projectMembership.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        status: "active",
        participationStatus: "active",
        lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.projectHosting.create({ data: { projectId: project.id, groupId: group2.id } });
    // Stale pendingClosureAt that syncProjectHostingLifecycle hasn't cleared yet
    await prisma.project.update({ where: { id: project.id }, data: { pendingClosureAt: new Date() } });

    await applyProjectParticipationTransitions(prisma, project.id);

    const m = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    // Hosted — freeze does not apply, ordinary absence-based transitions resume
    assert.equal(m.participationStatus, "quiet");
  } finally {
    await cleanupFixture("freeze_rehosted");
  }
});

test("applyGroupDormancyToProjectMemberships does not reach a project through a withdrawn host group", async () => {
  const { account, group, project } = await createFixture("freeze_dormancy_cascade");
  try {
    await prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    });
    await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active" },
    });
    // The group has withdrawn as host — its hosting row is historical, not active
    await prisma.projectHosting.updateMany({
      where: { projectId: project.id, groupId: group.id },
      data: { endedAt: new Date() },
    });
    await prisma.groupMembership.updateMany({
      where: { accountId: account.id, groupId: group.id },
      data: { participationStatus: "dormant" },
    });

    await applyGroupDormancyToProjectMemberships(prisma, group.id, [account.id]);

    const pm = await prisma.projectMembership.findUniqueOrThrow({
      where: { accountId_projectId: { accountId: account.id, projectId: project.id } },
    });
    // The cascade's endedAt-filtered query can never match a withdrawn host —
    // membership is preserved, exactly as the electorate freeze requires
    assert.equal(pm.status, "active");
  } finally {
    await cleanupFixture("freeze_dormancy_cascade");
  }
});

function daysAgoForTest(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });

  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });

  const group2 = await prisma.group.create({
    data: { id: `${prefix}_group2`, nodeId: node.id, name: `Group2 ${prefix}`, membershipPolicy: "open" },
  });

  const account = await prisma.account.create({
    data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const project = await prisma.project.create({
    data: {
      id: `${prefix}_project`,
      foundingGroupId: group.id,
      name: `Project ${prefix}`,
      status: "active",
    },
  });

  // Every project needs at least one ProjectHosting row
  await prisma.projectHosting.create({
    data: { projectId: project.id, groupId: group.id },
  });

  return { node, group, group2, account, project };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.projectHosting.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
