import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  createContributionFromAcceptedRoute,
  createSupportRequest,
  decideRequestRoute,
  declareServiceCapability,
  routeSupportRequest,
} from "../lib/capability-routing";

const prisma = createPrismaClient();

test.after(async () => {
  await cleanupAllFixtures();
  await prisma.$disconnect();
});

async function cleanupAllFixtures() {
  await cleanupFixture("caproute_food");
  await cleanupFixture("caproute_trusted_rides");
  await cleanupFixture("caproute_unapproved");
  await cleanupFixture("caproute_category_trusted");
  await cleanupFixture("caproute_unavailable");
  await cleanupFixture("caproute_decisions");
  await cleanupFixture("caproute_decision_finality");
  await cleanupFixture("caproute_contribution");
  await cleanupFixture("caproute_bypass_check");
  await cleanupFixture("caproute_privacy_group");
  await cleanupFixture("caproute_privacy_route");
  await cleanupFixture("caproute_project_inherit");
  await cleanupFixture("caproute_diff_group");
  await cleanupFixture("caproute_custom");
  await cleanupFixture("caproute_custom_off");
}

async function createCustomFixture(prefix: string, opts: { acceptsCustomRequests: boolean }) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: "Custom", domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: "Custom Group", membershipPolicy: "open", visibility: "public", acceptsCustomRequests: opts.acceptsCustomRequests } });
  const requester = await prisma.account.create({ data: { id: `${prefix}_req`, homeNodeId: node.id, displayName: "Req", accountType: "participant", profileVisibility: "private" } });
  const helper = await prisma.account.create({ data: { id: `${prefix}_helper`, homeNodeId: node.id, displayName: "Helper", accountType: "participant", profileVisibility: "private" } });
  await prisma.groupMembership.createMany({
    data: [
      { accountId: requester.id, groupId: group.id, status: "active", participationStatus: "active" },
      { accountId: helper.id, groupId: group.id, status: "active", participationStatus: "active" },
    ],
  });
  return { node, group, requester, helper };
}

test("custom request routes to active members of a public opted-in group (P3.2)", async () => {
  const prefix = "caproute_custom";
  try {
    const { group, requester, helper } = await createCustomFixture(prefix, { acceptsCustomRequests: true });
    const request = await createSupportRequest(prisma, {
      id: `${prefix}_request`,
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "custom",
      requestedServices: [{ serviceType: "custom", trustRequirement: "lightweight" }],
      description: "I need help moving a couch.",
      expiresAt: futureDate(),
    });
    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    // Routes to the active member (helper), never the requester.
    assert.equal(routes.length, 1);
    assert.equal(routes[0].contributorAccountId, helper.id);
    assert.equal(routes[0].serviceType, "custom");
  } finally {
    await cleanupFixture(prefix);
  }
});

test("custom request to a group that has NOT opted in routes to nobody (P3.2)", async () => {
  const prefix = "caproute_custom_off";
  try {
    const { group, requester } = await createCustomFixture(prefix, { acceptsCustomRequests: false });
    const request = await createSupportRequest(prisma, {
      id: `${prefix}_request`,
      submittedByAccountId: requester.id,
      groupId: group.id,
      requestType: "custom",
      requestedServices: [{ serviceType: "custom", trustRequirement: "lightweight" }],
      description: "Anyone around?",
      expiresAt: futureDate(),
    });
    const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
    assert.equal(routes.length, 0);
  } finally {
    await cleanupFixture(prefix);
  }
});

test("low-risk food dropoff routes without trust petition", async () => {
  const fixture = await createFixture("food");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "food dropoff",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_food_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "food dropoff",
    requestedServices: [{ serviceType: "food dropoff", trustRequirement: "lightweight" }],
    description: "Needs a simple food dropoff.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].contributorAccountId, fixture.alice.id);
  assert.equal(routes[0].status, "notified");
});

test("elevated rides route only to approved trusted contributors", async () => {
  const fixture = await createFixture("trusted_rides");
  const aliceCapability = await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "rides",
    trustRequirement: "elevated",
    availability: { availableNow: true },
  });
  await prisma.serviceCapability.update({ where: { id: aliceCapability.id }, data: { approvalStatus: "approved" } });
  await prisma.trustedServiceCapability.upsert({
    where: {
      serviceCapabilityId_groupId_trustContext: {
        serviceCapabilityId: aliceCapability.id,
        groupId: fixture.group.id,
        trustContext: "rides",
      },
    },
    update: { status: "approved", approvedAt: new Date("2026-05-27T12:00:00.000Z") },
    create: {
      id: "caproute_trusted_rides_trust_alice",
      serviceCapabilityId: aliceCapability.id,
      groupId: fixture.group.id,
      trustContext: "rides",
      status: "approved",
      approvedAt: new Date("2026-05-27T12:00:00.000Z"),
    },
  });

  await declareServiceCapability(prisma, {
    accountId: fixture.joe.id,
    serviceType: "rides",
    trustRequirement: "elevated",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_trusted_rides_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "rides",
    requestedServices: [{ serviceType: "rides", trustRequirement: "elevated" }],
    description: "Needs a ride requiring elevated trust.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.deepEqual(routes.map((route) => route.contributorAccountId), [fixture.alice.id]);
});

