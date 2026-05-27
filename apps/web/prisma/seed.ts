import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed Commons data.");
}

const adapter = new PrismaPg(connectionString);
const prisma = new PrismaClient({ adapter });

async function main() {
  const node = await prisma.node.upsert({
    where: { domain: "localhost" },
    update: {
      name: "Northside Commons",
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
      constitutionalPreferences: {
        supportRequestRetentionDays: 30,
        rolesMustExpire: true,
        pluginsCannotExposeRecipientIdentities: true,
      },
    },
    create: {
      id: "node_northside_commons",
      name: "Northside Commons",
      domain: "localhost",
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
      constitutionalPreferences: {
        supportRequestRetentionDays: 30,
        rolesMustExpire: true,
        pluginsCannotExposeRecipientIdentities: true,
      },
    },
  });

  const group = await prisma.group.upsert({
    where: { nodeId_name: { nodeId: node.id, name: "Gotham Mutual Aid" } },
    update: {
      description: "A local mutual aid collective coordinating practical support.",
      membershipPolicy: "open",
      governancePreferences: {
        decisionThreshold: 0.7,
        trustReviewDays: 14,
      },
      privacyPreferences: {
        supportRequests: "private",
        contributionVisibility: "group",
      },
    },
    create: {
      id: "group_gotham_mutual_aid",
      nodeId: node.id,
      name: "Gotham Mutual Aid",
      description: "A local mutual aid collective coordinating practical support.",
      membershipPolicy: "open",
      governancePreferences: {
        decisionThreshold: 0.7,
        trustReviewDays: 14,
      },
      privacyPreferences: {
        supportRequests: "private",
        contributionVisibility: "group",
      },
    },
  });

  const ridesProject = await prisma.project.upsert({
    where: { groupId_name: { groupId: group.id, name: "Rides" } },
    update: { description: "Appointment, grocery, and community transport coordination.", status: "active" },
    create: {
      id: "project_rides",
      groupId: group.id,
      name: "Rides",
      description: "Appointment, grocery, and community transport coordination.",
      status: "active",
    },
  });

  await prisma.project.upsert({
    where: { groupId_name: { groupId: group.id, name: "Food Distribution" } },
    update: { description: "Shared food pickup, packing, and delivery support.", status: "active" },
    create: {
      id: "project_food_distribution",
      groupId: group.id,
      name: "Food Distribution",
      description: "Shared food pickup, packing, and delivery support.",
      status: "active",
    },
  });

  const translationProject = await prisma.project.upsert({
    where: { groupId_name: { groupId: group.id, name: "Translation Support" } },
    update: { description: "Language access for forms, calls, appointments, and meetings.", status: "active" },
    create: {
      id: "project_translation_support",
      groupId: group.id,
      name: "Translation Support",
      description: "Language access for forms, calls, appointments, and meetings.",
      status: "active",
    },
  });

  const maryIdentity = await prisma.portableIdentity.upsert({
    where: { did: "did:commons:mary" },
    update: { publicKey: "dev-public-key-mary" },
    create: { id: "pid_mary", did: "did:commons:mary", publicKey: "dev-public-key-mary" },
  });

  const aliceIdentity = await prisma.portableIdentity.upsert({
    where: { did: "did:commons:alice" },
    update: { publicKey: "dev-public-key-alice" },
    create: { id: "pid_alice", did: "did:commons:alice", publicKey: "dev-public-key-alice" },
  });

  const joeIdentity = await prisma.portableIdentity.upsert({
    where: { did: "did:commons:joe" },
    update: { publicKey: "dev-public-key-joe" },
    create: { id: "pid_joe", did: "did:commons:joe", publicKey: "dev-public-key-joe" },
  });

  const zoraIdentity = await prisma.portableIdentity.upsert({
    where: { did: "did:commons:zora" },
    update: { publicKey: "dev-public-key-zora" },
    create: { id: "pid_zora", did: "did:commons:zora", publicKey: "dev-public-key-zora" },
  });

  await prisma.linkedNodePresence.upsert({
    where: { portableIdentityId_nodeId: { portableIdentityId: aliceIdentity.id, nodeId: node.id } },
    update: { handle: "alice@localhost", status: "active", lastSeenAt: new Date("2026-05-27T12:00:00.000Z") },
    create: {
      id: "presence_alice_localhost",
      portableIdentityId: aliceIdentity.id,
      nodeId: node.id,
      handle: "alice@localhost",
      status: "active",
      lastSeenAt: new Date("2026-05-27T12:00:00.000Z"),
    },
  });

  const mary = await prisma.account.upsert({
    where: { id: "acct_mary" },
    update: { displayName: "Mary", accountType: "participant", profileVisibility: "private" },
    create: {
      id: "acct_mary",
      portableIdentityId: maryIdentity.id,
      homeNodeId: node.id,
      displayName: "Mary",
      accountType: "participant",
      publicKey: "dev-account-key-mary",
      profileVisibility: "private",
    },
  });

  const alice = await prisma.account.upsert({
    where: { id: "acct_alice" },
    update: { displayName: "Alice", accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_alice",
      portableIdentityId: aliceIdentity.id,
      homeNodeId: node.id,
      displayName: "Alice",
      accountType: "member",
      publicKey: "dev-account-key-alice",
      profileVisibility: "group",
    },
  });

  const joe = await prisma.account.upsert({
    where: { id: "acct_joe" },
    update: { displayName: "Joe", accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_joe",
      portableIdentityId: joeIdentity.id,
      homeNodeId: node.id,
      displayName: "Joe",
      accountType: "member",
      publicKey: "dev-account-key-joe",
      profileVisibility: "group",
    },
  });

  const zora = await prisma.account.upsert({
    where: { id: "acct_zora" },
    update: { displayName: "Zora", accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_zora",
      portableIdentityId: zoraIdentity.id,
      homeNodeId: node.id,
      displayName: "Zora",
      accountType: "member",
      publicKey: "dev-account-key-zora",
      profileVisibility: "group",
    },
  });

  const aliceRides = await prisma.serviceCapability.upsert({
    where: { accountId_serviceType_trustRequirement: { accountId: alice.id, serviceType: "rides", trustRequirement: "lightweight" } },
    update: { description: "Rides to appointments when available.", visibility: "group", approvalStatus: "available" },
    create: {
      id: "cap_alice_rides",
      accountId: alice.id,
      serviceType: "rides",
      description: "Rides to appointments when available.",
      availability: { days: ["weekday"], windows: ["afternoon"] },
      visibility: "group",
      trustRequirement: "lightweight",
      approvalStatus: "available",
    },
  });

  const aliceMedical = await prisma.serviceCapability.upsert({
    where: { accountId_serviceType_trustRequirement: { accountId: alice.id, serviceType: "medical accompaniment", trustRequirement: "elevated" } },
    update: { description: "Accompaniment and navigation for medical appointments.", visibility: "group", approvalStatus: "approved" },
    create: {
      id: "cap_alice_medical_accompaniment",
      accountId: alice.id,
      serviceType: "medical accompaniment",
      description: "Accompaniment and navigation for medical appointments.",
      availability: { days: ["weekday"], windows: ["morning", "afternoon"] },
      visibility: "group",
      trustRequirement: "elevated",
      approvalStatus: "approved",
    },
  });

  await prisma.serviceCapability.upsert({
    where: { accountId_serviceType_trustRequirement: { accountId: joe.id, serviceType: "carpentry", trustRequirement: "lightweight" } },
    update: { description: "Porch, ramp, and small repair help.", visibility: "group", approvalStatus: "available" },
    create: {
      id: "cap_joe_carpentry",
      accountId: joe.id,
      serviceType: "carpentry",
      description: "Porch, ramp, and small repair help.",
      availability: { days: ["saturday", "sunday"] },
      visibility: "group",
      trustRequirement: "lightweight",
      approvalStatus: "available",
    },
  });

  const zoraTranslation = await prisma.serviceCapability.upsert({
    where: { accountId_serviceType_trustRequirement: { accountId: zora.id, serviceType: "translation", trustRequirement: "lightweight" } },
    update: { description: "Spanish and English translation coordination.", visibility: "group", approvalStatus: "available" },
    create: {
      id: "cap_zora_translation",
      accountId: zora.id,
      serviceType: "translation",
      description: "Spanish and English translation coordination.",
      availability: { languages: ["Spanish", "English"], windows: ["evening"] },
      visibility: "group",
      trustRequirement: "lightweight",
      approvalStatus: "available",
    },
  });

  await prisma.trustedServiceCapability.upsert({
    where: {
      serviceCapabilityId_groupId_trustContext: {
        serviceCapabilityId: aliceMedical.id,
        groupId: group.id,
        trustContext: "medical accompaniment",
      },
    },
    update: {
      status: "approved",
      supportThreshold: 0.7,
      approvedAt: new Date("2026-05-27T12:00:00.000Z"),
      revokedAt: null,
    },
    create: {
      id: "trust_alice_medical_gotham",
      serviceCapabilityId: aliceMedical.id,
      groupId: group.id,
      trustContext: "medical accompaniment",
      status: "approved",
      supportThreshold: 0.7,
      reviewEndsAt: new Date("2026-06-10T12:00:00.000Z"),
      approvedAt: new Date("2026-05-27T12:00:00.000Z"),
    },
  });

  const request = await prisma.supportRequest.upsert({
    where: { id: "request_mary_ride" },
    update: {
      submittedByAccountId: mary.id,
      groupId: group.id,
      projectId: ridesProject.id,
      requestType: "ride",
      requestedServices: [{ serviceType: "rides", trustRequirement: "lightweight" }],
      description: "Private ride request for a weekday appointment.",
      urgency: "normal",
      privacyLevel: "private",
      status: "open",
      expiresAt: new Date("2026-06-26T12:00:00.000Z"),
    },
    create: {
      id: "request_mary_ride",
      submittedByAccountId: mary.id,
      groupId: group.id,
      projectId: ridesProject.id,
      requestType: "ride",
      requestedServices: [{ serviceType: "rides", trustRequirement: "lightweight" }],
      description: "Private ride request for a weekday appointment.",
      urgency: "normal",
      privacyLevel: "private",
      status: "open",
      expiresAt: new Date("2026-06-26T12:00:00.000Z"),
    },
  });

  await prisma.supportRequestService.upsert({
    where: { supportRequestId_serviceType_trustRequirement: { supportRequestId: request.id, serviceType: "rides", trustRequirement: "lightweight" } },
    update: {},
    create: {
      id: "request_service_mary_ride",
      supportRequestId: request.id,
      serviceType: "rides",
      trustRequirement: "lightweight",
    },
  });

  const offer = await prisma.offer.upsert({
    where: { id: "offer_alice_rides" },
    update: {
      accountId: alice.id,
      groupId: group.id,
      projectId: ridesProject.id,
      offeredServices: [{ serviceType: "rides", trustRequirement: "lightweight" }],
      description: "Alice can take occasional appointment ride requests.",
      availability: { days: ["weekday"], windows: ["afternoon"] },
      status: "open",
      privacyLevel: "group",
    },
    create: {
      id: "offer_alice_rides",
      accountId: alice.id,
      groupId: group.id,
      projectId: ridesProject.id,
      offeredServices: [{ serviceType: "rides", trustRequirement: "lightweight" }],
      description: "Alice can take occasional appointment ride requests.",
      availability: { days: ["weekday"], windows: ["afternoon"] },
      status: "open",
      privacyLevel: "group",
    },
  });

  await prisma.offerService.upsert({
    where: { offerId_serviceType_trustRequirement: { offerId: offer.id, serviceType: "rides", trustRequirement: "lightweight" } },
    update: {},
    create: {
      id: "offer_service_alice_rides",
      offerId: offer.id,
      serviceType: "rides",
      trustRequirement: "lightweight",
    },
  });

  await prisma.contribution.upsert({
    where: { id: "contribution_monthly_rides" },
    update: {
      contributorAccountId: alice.id,
      groupId: group.id,
      projectId: ridesProject.id,
      contributionType: "rides",
      description: "Alice provided 6 rides this month.",
      quantity: "6 rides",
      occurredAt: new Date("2026-05-27T12:00:00.000Z"),
      visibility: "group",
      privacyEnvelope: { excludesRecipientIdentity: true, aggregateOnly: true },
    },
    create: {
      id: "contribution_monthly_rides",
      contributorAccountId: alice.id,
      groupId: group.id,
      projectId: ridesProject.id,
      contributionType: "rides",
      description: "Alice provided 6 rides this month.",
      quantity: "6 rides",
      occurredAt: new Date("2026-05-27T12:00:00.000Z"),
      visibility: "group",
      privacyEnvelope: { excludesRecipientIdentity: true, aggregateOnly: true },
    },
  });

  const proposal = await prisma.proposal.upsert({
    where: { id: "proposal_support_retention_30_days" },
    update: {
      title: "Keep support request retention to 30 days",
      body: "Adopt a default support request deletion window of 30 days unless a stricter affected-participant preference applies.",
      status: "open",
      governancePreferencesSnapshot: { decisionThreshold: 0.7, changeRule: "stricter_only" },
    },
    create: {
      id: "proposal_support_retention_30_days",
      groupId: group.id,
      title: "Keep support request retention to 30 days",
      body: "Adopt a default support request deletion window of 30 days unless a stricter affected-participant preference applies.",
      status: "open",
      governancePreferencesSnapshot: { decisionThreshold: 0.7, changeRule: "stricter_only" },
      createdByAccountId: zora.id,
    },
  });

  await prisma.role.upsert({
    where: { id: "role_zora_translation_coordinator" },
    update: {
      accountId: zora.id,
      roleType: "translation coordinator",
      permissions: ["coordinate.translation", "view.translation_project"],
      groupId: group.id,
      projectId: translationProject.id,
      expiresAt: new Date("2026-06-26T12:00:00.000Z"),
      recallPolicy: "proposal",
    },
    create: {
      id: "role_zora_translation_coordinator",
      accountId: zora.id,
      roleType: "translation coordinator",
      permissions: ["coordinate.translation", "view.translation_project"],
      groupId: group.id,
      projectId: translationProject.id,
      expiresAt: new Date("2026-06-26T12:00:00.000Z"),
      recallPolicy: "proposal",
    },
  });

  await prisma.governancePreference.upsert({
    where: { id: "pref_group_support_retention" },
    update: {
      value: { days: 30 },
      scope: "group",
      scopeId: group.id,
      changeRule: "stricter_only",
      createdBy: zora.id,
    },
    create: {
      id: "pref_group_support_retention",
      key: "support_data_retention",
      value: { days: 30 },
      scope: "group",
      scopeId: group.id,
      changeRule: "stricter_only",
      createdBy: zora.id,
    },
  });

  await prisma.privacyEnvelope.upsert({
    where: { targetType_targetId: { targetType: "SupportRequest", targetId: request.id } },
    update: { level: "private", rules: { requesterIdentity: "need_to_know", expiresWithRequest: true }, createdBy: mary.id },
    create: {
      id: "privacy_request_mary_ride",
      targetType: "SupportRequest",
      targetId: request.id,
      level: "private",
      rules: { requesterIdentity: "need_to_know", expiresWithRequest: true },
      createdBy: mary.id,
    },
  });

  await prisma.actionLog.upsert({
    where: { id: "log_seed_support_retention_proposal" },
    update: {
      actorAccountId: zora.id,
      groupId: group.id,
      projectId: null,
      action: "proposal.created",
      targetType: "Proposal",
      targetId: proposal.id,
      metadata: { seeded: true, sensitiveContentStored: false },
    },
    create: {
      id: "log_seed_support_retention_proposal",
      actorAccountId: zora.id,
      groupId: group.id,
      action: "proposal.created",
      targetType: "Proposal",
      targetId: proposal.id,
      metadata: { seeded: true, sensitiveContentStored: false },
    },
  });

  console.log("Seeded Commons local-node development data.");
  console.log({
    node: node.domain,
    group: group.name,
    projects: [ridesProject.name, "Food Distribution", translationProject.name],
    capabilities: [aliceRides.serviceType, aliceMedical.serviceType, zoraTranslation.serviceType],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });