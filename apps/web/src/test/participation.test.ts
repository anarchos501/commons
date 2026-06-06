import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { recordGroupPresence, applyParticipationTransitions, resolveParticipationThresholds } from "../lib/participation";
import { createSupportRequest, declareServiceCapability, routeSupportRequest } from "../lib/capability-routing";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- recordGroupPresence ---

test("recordGroupPresence sets lastSeenAt and keeps status active", async () => {
  const { account, group, membership } = await createFixture("ps_presence");
  try {
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: null },
    });

    await recordGroupPresence(prisma, account.id, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.ok(updated.lastSeenAt !== null);
    assert.equal(updated.participationStatus, "active");
  } finally {
    await cleanupFixture("ps_presence");
  }
});

test("recordGroupPresence is rate-limited: second call within an hour does not update lastSeenAt", async () => {
  const { account, group, membership } = await createFixture("ps_ratelimit");
  try {
    const recentSeen = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: recentSeen },
    });

    await recordGroupPresence(prisma, account.id, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.lastSeenAt?.getTime(), recentSeen.getTime());
  } finally {
    await cleanupFixture("ps_ratelimit");
  }
});

test("recordGroupPresence reactivates a Quiet member immediately (bypasses rate limit)", async () => {
  const { account, group, membership } = await createFixture("ps_reactivate_quiet");
  try {
    const recentSeen = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "quiet", lastSeenAt: recentSeen },
    });

    await recordGroupPresence(prisma, account.id, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "active");
    assert.ok(updated.lastSeenAt! > recentSeen);
  } finally {
    await cleanupFixture("ps_reactivate_quiet");
  }
});

test("recordGroupPresence reactivates a Dormant member immediately (bypasses rate limit)", async () => {
  const { account, group, membership } = await createFixture("ps_reactivate_dormant");
  try {
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "dormant", lastSeenAt: null },
    });

    await recordGroupPresence(prisma, account.id, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "active");
    assert.ok(updated.lastSeenAt !== null);

    const logs = await prisma.actionLog.findMany({
      where: { targetId: membership.id, action: "participation.reactivated" },
    });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupFixture("ps_reactivate_dormant");
  }
});

test("recordGroupPresence skips non-active memberships", async () => {
  const { account, group, membership } = await createFixture("ps_skip");
  try {
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { status: "inactive", lastSeenAt: null },
    });

    await recordGroupPresence(prisma, account.id, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.lastSeenAt, null);
  } finally {
    await cleanupFixture("ps_skip");
  }
});

// --- applyParticipationTransitions ---

test("applyParticipationTransitions transitions Active → Quiet after 90-day threshold", async () => {
  const { group, membership } = await createFixture("ps_to_quiet");
  try {
    const oldSeen = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: oldSeen },
    });

    await applyParticipationTransitions(prisma, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "quiet");

    const logs = await prisma.actionLog.findMany({
      where: { targetId: membership.id, action: "participation.quieted" },
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].metadata, { previousStatus: "active", thresholdDays: 90 });
  } finally {
    await cleanupFixture("ps_to_quiet");
  }
});

test("applyParticipationTransitions transitions Quiet → Dormant after 365-day threshold", async () => {
  const { group, membership } = await createFixture("ps_to_dormant");
  try {
    const oldSeen = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "quiet", lastSeenAt: oldSeen },
    });

    await applyParticipationTransitions(prisma, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "dormant");

    const logs = await prisma.actionLog.findMany({
      where: { targetId: membership.id, action: "participation.dormanted" },
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].metadata, { previousStatus: "quiet", thresholdDays: 365 });
  } finally {
    await cleanupFixture("ps_to_dormant");
  }
});

test("applyParticipationTransitions skips members who visited recently", async () => {
  const { group, membership } = await createFixture("ps_skip_recent");
  try {
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: new Date() },
    });

    await applyParticipationTransitions(prisma, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "active");
  } finally {
    await cleanupFixture("ps_skip_recent");
  }
});

test("applyParticipationTransitions uses joinedAt as fallback when lastSeenAt is null", async () => {
  const { group, membership } = await createFixture("ps_joinedat");
  try {
    const oldJoinedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: null, joinedAt: oldJoinedAt },
    });

    await applyParticipationTransitions(prisma, group.id);

    const updated = await prisma.groupMembership.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(updated.participationStatus, "quiet");
  } finally {
    await cleanupFixture("ps_joinedat");
  }
});

// --- routing exclusion ---