test("unapproved elevated contributors are excluded from sensitive routing", async () => {
  const fixture = await createFixture("unapproved");
  await declareServiceCapability(prisma, {
    accountId: fixture.joe.id,
    serviceType: "childcare",
    trustRequirement: "elevated",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_unapproved_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "childcare",
    requestedServices: [{ serviceType: "childcare", trustRequirement: "elevated" }],
    description: "Sensitive childcare request.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.equal(routes.length, 0);
});

test("elevated category request routes to active trusted provider without declared capability", async () => {
  const fixture = await createFixture("category_trusted");
  const aliceMembership = await prisma.groupMembership.findFirstOrThrow({
    where: { groupId: fixture.group.id, accountId: fixture.alice.id },
  });
  const category = await prisma.contributionCategory.create({
    data: {
      id: "caproute_category_trusted_category",
      groupId: fixture.group.id,
      offeringEntityType: "group",
      offeringEntityId: fixture.group.id,
      name: "Transportation",
      description: "Rides and transit support.",
      status: "active",
    },
  });
  await prisma.trustedProviderStatus.create({
    data: {
      id: "caproute_category_trusted_status",
      membershipId: aliceMembership.id,
      categoryId: category.id,
      groupId: fixture.group.id,
      status: "active",
    },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_category_trusted_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "category",
    requestedServices: [{ serviceType: "category", categoryId: category.id, trustRequirement: "elevated" }],
    description: "Needs a trusted ride.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].contributorAccountId, fixture.alice.id);
  assert.equal(routes[0].serviceCapabilityId, null);
});

test("contributors outside availability are excluded", async () => {
  const fixture = await createFixture("unavailable");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "food delivery",
    trustRequirement: "lightweight",
    availability: { availableNow: false },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_unavailable_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "food delivery",
    requestedServices: [{ serviceType: "food delivery", trustRequirement: "lightweight" }],
    description: "Needs food delivery.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.equal(routes.length, 0);
});

test("contributors can accept and decline routed requests", async () => {
  const fixture = await createFixture("decisions");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "meal delivery",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });
  await declareServiceCapability(prisma, {
    accountId: fixture.joe.id,
    serviceType: "meal delivery",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_decisions_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "meal delivery",
    requestedServices: [{ serviceType: "meal delivery", trustRequirement: "lightweight" }],
    description: "Needs a meal delivery.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });
  assert.equal(routes.length, 2);

  const accepted = await decideRequestRoute(prisma, {
    routeId: routes.find((route) => route.contributorAccountId === fixture.alice.id)!.id,
    contributorAccountId: fixture.alice.id,
    decision: "accepted",
  });
  const declined = await decideRequestRoute(prisma, {
    routeId: routes.find((route) => route.contributorAccountId === fixture.joe.id)!.id,
    contributorAccountId: fixture.joe.id,
    decision: "declined",
  });

  assert.equal(accepted.status, "accepted");
  assert.equal(declined.status, "declined");
});
test("route decisions cannot be changed after accepting or declining", async () => {
  const fixture = await createFixture("decision_finality");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "grocery pickup",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_decision_finality_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "grocery pickup",
    requestedServices: [{ serviceType: "grocery pickup", trustRequirement: "lightweight" }],
    description: "Needs a grocery pickup.",
    expiresAt: futureDate(),
  });

  const [route] = await routeSupportRequest(prisma, { supportRequestId: request.id });
  await decideRequestRoute(prisma, {
    routeId: route.id,
    contributorAccountId: fixture.alice.id,
    decision: "accepted",
  });

  await assert.rejects(
    () =>
      decideRequestRoute(prisma, {
        routeId: route.id,
        contributorAccountId: fixture.alice.id,
        decision: "declined",
      }),
    /Route cannot be decided from status accepted/,
  );
});

test("accepted request can produce a privacy-safe contribution summary", async () => {
  const fixture = await createFixture("contribution");
  await prisma.account.update({ where: { id: fixture.mary.id }, data: { displayName: "Sensitive Requester" } });
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "supply dropoff",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_contribution_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    projectId: fixture.project.id,
    requestType: "supply dropoff",
    requestedServices: [{ serviceType: "supply dropoff", trustRequirement: "lightweight" }],
    description: "Sensitive request details stay off the contribution record.",
    expiresAt: futureDate(),
  });

  const [route] = await routeSupportRequest(prisma, { supportRequestId: request.id });
  await decideRequestRoute(prisma, {
    routeId: route.id,
    contributorAccountId: fixture.alice.id,
    decision: "accepted",
  });

  const contribution = await createContributionFromAcceptedRoute(prisma, {
    id: "caproute_contribution_summary",
    routeId: route.id,
    occurredAt: new Date("2026-05-27T12:00:00.000Z"),
  });

  assert.equal(contribution.contributorAccountId, fixture.alice.id);
  assert.equal(contribution.visibility, "group");
  assert.equal(contribution.description.includes("Sensitive Requester"), false);
  assert.equal(JSON.stringify(contribution.privacyEnvelope).includes("excludesRecipientIdentity"), true);
});


