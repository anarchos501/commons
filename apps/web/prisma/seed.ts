import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createSignedEventRecord } from "../src/lib/signed-events";
import { defaultReplicationPolicies } from "../src/lib/replication-policies";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed Commons data.");
}

const adapter = new PrismaPg(connectionString);
const prisma = new PrismaClient({ adapter });

async function main() {
  const demoPasswordHash = await bcrypt.hash("demo1234", 10);

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

  const group2 = await prisma.group.upsert({
    where: { nodeId_name: { nodeId: node.id, name: "Eastside Commons" } },
    update: {
      description: "Eastside neighborhood coordination and mutual support.",
      membershipPolicy: "open",
      governancePreferences: { decisionThreshold: 0.7, trustReviewDays: 14 },
      privacyPreferences: { supportRequests: "private", contributionVisibility: "group" },
    },
    create: {
      id: "group_eastside_commons",
      nodeId: node.id,
      name: "Eastside Commons",
      description: "Eastside neighborhood coordination and mutual support.",
      membershipPolicy: "open",
      governancePreferences: { decisionThreshold: 0.7, trustReviewDays: 14 },
      privacyPreferences: { supportRequests: "private", contributionVisibility: "group" },
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

  const foodProject = await prisma.project.upsert({
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
    update: { displayName: "Mary", email: "mary@example.com", passwordHash: demoPasswordHash, accountType: "participant", profileVisibility: "private" },
    create: {
      id: "acct_mary",
      portableIdentityId: maryIdentity.id,
      homeNodeId: node.id,
      displayName: "Mary",
      email: "mary@example.com",
      passwordHash: demoPasswordHash,
      accountType: "participant",
      publicKey: "dev-account-key-mary",
      profileVisibility: "private",
    },
  });

  const alice = await prisma.account.upsert({
    where: { id: "acct_alice" },
    update: { displayName: "Alice", email: "alice@example.com", passwordHash: demoPasswordHash, accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_alice",
      portableIdentityId: aliceIdentity.id,
      homeNodeId: node.id,
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: demoPasswordHash,
      accountType: "member",
      publicKey: "dev-account-key-alice",
      profileVisibility: "group",
    },
  });

  const joe = await prisma.account.upsert({
    where: { id: "acct_joe" },
    update: { displayName: "Joe", email: "joe@example.com", passwordHash: demoPasswordHash, accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_joe",
      portableIdentityId: joeIdentity.id,
      homeNodeId: node.id,
      displayName: "Joe",
      email: "joe@example.com",
      passwordHash: demoPasswordHash,
      accountType: "member",
      publicKey: "dev-account-key-joe",
      profileVisibility: "group",
    },
  });

  const zora = await prisma.account.upsert({
    where: { id: "acct_zora" },
    update: { displayName: "Zora", email: "zora@example.com", passwordHash: demoPasswordHash, accountType: "member", profileVisibility: "group" },
    create: {
      id: "acct_zora",
      portableIdentityId: zoraIdentity.id,
      homeNodeId: node.id,
      displayName: "Zora",
      email: "zora@example.com",
      passwordHash: demoPasswordHash,
      accountType: "member",
      publicKey: "dev-account-key-zora",
      profileVisibility: "group",
    },
  });

  // Seed group memberships (Slice 2). Mary gets none — she uses the join flow.
  for (const [id, accountId] of [
    ["membership_alice_gotham", alice.id],
    ["membership_joe_gotham", joe.id],
    ["membership_zora_gotham", zora.id],
  ] as const) {
    await prisma.groupMembership.upsert({
      where: { accountId_groupId: { accountId, groupId: group.id } },
      update: { status: "active" },
      create: { id, accountId, groupId: group.id, status: "active" },
    });
  }

  // Alice belongs to both groups for the group switcher demo (Slice 3).
  // joinedAt defaults to now(), so her Gotham membership (seeded above) will be earlier.
  // loginAccount will therefore land her on Gotham by default on login.
  await prisma.groupMembership.upsert({
    where: { accountId_groupId: { accountId: alice.id, groupId: group2.id } },
    update: { status: "active" },
    create: { id: "membership_alice_eastside", accountId: alice.id, groupId: group2.id, status: "active" },
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


  const serviceOfferings = [
    { serviceType: "rides",                 minimumContributorTrust: "lightweight", projectId: ridesProject.id },
    { serviceType: "food delivery",         minimumContributorTrust: "lightweight", projectId: foodProject.id },
    { serviceType: "translation",           minimumContributorTrust: "lightweight", projectId: translationProject.id },
    { serviceType: "childcare",             minimumContributorTrust: "elevated",    projectId: null },
    { serviceType: "repairs",               minimumContributorTrust: "lightweight", projectId: null },
    { serviceType: "emotional support",     minimumContributorTrust: "lightweight", projectId: null },
    { serviceType: "medical accompaniment", minimumContributorTrust: "elevated",    projectId: null },
    { serviceType: "carpentry",             minimumContributorTrust: "lightweight", projectId: null },
  ];

  for (const offering of serviceOfferings) {
    await prisma.groupServiceOffering.upsert({
      where: { groupId_serviceType: { groupId: group.id, serviceType: offering.serviceType } },
      update: { status: "active", minimumContributorTrust: offering.minimumContributorTrust, projectId: offering.projectId },
      create: {
        groupId: group.id,
        serviceType: offering.serviceType,
        status: "active",
        minimumContributorTrust: offering.minimumContributorTrust,
        projectId: offering.projectId,
      },
    });
  }

  for (const policy of defaultReplicationPolicies) {
    await prisma.dataReplicationPolicy.upsert({
      where: {
        scope_scopeId_dataClass: {
          scope: "group",
          scopeId: group.id,
          dataClass: policy.dataClass,
        },
      },
      update: {
        nodeStorage: policy.nodeStorage,
        localStorage: policy.localStorage,
        federationAllowed: policy.federationAllowed,
        p2pAllowed: policy.p2pAllowed,
        retentionDays: policy.retentionDays,
        requiresEncryption: policy.requiresEncryption,
        userExportAllowed: policy.userExportAllowed,
        userDeletionAllowed: policy.userDeletionAllowed,
        syncRequiresConsent: policy.syncRequiresConsent,
      },
      create: {
        id: `policy_gotham_${policy.dataClass}`,
        scope: "group",
        scopeId: group.id,
        dataClass: policy.dataClass,
        nodeStorage: policy.nodeStorage,
        localStorage: policy.localStorage,
        federationAllowed: policy.federationAllowed,
        p2pAllowed: policy.p2pAllowed,
        retentionDays: policy.retentionDays,
        requiresEncryption: policy.requiresEncryption,
        userExportAllowed: policy.userExportAllowed,
        userDeletionAllowed: policy.userDeletionAllowed,
        syncRequiresConsent: policy.syncRequiresConsent,
      },
    });
  }

  await prisma.localSyncState.upsert({
    where: { accountId_deviceId: { accountId: mary.id, deviceId: "dev-device-mary-phone" } },
    update: {
      lastAckedEventId: "event_identity_presence_alice",
      lastSyncedAt: new Date("2026-05-27T12:00:00.000Z"),
    },
    create: {
      id: "sync_mary_phone",
      accountId: mary.id,
      deviceId: "dev-device-mary-phone",
      lastAckedEventId: "event_identity_presence_alice",
      lastSyncedAt: new Date("2026-05-27T12:00:00.000Z"),
    },
  });

  const proposalEvent = createSignedEventRecord({
    eventType: "proposal_created",
    subjectType: "Proposal",
    subjectId: proposal.id,
    actorAccountId: zora.id,
    portableIdentityId: zoraIdentity.id,
    nodeId: node.id,
    groupId: group.id,
    payload: {
      title: proposal.title,
      privacy: "node-canonical",
      signedEventPurpose: "federation-readiness",
    },
    publicKey: zoraIdentity.publicKey,
    createdAt: new Date("2026-05-27T12:00:00.000Z"),
  });

  await prisma.signedEvent.upsert({
    where: { payloadHash_signature: { payloadHash: proposalEvent.payloadHash, signature: proposalEvent.signature } },
    update: {
      payload: proposalEvent.payload,
      publicKey: proposalEvent.publicKey,
    },
    create: {
      id: "event_proposal_support_retention_created",
      eventType: proposalEvent.eventType,
      subjectType: proposalEvent.subjectType,
      subjectId: proposalEvent.subjectId,
      actorAccountId: proposalEvent.actorAccountId,
      portableIdentityId: proposalEvent.portableIdentityId,
      nodeId: proposalEvent.nodeId,
      groupId: proposalEvent.groupId,
      projectId: proposalEvent.projectId,
      payload: proposalEvent.payload,
      payloadHash: proposalEvent.payloadHash,
      signature: proposalEvent.signature,
      publicKey: proposalEvent.publicKey,
      createdAt: proposalEvent.createdAt,
    },
  });

  const supportRequestEvent = createSignedEventRecord({
    eventType: "support_request_submitted",
    subjectType: "SupportRequest",
    subjectId: request.id,
    actorAccountId: mary.id,
    portableIdentityId: maryIdentity.id,
    nodeId: node.id,
    groupId: group.id,
    projectId: ridesProject.id,
    payload: {
      requestType: request.requestType,
      serviceTypes: ["rides"],
      privacyLevel: "private",
      sensitiveDetailsIncluded: false,
    },
    publicKey: maryIdentity.publicKey,
    createdAt: new Date("2026-05-27T12:01:00.000Z"),
  });

  await prisma.signedEvent.upsert({
    where: { payloadHash_signature: { payloadHash: supportRequestEvent.payloadHash, signature: supportRequestEvent.signature } },
    update: {
      payload: supportRequestEvent.payload,
      publicKey: supportRequestEvent.publicKey,
    },
    create: {
      id: "event_support_request_mary_ride_submitted",
      eventType: supportRequestEvent.eventType,
      subjectType: supportRequestEvent.subjectType,
      subjectId: supportRequestEvent.subjectId,
      actorAccountId: supportRequestEvent.actorAccountId,
      portableIdentityId: supportRequestEvent.portableIdentityId,
      nodeId: supportRequestEvent.nodeId,
      groupId: supportRequestEvent.groupId,
      projectId: supportRequestEvent.projectId,
      payload: supportRequestEvent.payload,
      payloadHash: supportRequestEvent.payloadHash,
      signature: supportRequestEvent.signature,
      publicKey: supportRequestEvent.publicKey,
      createdAt: supportRequestEvent.createdAt,
    },
  });

  const contributionEvent = createSignedEventRecord({
    eventType: "contribution_logged",
    subjectType: "Contribution",
    subjectId: "contribution_monthly_rides",
    actorAccountId: alice.id,
    portableIdentityId: aliceIdentity.id,
    nodeId: node.id,
    groupId: group.id,
    projectId: ridesProject.id,
    payload: {
      contributionType: "rides",
      aggregateOnly: true,
      excludesRecipientIdentity: true,
    },
    publicKey: aliceIdentity.publicKey,
    createdAt: new Date("2026-05-27T12:02:00.000Z"),
  });

  await prisma.signedEvent.upsert({
    where: { payloadHash_signature: { payloadHash: contributionEvent.payloadHash, signature: contributionEvent.signature } },
    update: {
      payload: contributionEvent.payload,
      publicKey: contributionEvent.publicKey,
    },
    create: {
      id: "event_contribution_monthly_rides_logged",
      eventType: contributionEvent.eventType,
      subjectType: contributionEvent.subjectType,
      subjectId: contributionEvent.subjectId,
      actorAccountId: contributionEvent.actorAccountId,
      portableIdentityId: contributionEvent.portableIdentityId,
      nodeId: contributionEvent.nodeId,
      groupId: contributionEvent.groupId,
      projectId: contributionEvent.projectId,
      payload: contributionEvent.payload,
      payloadHash: contributionEvent.payloadHash,
      signature: contributionEvent.signature,
      publicKey: contributionEvent.publicKey,
      createdAt: contributionEvent.createdAt,
    },
  });

  const identityPresenceEvent = createSignedEventRecord({
    eventType: "identity_presence_updated",
    subjectType: "LinkedNodePresence",
    subjectId: "presence_alice_localhost",
    actorAccountId: alice.id,
    portableIdentityId: aliceIdentity.id,
    nodeId: node.id,
    groupId: group.id,
    payload: {
      did: aliceIdentity.did,
      handle: "alice@localhost",
      status: "active",
    },
    publicKey: aliceIdentity.publicKey,
    createdAt: new Date("2026-05-27T12:03:00.000Z"),
  });

  await prisma.signedEvent.upsert({
    where: { payloadHash_signature: { payloadHash: identityPresenceEvent.payloadHash, signature: identityPresenceEvent.signature } },
    update: {
      payload: identityPresenceEvent.payload,
      publicKey: identityPresenceEvent.publicKey,
    },
    create: {
      id: "event_identity_presence_alice",
      eventType: identityPresenceEvent.eventType,
      subjectType: identityPresenceEvent.subjectType,
      subjectId: identityPresenceEvent.subjectId,
      actorAccountId: identityPresenceEvent.actorAccountId,
      portableIdentityId: identityPresenceEvent.portableIdentityId,
      nodeId: identityPresenceEvent.nodeId,
      groupId: identityPresenceEvent.groupId,
      projectId: identityPresenceEvent.projectId,
      payload: identityPresenceEvent.payload,
      payloadHash: identityPresenceEvent.payloadHash,
      signature: identityPresenceEvent.signature,
      publicKey: identityPresenceEvent.publicKey,
      createdAt: identityPresenceEvent.createdAt,
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