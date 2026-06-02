import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  applyGroupDormancyToProjectMemberships,
  applyProjectParticipationTransitions,
  leaveProject,
  recordProjectPresence,
  requireProjectMembership,
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
      where: { groupId: group.id, status: "active", archivedAt: null },
    });
    assert.equal(activeProjects.length, 0);
  } finally {
    await cleanupFixture("arch_filter");
  }
});

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
      groupId: group.id,
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