test("createContributionFromAcceptedRoute leaves request matched and does not log request.fulfilled", async () => {
  const fixture = await createFixture("bypass_check");
  try {
    await declareServiceCapability(prisma, {
      accountId: fixture.alice.id,
      serviceType: "food dropoff",
      trustRequirement: "lightweight",
      availability: { availableNow: true },
    });

    const request = await createSupportRequest(prisma, {
      id: "caproute_bypass_check_request",
      submittedByAccountId: fixture.mary.id,
      groupId: fixture.group.id,
      requestType: "food dropoff",
      requestedServices: [{ serviceType: "food dropoff", trustRequirement: "lightweight" }],
      description: "Needs food.",
      expiresAt: futureDate(),
    });

    const [route] = await routeSupportRequest(prisma, { supportRequestId: request.id });
    await decideRequestRoute(prisma, { routeId: route.id, contributorAccountId: fixture.alice.id, decision: "accepted" });

    const contribution = await createContributionFromAcceptedRoute(prisma, {
      id: "caproute_bypass_check_contribution",
      routeId: route.id,
    });

    assert.ok(contribution.id);

    const afterRequest = await prisma.supportRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(afterRequest.status, "matched");

    const fulfilledLogs = await prisma.actionLog.findMany({
      where: { targetId: request.id, action: "request.fulfilled" },
    });
    assert.equal(fulfilledLogs.length, 0);
  } finally {
    await cleanupFixture("caproute_bypass_check");
  }
});

test("group privacy constraints override requester public preference", async () => {
  const fixture = await createFixture("privacy_group");
  const request = await createSupportRequest(prisma, {
    id: "caproute_privacy_group_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "food dropoff",
    requestedServices: [{ serviceType: "food dropoff", trustRequirement: "lightweight" }],
    description: "Requester asked for public, but group defaults stay private.",
    privacyLevel: "public",
    expiresAt: futureDate(),
  });

  const envelope = await prisma.privacyEnvelope.findUnique({
    where: { targetType_targetId: { targetType: "SupportRequest", targetId: request.id } },
  });

  assert.equal(request.privacyLevel, "private");
  assert.equal(envelope?.level, "private");
});

test("route notification payload does not expose requester identity or description", async () => {
  const fixture = await createFixture("privacy_route");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "medical accompaniment",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_privacy_route_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    requestType: "medical accompaniment",
    requestedServices: [{ serviceType: "medical accompaniment", trustRequirement: "lightweight" }],
    description: "Private medical detail that must not be routed as notification payload.",
    expiresAt: futureDate(),
  });

  const [route] = await routeSupportRequest(prisma, { supportRequestId: request.id });
  const serialized = JSON.stringify(route.notificationPayload);

  assert.equal(route.notificationPayload.sensitiveDetailsIncluded, false);
  assert.equal(serialized.includes(fixture.mary.id), false);
  assert.equal(serialized.includes("Private medical detail"), false);
});

