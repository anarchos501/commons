import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  proposeTrustedProviderStatus,
  grantTrustedProviderStatusFromPetition,
  proposeTrustedProviderRevocation,
  revokeTrustedProviderStatusFromPetition,
  formatTrustedByLabel,
} from "../lib/trusted-providers";
import { trustedProviderExistsForCategory } from "../lib/contribution-categories";
import { isProposalFamily, categoryForFamily } from "../lib/governance-proposal-families";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ── Proposal family registration ──────────────────────────────────────────────

test("trusted_provider_proposal maps to trusted_provider category", () => {
  assert.ok(isProposalFamily("trusted_provider_proposal"));
  assert.equal(categoryForFamily("trusted_provider_proposal"), "trusted_provider");
});

test("trusted_provider_revocation maps to trusted_provider category", () => {
  assert.ok(isProposalFamily("trusted_provider_revocation"));
  assert.equal(categoryForFamily("trusted_provider_revocation"), "trusted_provider");
});

// ── formatTrustedByLabel ──────────────────────────────────────────────────────

test("formatTrustedByLabel formats group attribution", () => {
  assert.equal(formatTrustedByLabel("group", "Gotham Mutual Aid"), "Trusted by Gotham Mutual Aid");
});

test("formatTrustedByLabel formats project attribution", () => {
  assert.equal(formatTrustedByLabel("project", "Breakfast On Us"), "Trusted by Breakfast On Us (Project)");
});

test("formatTrustedByLabel formats responsibility attribution", () => {
  assert.equal(formatTrustedByLabel("responsibility", "Emergency Preparedness"), "Trusted by Emergency Preparedness (Responsibility)");
});

// ── Bundle validation ─────────────────────────────────────────────────────────

test("proposeTrustedProviderStatus rejects empty category list", async () => {
  const { group, memberships } = await createFixture("tp_empty");
  try {
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_categories");
  } finally {
    await cleanupFixture("tp_empty");
  }
});

test("proposeTrustedProviderStatus rejects mixed-entity category bundle", async () => {
  const { group, memberships } = await createFixture("tp_mixed", 3);
  try {
    const project = await prisma.project.create({ data: { id: "tp_mixed_proj", foundingGroupId: group.id, name: "Mixed Project", status: "active" } });
    const [cat1, cat2] = await prisma.$transaction([
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Cat A", description: "x", status: "active" } }),
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "project", offeringEntityId: project.id, name: "Cat B", description: "x", status: "active" } }),
    ]);
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: [cat1.id, cat2.id],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "mixed_entities");
  } finally {
    await cleanupFixture("tp_mixed");
  }
});

test("proposeTrustedProviderStatus rejects non-existent or archived categories", async () => {
  const { group, memberships } = await createFixture("tp_invalid_cats", 2);
  try {
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: ["nonexistent_id"],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_categories");
  } finally {
    await cleanupFixture("tp_invalid_cats");
  }
});

// ── Grant via petition ────────────────────────────────────────────────────────

test("grantTrustedProviderStatusFromPetition creates one TrustedProviderStatus per category in bundle", async () => {
  const { group, memberships } = await createFixture("tp_grant", 3);
  try {
    const [cat1, cat2, cat3] = await prisma.$transaction([
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Cat 1", description: "x", status: "active" } }),
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Cat 2", description: "x", status: "active" } }),
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Cat 3", description: "x", status: "active" } }),
    ]);

    const propResult = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: [cat1.id, cat2.id, cat3.id],
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;

    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await grantTrustedProviderStatusFromPetition(prisma, propResult.petitionId);

    const statuses = await prisma.trustedProviderStatus.findMany({
      where: { membershipId: memberships[1].id, groupId: group.id },
    });
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((s) => s.status === "active"));
  } finally {
    await cleanupFixture("tp_grant");
  }
});

test("grantTrustedProviderStatusFromPetition is idempotent", async () => {
  const { group, memberships } = await createFixture("tp_grant_idemp", 3);
  try {
    const cat = await prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Idempotent Cat", description: "x", status: "active" } });
    const propResult = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: [cat.id],
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;
    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await grantTrustedProviderStatusFromPetition(prisma, propResult.petitionId);
    await assert.doesNotReject(() => grantTrustedProviderStatusFromPetition(prisma, propResult.petitionId));
    const count = await prisma.trustedProviderStatus.count({ where: { membershipId: memberships[1].id, categoryId: cat.id } });
    assert.equal(count, 1);
  } finally {
    await cleanupFixture("tp_grant_idemp");
  }
});

