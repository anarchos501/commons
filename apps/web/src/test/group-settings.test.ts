import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { applyGroupVisibilityFromPetition, createGroup, proposeGroupVisibility } from "../lib/group-settings";
import { applyForGroupMembership, sponsorMembershipApplication } from "../lib/group-membership";
import { provisionConcernReviewer } from "../lib/concern-reviewer";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("createGroup creates a private request-required group with the creator as active member", async () => {
  await cleanupFixture("gs_create");
  try {
    const { node, account } = await createBase("gs_create");

    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "New Private Group",
      description: "A fresh group.",
      creatorAccountId: account.id,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.visibility, "private");
    assert.equal(group.membershipPolicy, "request_required");

    const membership = await prisma.groupMembership.findUniqueOrThrow({
      where: { accountId_groupId: { accountId: account.id, groupId: group.id } },
    });
    assert.equal(membership.status, "active");
    assert.equal(membership.participationStatus, "active");
  } finally {
    await cleanupFixture("gs_create");
  }
});

test("createGroup with explicit 'open' policy creates an open group", async () => {
  await cleanupFixture("gs_open");
  try {
    const { node, account } = await createBase("gs_open");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Open Group",
      creatorAccountId: account.id,
      membershipPolicy: "open",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "open");
  } finally {
    await cleanupFixture("gs_open");
  }
});

test("createGroup with explicit 'request_required' policy creates a request_required group", async () => {
  await cleanupFixture("gs_rr");
  try {
    const { node, account } = await createBase("gs_rr");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "RR Group",
      creatorAccountId: account.id,
      membershipPolicy: "request_required",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "request_required");
  } finally {
    await cleanupFixture("gs_rr");
  }
});

test("createGroup with missing or invalid policy defaults to request_required", async () => {
  await cleanupFixture("gs_fallback");
  try {
    const { node, account } = await createBase("gs_fallback");
    // No membershipPolicy provided
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Fallback Group",
      creatorAccountId: account.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.membershipPolicy, "request_required");
  } finally {
    await cleanupFixture("gs_fallback");
  }
});

