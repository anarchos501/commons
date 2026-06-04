import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { createSupportRequest, decideRequestRoute, declareServiceCapability, routeSupportRequest } from "../lib/capability-routing";
import { deleteSupportRequest, fulfillSupportRequest } from "../lib/request-lifecycle";
import { joinOpenGroup, leaveGroup } from "../lib/group-membership";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- request.created ---

test("createSupportRequest logs request.created with actor and group", async () => {
  const { account, group } = await createFixture("al_create");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_create_req",
      submittedByAccountId: account.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food" }],
      description: "I need groceries.",
    });

    const logs = await prisma.actionLog.findMany({ where: { targetId: request.id, action: "request.created" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, account.id);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "support_request");
  } finally {
    await cleanupFixture("al_create");
  }
});

test("createSupportRequest logs request.created with null actor for guest", async () => {
  const { group } = await createFixture("al_guest");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_guest_req",
      submittedByAccountId: null,
      guestRequestId: "al_guest_gid",
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food" }],
      description: "Guest needs help.",
    });

    const logs = await prisma.actionLog.findMany({ where: { targetId: request.id, action: "request.created" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, null);
    assert.equal(logs[0].groupId, group.id);
  } finally {
    await cleanupFixture("al_guest");
  }
});

// --- request.fulfilled ---

test("fulfillSupportRequest logs request.fulfilled", async () => {
  const { account, group } = await createFixture("al_fulfill");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_fulfill_req",
      submittedByAccountId: account.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food" }],
      description: "Needs help.",
    });
    await prisma.supportRequest.update({ where: { id: request.id }, data: { status: "matched" } });
    await fulfillSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: account.id });

    const logs = await prisma.actionLog.findMany({ where: { targetId: request.id, action: "request.fulfilled" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, account.id);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "support_request");
  } finally {
    await cleanupFixture("al_fulfill");
  }
});

// --- request.deleted ---

test("deleteSupportRequest logs request.deleted", async () => {
  const { account, group } = await createFixture("al_delete");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_delete_req",
      submittedByAccountId: account.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food" }],
      description: "Needs help.",
    });
    await deleteSupportRequest(prisma, { supportRequestId: request.id, actorAccountId: account.id });

    const logs = await prisma.actionLog.findMany({ where: { targetId: request.id, action: "request.deleted" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, account.id);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "support_request");
  } finally {
    await cleanupFixture("al_delete");
  }
});

// --- membership.joined / membership.left ---

test("joinOpenGroup logs membership.joined", async () => {
  const { account, group } = await createFixture("al_join");
  try {
    await joinOpenGroup(prisma, account.id, group.id);

    const logs = await prisma.actionLog.findMany({ where: { actorAccountId: account.id, action: "membership.joined" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "group_membership");
  } finally {
    await cleanupFixture("al_join");
  }
});

test("leaveGroup logs membership.left", async () => {
  const { account, group } = await createFixture("al_leave");
  try {
    await joinOpenGroup(prisma, account.id, group.id);
    await leaveGroup(prisma, account.id, group.id);

    const logs = await prisma.actionLog.findMany({ where: { actorAccountId: account.id, action: "membership.left" } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "group_membership");
  } finally {
    await cleanupFixture("al_leave");
  }
});

// --- request.routed, route.accepted, route.declined ---

test("routeSupportRequest logs request.routed for each new route", async () => {
  const { requester, group } = await createRoutingFixture("al_route");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_route_req",
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 1);

    const logs = await prisma.actionLog.findMany({ where: { action: "request.routed", targetId: routes[0].id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "request_route");
    assert.ok(logs[0].metadata && typeof logs[0].metadata === "object" && !Array.isArray(logs[0].metadata));

    // Second call should not produce a duplicate log for the same route
    await routeSupportRequest(prisma, { supportRequestId: request.id });
    const logsAfterSecondCall = await prisma.actionLog.findMany({ where: { action: "request.routed", targetId: routes[0].id } });
    assert.equal(logsAfterSecondCall.length, 1);
  } finally {
    await cleanupRoutingFixture("al_route");
  }
});

test("decideRequestRoute logs route.accepted", async () => {
  const { requester, contributor, group } = await createRoutingFixture("al_accept");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_accept_req",
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 1);

    await decideRequestRoute(prisma, { routeId: routes[0].id, contributorAccountId: contributor.id, decision: "accepted" });

    const logs = await prisma.actionLog.findMany({ where: { action: "route.accepted", targetId: routes[0].id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, contributor.id);
    assert.equal(logs[0].groupId, group.id);
    assert.equal(logs[0].targetType, "request_route");
  } finally {
    await cleanupRoutingFixture("al_accept");
  }
});

test("decideRequestRoute logs route.declined", async () => {
  const { requester, contributor, group } = await createRoutingFixture("al_decline");
  try {
    const request = await createSupportRequest(prisma, {
      id: "al_decline_req",
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "direct",
      requestedServices: [{ serviceType: "food", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 1);

    await decideRequestRoute(prisma, { routeId: routes[0].id, contributorAccountId: contributor.id, decision: "declined" });

    const logs = await prisma.actionLog.findMany({ where: { action: "route.declined", targetId: routes[0].id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorAccountId, contributor.id);
    assert.equal(logs[0].targetType, "request_route");
  } finally {
    await cleanupRoutingFixture("al_decline");
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
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  return { node, group, account };
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
    data: { accountId: contributor.id, groupId: group.id, status: "active" },
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
  // ActionLog references Account and Group via FK — delete first
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.privacyEnvelope.deleteMany({ where: { targetId: { startsWith: prefix } } });
  await prisma.supportRequestService.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function cleanupRoutingFixture(prefix: string) {
  // ActionLog first due to FK relations
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
