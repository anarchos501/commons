import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  proposeContributionCategory,
  proposeProjectContributionCategory,
  proposeContributionCategoryArchival,
  createContributionCategoryFromPetition,
  archiveContributionCategoryFromPetition,
  getAvailableCategoriesForScope,
  trustedProviderExistsForCategory,
} from "../lib/contribution-categories";
import { isProposalFamily, categoryForFamily } from "../lib/governance-proposal-families";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ── Proposal family registration ──────────────────────────────────────────────

test("contribution_category_proposal is a valid proposal family mapping to contribution_category", () => {
  assert.ok(isProposalFamily("contribution_category_proposal"));
  assert.equal(categoryForFamily("contribution_category_proposal"), "contribution_category");
});

test("contribution_category_archive is a valid proposal family mapping to contribution_category", () => {
  assert.ok(isProposalFamily("contribution_category_archive"));
  assert.equal(categoryForFamily("contribution_category_archive"), "contribution_category");
});

// ── Group category proposals ───────────────────────────────────────────────────

test("proposeContributionCategory opens petition for group-offered category with null voterScope", async () => {
  const { group, memberships } = await createFixture("cc_group_prop");
  try {
    const result = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Transportation",
      description: "Providing rides and transportation assistance.",
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.subjectType, "contribution_category_proposal");
    assert.equal(petition.voterScope, null);
    // Draft should exist
    const draft = await prisma.contributionCategoryDraft.findUnique({ where: { id: petition.subjectId } });
    assert.ok(draft);
    assert.equal(draft?.name, "Transportation");
  } finally {
    await cleanupFixture("cc_group_prop");
  }
});

test("proposeContributionCategory opens project-scoped petition for project-offered category", async () => {
  const { group, memberships, project } = await createFixtureWithProject("cc_proj_prop");
  try {
    const result = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "project",
      offeringEntityId: project.id,
      name: "Food Delivery",
      description: "Delivering food to community members.",
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.scopeType, "project");
    assert.equal(petition.scopeId, project.id);
    assert.deepEqual(petition.voterScope, { type: "project", scopeId: project.id });
  } finally {
    await cleanupFixture("cc_proj_prop");
  }
});

