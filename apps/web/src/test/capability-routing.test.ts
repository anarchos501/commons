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

type Fixture = Awaited<ReturnType<typeof createFixture>>;

test.after(async () => {
  await prisma.$disconnect();
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
      supportThreshold: 0.7,
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

  const project = await prisma.project.create({
    data: {
      id: `${prefix}_project`,
      groupId: group.id,
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

  return { node, group, project, mary, alice, joe };
}

async function cleanupFixture(prefix: string) {
  await prisma.contribution.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.requestRoute.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.supportRequestService.deleteMany({ where: { supportRequestId: { startsWith: prefix } } });
  await prisma.supportRequest.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.trustedServiceCapability.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contributorAvailability.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.serviceCapability.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

function futureDate() {
  return new Date("2026-12-31T12:00:00.000Z");
}