test("group visibility petition approval makes the group public", async () => {
  await cleanupFixture("gs_visibility");
  try {
    const { group, membership } = await createGroupFixture("gs_visibility");

    const result = await proposeGroupVisibility(prisma, {
      groupId: group.id,
      createdByMembershipId: membership.id,
      target: "public",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.category, "group_settings");
    assert.equal(petition.subjectType, "group_visibility_proposal");
    // subjectId now encodes the target direction as `${groupId}:${target}`.
    assert.equal(petition.subjectId, `${group.id}:public`);

    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved" } });
    await applyGroupVisibilityFromPetition(prisma, result.petitionId);

    const updated = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(updated.visibility, "public");
  } finally {
    await cleanupFixture("gs_visibility");
  }
});

test("group visibility is reversible: a public group can be petitioned back to private (F2)", async () => {
  await cleanupFixture("gs_reverse");
  try {
    const { group, membership } = await createGroupFixture("gs_reverse");
    // Start the group public.
    await prisma.group.update({ where: { id: group.id }, data: { visibility: "public" } });

    const result = await proposeGroupVisibility(prisma, {
      groupId: group.id,
      createdByMembershipId: membership.id,
      target: "private",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.subjectId, `${group.id}:private`);

    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved" } });
    await applyGroupVisibilityFromPetition(prisma, result.petitionId);

    const updated = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(updated.visibility, "private");
  } finally {
    await cleanupFixture("gs_reverse");
  }
});

test("proposeGroupVisibility refuses a no-op (target equals current visibility)", async () => {
  await cleanupFixture("gs_noop");
  try {
    const { group, membership } = await createGroupFixture("gs_noop"); // created private
    const result = await proposeGroupVisibility(prisma, {
      groupId: group.id,
      createdByMembershipId: membership.id,
      target: "private",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "already_set");

    // No petition should have been opened.
    const count = await prisma.petition.count({
      where: { groupId: group.id, subjectType: "group_visibility_proposal" },
    });
    assert.equal(count, 0);
  } finally {
    await cleanupFixture("gs_noop");
  }
});

test("createGroup respects explicit 'public' visibility and provisions a Concern Reviewer", async () => {
  await cleanupFixture("gs_public");
  try {
    const { node, account } = await createBase("gs_public");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Public Group",
      creatorAccountId: account.id,
      visibility: "public",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.visibility, "public");

    // Every group is provisioned with the Concern Reviewer accountability role.
    const reviewer = await prisma.responsibility.findUniqueOrThrow({
      where: { groupId_type: { groupId: group.id, type: "reviewer" } },
      include: { abilities: true },
    });
    const abilities = reviewer.abilities.map((a) => a.ability).sort();
    assert.deepEqual(abilities, [
      "administrative_closure",
      "issue_action_proposals",
      "issue_findings",
      "review_concerns",
    ]);
  } finally {
    await cleanupFixture("gs_public");
  }
});

test("sponsoring the same applicant twice does not create duplicate petitions", async () => {
  await cleanupFixture("gs_dupe");
  try {
    const { node, account } = await createBase("gs_dupe");
    const created = await createGroup(prisma, {
      nodeId: node.id,
      name: "Sponsor Group",
      creatorAccountId: account.id,
      membershipPolicy: "request_required",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const applicant = await prisma.account.create({
      data: {
        id: "gs_dupe_applicant",
        homeNodeId: node.id,
        displayName: "Applicant",
        accountType: "member",
        profileVisibility: "private",
      },
    });
    const application = await applyForGroupMembership(prisma, applicant.id, created.groupId);
    assert.equal(application.ok, true);
    if (!application.ok) return;

    const sponsor = await prisma.groupMembership.findUniqueOrThrow({
      where: { accountId_groupId: { accountId: account.id, groupId: created.groupId } },
      select: { id: true },
    });

    const first = await sponsorMembershipApplication(prisma, sponsor.id, application.membershipId);
    const second = await sponsorMembershipApplication(prisma, sponsor.id, application.membershipId);
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "already_open");

    const openPetitions = await prisma.petition.count({
      where: {
        groupId: created.groupId,
        subjectType: "membership_request",
        subjectId: application.membershipId,
        status: "open",
      },
    });
    assert.equal(openPetitions, 1);
  } finally {
    await cleanupFixture("gs_dupe");
  }
});

test("createGroup with default (private) visibility also provisions the Concern Reviewer", async () => {
  await cleanupFixture("gs_default_reviewer");
  try {
    const { node, account } = await createBase("gs_default_reviewer");
    const result = await createGroup(prisma, {
      nodeId: node.id,
      name: "Default Reviewer Group",
      creatorAccountId: account.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const group = await prisma.group.findUniqueOrThrow({ where: { id: result.groupId } });
    assert.equal(group.visibility, "private");

    const reviewer = await prisma.responsibility.findUniqueOrThrow({
      where: { groupId_type: { groupId: group.id, type: "reviewer" } },
      include: { abilities: true },
    });
    const abilities = reviewer.abilities.map((a) => a.ability).sort();
    assert.deepEqual(abilities, [
      "administrative_closure",
      "issue_action_proposals",
      "issue_findings",
      "review_concerns",
    ]);
  } finally {
    await cleanupFixture("gs_default_reviewer");
  }
});

test("provisionConcernReviewer backfills a group missing the role and is idempotent", async () => {
  await cleanupFixture("gs_backfill");
  try {
    const { node } = await createBase("gs_backfill");
    // A group created WITHOUT the reviewer role (simulates a pre-auto-provision group).
    const group = await prisma.group.create({
      data: { id: "gs_backfill_group", nodeId: node.id, name: "Legacy Group", membershipPolicy: "open", visibility: "private" },
    });
    assert.equal(await prisma.responsibility.count({ where: { groupId: group.id, type: "reviewer" } }), 0);

    await provisionConcernReviewer(prisma, group.id);
    await provisionConcernReviewer(prisma, group.id); // second call must be a no-op

    const reviewers = await prisma.responsibility.findMany({
      where: { groupId: group.id, type: "reviewer" },
      include: { abilities: true },
    });
    assert.equal(reviewers.length, 1);
    assert.equal(reviewers[0].abilities.length, 4);
  } finally {
    await cleanupFixture("gs_backfill");
  }
});

async function createBase(prefix: string) {
  const node = await prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Node ${prefix}`,
      domain: `${prefix}.cc.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });
  const account = await prisma.account.create({
    data: {
      id: `${prefix}_acct`,
      homeNodeId: node.id,
      displayName: `User ${prefix}`,
      accountType: "member",
      profileVisibility: "private",
    },
  });
  return { node, account };
}

async function createGroupFixture(prefix: string) {
  const { node, account } = await createBase(prefix);
  const group = await prisma.group.create({
    data: {
      id: `${prefix}_group`,
      nodeId: node.id,
      name: `Group ${prefix}`,
      membershipPolicy: "request_required",
      visibility: "private",
    },
  });
  const membership = await prisma.groupMembership.create({
    data: {
      id: `${prefix}_mem`,
      accountId: account.id,
      groupId: group.id,
      status: "active",
      participationStatus: "active",
    },
  });
  return { group, membership };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { group: { nodeId: { startsWith: prefix } } } } });
  await prisma.petition.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  // createGroup now auto-provisions a Concern Reviewer responsibility (+ abilities) per group.
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { group: { nodeId: { startsWith: prefix } } } } });
  await prisma.responsibility.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