test("project-only member proposes project contribution category", async () => {
  const { project } = await createFixtureWithProject("cc_proj_only");
  try {
    const account = await prisma.account.create({
      data: {
        id: "cc_proj_only_account_project",
        homeNodeId: "cc_proj_only_node",
        displayName: "Project Category Member",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    const projectMembership = await prisma.projectMembership.create({
      data: { accountId: account.id, projectId: project.id, status: "active", participationStatus: "active" },
    });

    const result = await proposeProjectContributionCategory(prisma, {
      projectMembershipId: projectMembership.id,
      projectId: project.id,
      name: "Project Mutual Aid",
      description: "Help coordinated by the project.",
    });
    assert.ok(result.ok);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    const draft = await prisma.contributionCategoryDraft.findUniqueOrThrow({ where: { id: petition.subjectId } });
    assert.equal(petition.scopeType, "project");
    assert.equal(petition.scopeId, project.id);
    assert.equal(draft.proposedByMembershipId, null);
    assert.equal(draft.proposedByProjectMembershipId, projectMembership.id);
  } finally {
    await cleanupFixture("cc_proj_only");
  }
});

test("proposeContributionCategory for project rejects non-project member", async () => {
  const { group, memberships, project } = await createFixtureWithProject("cc_proj_rej");
  try {
    // memberships[1] is not a project member
    const result = await proposeContributionCategory(prisma, {
      membershipId: memberships[1].id,
      groupId: group.id,
      offeringEntityType: "project",
      offeringEntityId: project.id,
      name: "Childcare",
      description: "Childcare support.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_eligible");
  } finally {
    await cleanupFixture("cc_proj_rej");
  }
});

test("proposeContributionCategory for responsibility rejects holder without create_contribution_categories ability", async () => {
  const { group, memberships, responsibility } = await createFixtureWithResponsibility("cc_resp_no_ability");
  try {
    const result = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "responsibility",
      offeringEntityId: responsibility.id,
      name: "Emergency Supply Distribution",
      description: "Distributing emergency supplies.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ability_required");
  } finally {
    await cleanupFixture("cc_resp_no_ability");
  }
});

test("proposeContributionCategory rejects duplicate active category name within same entity", async () => {
  const { group, memberships } = await createFixture("cc_dup");
  try {
    // Create a category directly
    await prisma.contributionCategory.create({
      data: {
        groupId: group.id,
        offeringEntityType: "group",
        offeringEntityId: group.id,
        name: "Transportation",
        description: "existing",
        status: "active",
      },
    });
    const result = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Transportation",
      description: "A second one.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "duplicate_name");
  } finally {
    await cleanupFixture("cc_dup");
  }
});

// ── Petition approval creates category ────────────────────────────────────────

test("createContributionCategoryFromPetition creates category on approved petition", async () => {
  const { group, memberships } = await createFixture("cc_create", 3);
  try {
    const propResult = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Tool Lending",
      description: "Lending tools to community members.",
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;

    // Manually approve the petition (skip governance threshold for unit test)
    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await createContributionCategoryFromPetition(prisma, propResult.petitionId);

    const category = await prisma.contributionCategory.findFirst({
      where: { groupId: group.id, name: "Tool Lending" },
    });
    assert.ok(category);
    assert.equal(category?.status, "active");
    assert.equal(category?.offeringEntityType, "group");
  } finally {
    await cleanupFixture("cc_create");
  }
});

test("first approved contribution category makes a private group public", async () => {
  const { group, memberships } = await createFixture("cc_publicize_first", 3);
  try {
    const propResult = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Food Pantry",
      description: "Coordinating pantry pickup and delivery.",
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;

    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await createContributionCategoryFromPetition(prisma, propResult.petitionId);

    const updated = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(updated.visibility, "public");
  } finally {
    await cleanupFixture("cc_publicize_first");
  }
});

test("additional approved contribution categories preserve private visibility when active categories already exist", async () => {
  const { group, memberships } = await createFixture("cc_publicize_existing", 3);
  try {
    await prisma.contributionCategory.create({
      data: {
        groupId: group.id,
        offeringEntityType: "group",
        offeringEntityId: group.id,
        name: "Existing",
        description: "Existing category.",
        status: "active",
      },
    });

    const propResult = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Tool Share",
      description: "Sharing tools across the neighborhood.",
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;

    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await createContributionCategoryFromPetition(prisma, propResult.petitionId);

    const updated = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(updated.visibility, "private");
  } finally {
    await cleanupFixture("cc_publicize_existing");
  }
});

test("createContributionCategoryFromPetition is idempotent on second call", async () => {
  const { group, memberships } = await createFixture("cc_idempotent", 3);
  try {
    const propResult = await proposeContributionCategory(prisma, {
      membershipId: memberships[0].id,
      groupId: group.id,
      offeringEntityType: "group",
      offeringEntityId: group.id,
      name: "Translation",
      description: "Translation assistance.",
    });
    assert.ok(propResult.ok);
    if (!propResult.ok) return;
    await prisma.petition.update({ where: { id: propResult.petitionId }, data: { status: "approved" } });
    await createContributionCategoryFromPetition(prisma, propResult.petitionId);
    // Call again — should not throw
    await assert.doesNotReject(() => createContributionCategoryFromPetition(prisma, propResult.petitionId));
    const count = await prisma.contributionCategory.count({ where: { groupId: group.id, name: "Translation" } });
    assert.equal(count, 1);
  } finally {
    await cleanupFixture("cc_idempotent");
  }
});

// ── Archival ──────────────────────────────────────────────────────────────────

test("archiveContributionCategoryFromPetition sets archived status", async () => {
  const { group, memberships } = await createFixture("cc_archive", 3);
  try {
    const category = await prisma.contributionCategory.create({
      data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Archived Cat", description: "x", status: "active" },
    });
    const archResult = await proposeContributionCategoryArchival(prisma, { membershipId: memberships[0].id, groupId: group.id, categoryId: category.id });
    assert.ok(archResult.ok);
    if (!archResult.ok) return;
    await prisma.petition.update({ where: { id: archResult.petitionId }, data: { status: "approved" } });
    await archiveContributionCategoryFromPetition(prisma, archResult.petitionId);
    const updated = await prisma.contributionCategory.findUniqueOrThrow({ where: { id: category.id } });
    assert.equal(updated.status, "archived");
    assert.ok(updated.archivedAt);
  } finally {
    await cleanupFixture("cc_archive");
  }
});

test("archiveContributionCategoryFromPetition is idempotent", async () => {
  const { group, memberships } = await createFixture("cc_arch_idemp", 3);
  try {
    const category = await prisma.contributionCategory.create({
      data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Idemp Cat", description: "x", status: "active" },
    });
    const archResult = await proposeContributionCategoryArchival(prisma, { membershipId: memberships[0].id, groupId: group.id, categoryId: category.id });
    assert.ok(archResult.ok);
    if (!archResult.ok) return;
    await prisma.petition.update({ where: { id: archResult.petitionId }, data: { status: "approved" } });
    await archiveContributionCategoryFromPetition(prisma, archResult.petitionId);
    await assert.doesNotReject(() => archiveContributionCategoryFromPetition(prisma, archResult.petitionId));
    const updated = await prisma.contributionCategory.findUniqueOrThrow({ where: { id: category.id } });
    assert.equal(updated.status, "archived");
  } finally {
    await cleanupFixture("cc_arch_idemp");
  }
});

test("proposeContributionCategoryArchival rejects already-archived category", async () => {
  const { group, memberships } = await createFixture("cc_arch_already");
  try {
    const category = await prisma.contributionCategory.create({
      data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Gone Cat", description: "x", status: "archived", archivedAt: new Date() },
    });
    const result = await proposeContributionCategoryArchival(prisma, { membershipId: memberships[0].id, groupId: group.id, categoryId: category.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "already_archived");
  } finally {
    await cleanupFixture("cc_arch_already");
  }
});

// ── Scope queries ─────────────────────────────────────────────────────────────

test("getAvailableCategoriesForScope excludes archived categories", async () => {
  const { group } = await createFixture("cc_scope_excl");
  try {
    await prisma.contributionCategory.createMany({
      data: [
        { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Active Cat", description: "x", status: "active" },
        { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Archived Cat", description: "x", status: "archived", archivedAt: new Date() },
      ],
    });
    const cats = await getAvailableCategoriesForScope(prisma, { groupId: group.id });
    assert.ok(cats.some((c) => c.name === "Active Cat"));
    assert.ok(!cats.some((c) => c.name === "Archived Cat"));
  } finally {
    await cleanupFixture("cc_scope_excl");
  }
});

test("trustedProviderExistsForCategory returns false when no trusted providers", async () => {
  const { group } = await createFixture("cc_tp_false");
  try {
    const category = await prisma.contributionCategory.create({
      data: { groupId: group.id, offeringEntityType: "group", offeringEntityId: group.id, name: "Empty Cat", description: "x", status: "active" },
    });
    const exists = await trustedProviderExistsForCategory(prisma, { categoryId: category.id, groupId: group.id });
    assert.equal(exists, false);
  } finally {
    await cleanupFixture("cc_tp_false");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string, memberCount = 2) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.cc.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const account = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const m = await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(m);
  }
  return { node, group, memberships };
}

async function createFixtureWithProject(prefix: string) {
  const base = await createFixture(prefix, 2);
  const project = await prisma.project.create({ data: { id: `${prefix}_proj`, groupId: base.group.id, name: `Project ${prefix}`, status: "active" } });
  // memberships[0] is the project member; memberships[1] is not
  const acct0 = await prisma.groupMembership.findUniqueOrThrow({ where: { id: base.memberships[0].id }, select: { accountId: true } });
  await prisma.projectMembership.create({ data: { accountId: acct0.accountId, projectId: project.id, status: "active", participationStatus: "active" } });
  return { ...base, project };
}

async function createFixtureWithResponsibility(prefix: string) {
  const base = await createFixture(prefix, 2);
  const responsibility = await prisma.responsibility.create({ data: { id: `${prefix}_resp`, groupId: base.group.id, type: `emergency_coord_${prefix}` } });
  await prisma.responsibilityAssignment.create({
    data: {
      responsibilityId: responsibility.id,
      membershipId: base.memberships[0].id,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  return { ...base, responsibility };
}

async function cleanupFixture(prefix: string) {
  await prisma.trustedProviderStatus.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.trustedProviderRevocationRequest.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.trustedProviderApplication.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contributionCategory.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contributionCategoryDraft.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { membership: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { project: { groupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