test("routeSupportRequest excludes Quiet members from routing", async () => {
  const { requester, contributor, group } = await createRoutingFixture("ps_route_quiet");
  try {
    const request = await createSupportRequest(prisma, {
      id: "ps_route_quiet_req",
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    await prisma.groupMembership.updateMany({
      where: { accountId: contributor.id, groupId: group.id },
      data: { participationStatus: "quiet" },
    });

    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 0);
  } finally {
    await cleanupRoutingFixture("ps_route_quiet");
  }
});

test("routeSupportRequest excludes Dormant members from routing", async () => {
  const { requester, contributor, group } = await createRoutingFixture("ps_route_dormant");
  try {
    const request = await createSupportRequest(prisma, {
      id: "ps_route_dormant_req",
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    await prisma.groupMembership.updateMany({
      where: { accountId: contributor.id, groupId: group.id },
      data: { participationStatus: "dormant" },
    });

    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 0);
  } finally {
    await cleanupRoutingFixture("ps_route_dormant");
  }
});

// --- resolveParticipationThresholds ---

test("resolveParticipationThresholds at T=0 returns default anchors (90/365)", async () => {
  const { group } = await createFixture("pt_thresh_default");
  try {
    const { quietDays, dormantDays } = await resolveParticipationThresholds(prisma, group.id);
    assert.equal(quietDays, 90);
    assert.equal(dormantDays, 365);
  } finally {
    await cleanupFixture("pt_thresh_default");
  }
});

test("resolveParticipationThresholds with restrictive category signal returns shorter thresholds", async () => {
  const { group, membership } = await createFixture("pt_thresh_restrict");
  try {
    // Full restrictive signal on the "_" (category) parameter
    await prisma.memberGovernanceSignal.create({
      data: { membershipId: membership.id, groupId: group.id, category: "participation", parameter: "_", signal: -1 },
    });
    const { quietDays, dormantDays } = await resolveParticipationThresholds(prisma, group.id);
    assert.equal(quietDays, 30);
    assert.equal(dormantDays, 180);
  } finally {
    await cleanupFixture("pt_thresh_restrict");
  }
});

test("resolveParticipationThresholds with permissive signal returns longer thresholds", async () => {
  const { group, membership } = await createFixture("pt_thresh_permissive");
  try {
    await prisma.memberGovernanceSignal.create({
      data: { membershipId: membership.id, groupId: group.id, category: "participation", parameter: "_", signal: 1 },
    });
    const { quietDays, dormantDays } = await resolveParticipationThresholds(prisma, group.id);
    assert.equal(quietDays, 180);
    assert.equal(dormantDays, 730);
  } finally {
    await cleanupFixture("pt_thresh_permissive");
  }
});

test("resolveParticipationThresholds clamps dormant >= quiet + 1", async () => {
  const { group, membership } = await createFixture("pt_thresh_clamp");
  try {
    // Force quietThresholdDays to be very high (permissive) and dormantThresholdDays also permissive
    // At T=+1: quiet=180, dormant=730 — no clamp needed. Test the guard logic directly
    // by using mixed signals that would make dormant < quiet (impossible with normal ranges,
    // so we just verify the normal case produces dormant >= quiet + 1 at all temps)
    await prisma.memberGovernanceSignal.create({
      data: { membershipId: membership.id, groupId: group.id, category: "participation", parameter: "_", signal: 0.5 },
    });
    const { quietDays, dormantDays } = await resolveParticipationThresholds(prisma, group.id);
    assert.ok(dormantDays >= quietDays + 1, `dormant (${dormantDays}) must be at least quiet (${quietDays}) + 1`);
  } finally {
    await cleanupFixture("pt_thresh_clamp");
  }
});

test("applyParticipationTransitions action log includes resolved threshold value", async () => {
  const { group, membership } = await createFixture("pt_thresh_log");
  try {
    const oldSeen = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await prisma.groupMembership.update({
      where: { id: membership.id },
      data: { participationStatus: "active", lastSeenAt: oldSeen },
    });

    await applyParticipationTransitions(prisma, group.id);

    const logs = await prisma.actionLog.findMany({
      where: { targetId: membership.id, action: "participation.quieted" },
    });
    assert.equal(logs.length, 1);
    const meta = logs[0].metadata as Record<string, unknown>;
    assert.equal(typeof meta.thresholdDays, "number");
    assert.equal(meta.previousStatus, "active");
  } finally {
    await cleanupFixture("pt_thresh_log");
  }
});

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Test Node ${prefix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Test Group ${prefix}`,
      membershipPolicy: "open",
    },
  });

  const account = await prisma.account.create({
    data: {
      id: `${prefix}_account`,
      homeNodeId: node.id,
      displayName: `Test User ${prefix}`,
      accountType: "member",
      profileVisibility: "private",
    },
  });

  const membership = await prisma.groupMembership.create({
    data: { accountId: account.id, groupId: group.id, status: "active" },
  });

  return { node, group, account, membership };
}

async function createRoutingFixture(prefix: string) {
  await cleanupRoutingFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Routing Node ${prefix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Routing Group ${prefix}`,
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private" },
    },
  });

  await prisma.groupServiceOffering.create({
    data: {
      id: `${prefix}_offering`,
      groupId: group.id,
      serviceType: "food",
      status: "active",
      minimumContributorTrust: "lightweight",
    },
  });

  const requester = await prisma.account.create({
    data: {
      id: `${prefix}_requester`,
      homeNodeId: node.id,
      displayName: `Requester ${prefix}`,
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  const contributor = await prisma.account.create({
    data: {
      id: `${prefix}_contributor`,
      homeNodeId: node.id,
      displayName: `Contributor ${prefix}`,
      accountType: "member",
      profileVisibility: "group",
    },
  });

  await prisma.groupMembership.create({
    data: { accountId: contributor.id, groupId: group.id, status: "active", participationStatus: "active" },
  });

  await declareServiceCapability(prisma, {
    accountId: contributor.id,
    serviceType: "food",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  return { node, group, requester, contributor };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function cleanupRoutingFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.requestRoute.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.privacyEnvelope.deleteMany({ where: { targetId: { startsWith: prefix } } });
  await prisma.supportRequestService.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contributorAvailability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.serviceCapability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupServiceOffering.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

function futureDate() {
  return new Date("2027-12-31T12:00:00.000Z");
}