test("createContributionFromAcceptedRoute inherits projectId from the support request", async () => {
  const fixture = await createFixture("project_inherit");
  await declareServiceCapability(prisma, {
    accountId: fixture.alice.id,
    serviceType: "rides",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const project = await prisma.project.create({
    data: {
      id: "caproute_project_inherit_rides",
      foundingGroupId: fixture.group.id,
      name: "Test Rides project_inherit",
      status: "active",
    },
  });

  const request = await createSupportRequest(prisma, {
    id: "caproute_project_inherit_request",
    submittedByAccountId: fixture.mary.id,
    groupId: fixture.group.id,
    projectId: project.id,
    requestType: "rides",
    requestedServices: [{ serviceType: "rides", trustRequirement: "lightweight" }],
    description: "Ride needed.",
    expiresAt: futureDate(),
  });

  const [route] = await routeSupportRequest(prisma, { supportRequestId: request.id });
  await decideRequestRoute(prisma, { routeId: route.id, contributorAccountId: fixture.alice.id, decision: "accepted" });
  const contribution = await createContributionFromAcceptedRoute(prisma, { routeId: route.id });

  assert.equal(contribution.projectId, project.id);

  await prisma.contribution.deleteMany({ where: { id: contribution.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await cleanupFixture("caproute_project_inherit");
});

test("provider on same node but different group is not routed", async () => {
  const prefix = "caproute_isolation";
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: "Isolation Test Node",
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const groupA = await prisma.group.create({
    data: {
      id: `${prefix}_group_a`,
      nodeId: node.id,
      name: "Isolation Group A",
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private" },
    },
  });

  const groupB = await prisma.group.create({
    data: {
      id: `${prefix}_group_b`,
      nodeId: node.id,
      name: "Isolation Group B",
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private" },
    },
  });

  for (const group of [groupA, groupB]) {
    await prisma.groupServiceOffering.create({
      data: {
        id: `${prefix}_offering_${group.id}`,
        groupId: group.id,
        serviceType: "translation",
        status: "active",
        minimumContributorTrust: "lightweight",
      },
    });
  }

  const requester = await prisma.account.create({
    data: { id: `${prefix}_requester`, homeNodeId: node.id, displayName: "Requester", accountType: "participant", profileVisibility: "private" },
  });

  // Bob is only a member of group B — not group A
  const bob = await prisma.account.create({
    data: { id: `${prefix}_bob`, homeNodeId: node.id, displayName: "Bob", accountType: "member", profileVisibility: "group" },
  });
  await prisma.groupMembership.create({ data: { accountId: bob.id, groupId: groupB.id, status: "active" } });

  await declareServiceCapability(prisma, {
    accountId: bob.id,
    serviceType: "translation",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
  });

  const request = await createSupportRequest(prisma, {
    id: `${prefix}_request`,
    submittedByAccountId: requester.id,
    groupId: groupA.id,
    requestType: "translation",
    requestedServices: [{ serviceType: "translation", trustRequirement: "lightweight" }],
    description: "Needs translation help.",
    expiresAt: futureDate(),
  });

  const routes = await routeSupportRequest(prisma, { supportRequestId: request.id });

  assert.equal(routes.length, 0, "provider from a different group on the same node must not be routed");

  await cleanupFixture(prefix);
});

async function createFixture(suffix: string) {
  const prefix = `caproute_${suffix}`;
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Capability Routing ${suffix}`,
      domain: `${prefix}.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });

  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Routing Group ${suffix}`,
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private" },
      governancePreferences: { trustApprovalThreshold: 0.7 },
    },
  });

  for (const serviceType of ["food dropoff", "rides", "childcare", "food delivery", "meal delivery", "grocery pickup", "supply dropoff", "medical accompaniment"]) {
    await prisma.groupServiceOffering.create({
      data: {
        id: `${prefix}_offering_${serviceType.replace(/ /g, "_")}`,
        groupId: group.id,
        serviceType,
        status: "active",
        minimumContributorTrust: "lightweight",
      },
    });
  }

  const project = await prisma.project.create({
    data: {
      id: `${prefix}_project`,
      foundingGroupId: group.id,
      name: `Routing Project ${suffix}`,
      status: "active",
    },
  });

  const mary = await prisma.account.create({
    data: {
      id: `${prefix}_mary`,
      homeNodeId: node.id,
      displayName: `Mary ${suffix}`,
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  const alice = await prisma.account.create({
    data: {
      id: `${prefix}_alice`,
      homeNodeId: node.id,
      displayName: `Alice ${suffix}`,
      accountType: "member",
      profileVisibility: "group",
    },
  });

  const joe = await prisma.account.create({
    data: {
      id: `${prefix}_joe`,
      homeNodeId: node.id,
      displayName: `Joe ${suffix}`,
      accountType: "member",
      profileVisibility: "group",
    },
  });

  await prisma.groupMembership.createMany({
    data: [
      { accountId: alice.id, groupId: group.id, status: "active" },
      { accountId: joe.id, groupId: group.id, status: "active" },
    ],
  });

  return { node, group, project, mary, alice, joe };
}

async function cleanupFixture(prefix: string) {
  await prisma.contribution.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contribution.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.requestRoute.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.supportRequestService.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.trustedProviderStatus.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contributionCategory.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.trustedServiceCapability.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contributorAvailability.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.serviceCapability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.groupServiceOffering.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { homeNodeId: { startsWith: prefix } },
      ],
    },
  });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

function futureDate() {
  return new Date("2026-12-31T12:00:00.000Z");
}