test("rejected petition grants no trusted provider statuses", async () => {
  const { group, memberships } = await createFixture("tp_rejected", 3);
  try {
    const cat = await prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Rejected Cat", description: "x", status: "active" } });
    const propResult = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      categoryIds: [cat.id],
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;
    // Keep petition in non-approved state
    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "rejected" } });
    await grantTrustedProviderStatusFromPetition(prisma, propResult.petitionId);
    const count = await prisma.trustedProviderStatus.count({ where: { membershipId: memberships[1].id, groupId: group.id } });
    assert.equal(count, 0);
  } finally {
    await cleanupFixture("tp_rejected");
  }
});

// ── Revocation ────────────────────────────────────────────────────────────────

test("revokeTrustedProviderStatusFromPetition revokes all listed statuses", async () => {
  const { group, memberships } = await createFixture("tp_revoke", 3);
  try {
    const [cat1, cat2] = await prisma.$transaction([
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Revoke Cat 1", description: "x", status: "active" } }),
      prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Revoke Cat 2", description: "x", status: "active" } }),
    ]);
    // Grant statuses directly
    const [s1, s2] = await prisma.$transaction([
      prisma.trustedProviderStatus.create({ data: { membershipId: memberships[1].id, categoryId: cat1.id, groupId: group.id, status: "active" } }),
      prisma.trustedProviderStatus.create({ data: { membershipId: memberships[1].id, categoryId: cat2.id, groupId: group.id, status: "active" } }),
    ]);

    const revokeResult = await proposeTrustedProviderRevocation(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      statusIds: [s1.id, s2.id],
    });
    assert.ok(revokeResult.ok);
    if (!revokeResult.ok) return;
    await prisma.petition.update({ where: { id: revokeResult.petitionId }, data: { status: "approved" } });
    await revokeTrustedProviderStatusFromPetition(prisma, revokeResult.petitionId);

    const updated = await prisma.trustedProviderStatus.findMany({ where: { id: { in: [s1.id, s2.id] } } });
    assert.ok(updated.every((s) => s.status === "revoked"));
    assert.ok(updated.every((s) => s.revokedAt !== null));
  } finally {
    await cleanupFixture("tp_revoke");
  }
});

test("revokeTrustedProviderStatusFromPetition is idempotent", async () => {
  const { group, memberships } = await createFixture("tp_rev_idemp", 3);
  try {
    const cat = await prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Rev Idemp Cat", description: "x", status: "active" } });
    const status = await prisma.trustedProviderStatus.create({ data: { membershipId: memberships[1].id, categoryId: cat.id, groupId: group.id, status: "active" } });
    const revokeResult = await proposeTrustedProviderRevocation(prisma, {
      requestingMembershipId: memberships[0].id,
      targetMembershipId: memberships[1].id,
      groupId: group.id,
      statusIds: [status.id],
    });
    assert.ok(revokeResult.ok);
    if (!revokeResult.ok) return;
    await prisma.petition.update({ where: { id: revokeResult.petitionId }, data: { status: "approved" } });
    await revokeTrustedProviderStatusFromPetition(prisma, revokeResult.petitionId);
    await assert.doesNotReject(() => revokeTrustedProviderStatusFromPetition(prisma, revokeResult.petitionId));
    const updated = await prisma.trustedProviderStatus.findUniqueOrThrow({ where: { id: status.id } });
    assert.equal(updated.status, "revoked");
  } finally {
    await cleanupFixture("tp_rev_idemp");
  }
});

// ── trustedProviderExistsForCategory ─────────────────────────────────────────

test("trustedProviderExistsForCategory returns true when active status exists", async () => {
  const { group, memberships } = await createFixture("tp_exists", 2);
  try {
    const cat = await prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Exists Cat", description: "x", status: "active" } });
    await prisma.trustedProviderStatus.create({ data: { membershipId: memberships[0].id, categoryId: cat.id, groupId: group.id, status: "active" } });
    const exists = await trustedProviderExistsForCategory(prisma, { categoryId: cat.id, groupId: group.id });
    assert.equal(exists, true);
  } finally {
    await cleanupFixture("tp_exists");
  }
});

test("trustedProviderExistsForCategory returns false when only revoked statuses exist", async () => {
  const { group, memberships } = await createFixture("tp_exists_revoked", 2);
  try {
    const cat = await prisma.contributionCategory.create({ data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Revoked Only Cat", description: "x", status: "active" } });
    await prisma.trustedProviderStatus.create({ data: { membershipId: memberships[0].id, categoryId: cat.id, groupId: group.id, status: "revoked", revokedAt: new Date() } });
    const exists = await trustedProviderExistsForCategory(prisma, { categoryId: cat.id, groupId: group.id });
    assert.equal(exists, false);
  } finally {
    await cleanupFixture("tp_exists_revoked");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string, memberCount = 2) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.tp.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const m = await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(m);
  }
  return { node, group, memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.trustedProviderStatus.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.trustedProviderRevocationRequest.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.trustedProviderApplication.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contributionCategory.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contributionCategoryDraft.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { foundingGroupId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
