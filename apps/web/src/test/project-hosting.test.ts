import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { addPetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import {
  openProjectHostingProposal,
  openProjectHostingWithdrawalPetition,
} from "../lib/project-hosting";
import { syncProjectHostingLifecycle } from "../lib/project-membership";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("approved host withdrawal ends the active hosting and opens pending closure", async () => {
  const { group, project, groupMemberships } = await createFixture("ph_withdraw");
  try {
    const result = await openProjectHostingWithdrawalPetition(prisma, {
      projectId: project.id,
      groupId: group.id,
      createdByMembershipId: groupMemberships[0].id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    for (const membership of groupMemberships) {
      await addPetitionSupport(prisma, { petitionId: result.petitionId, actorAccountId: membership.accountId, membershipId: membership.id });
    }
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prisma, result.petitionId);

    const hosting = await prisma.projectHosting.findUniqueOrThrow({ where: { id: result.hostingId } });
    const updatedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.notEqual(hosting.endedAt, null);
    assert.notEqual(updatedProject.pendingClosureAt, null);
    assert.equal(updatedProject.status, "active");
  } finally {
    await cleanupFixture("ph_withdraw");
  }
});

test("project hosting proposal succeeds atomically after both child petitions approve", async () => {
  const { candidateGroup, candidateMemberships, project, projectMemberships } = await createFixture("ph_success");
  try {
    await makeHostless(project.id, "ph_success_group");
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[0].id,
      projectCreatedByProjectMembershipId: projectMemberships[0].id,
      content: "Adopt the project as a new host.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    for (const membership of candidateMemberships) {
      await addPetitionSupport(prisma, { petitionId: result.groupPetitionId, actorAccountId: membership.accountId, membershipId: membership.id });
    }
    for (const membership of projectMemberships) {
      await addPetitionSupport(prisma, { petitionId: result.projectPetitionId, actorAccountId: membership.accountId, projectMembershipId: membership.id });
    }
    await prisma.petition.updateMany({
      where: { id: { in: [result.groupPetitionId, result.projectPetitionId] } },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    await evaluateAndApplyPetition(prisma, result.groupPetitionId);
    let proposal = await prisma.projectHostingProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "succeeded");

    await evaluateAndApplyPetition(prisma, result.projectPetitionId);
    proposal = await prisma.projectHostingProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    const hosting = await prisma.projectHosting.findFirst({
      where: { projectId: project.id, groupId: candidateGroup.id, endedAt: null },
    });
    const updatedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(proposal.status, "succeeded");
    assert.ok(hosting);
    assert.equal(updatedProject.pendingClosureAt, null);
  } finally {
    await cleanupFixture("ph_success");
  }
});

test("project hosting proposal failure supersedes the still-open child petition", async () => {
  const { candidateGroup, candidateMemberships, project, projectMemberships } = await createFixture("ph_fail");
  try {
    await makeHostless(project.id, "ph_fail_group");
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[0].id,
      projectCreatedByProjectMembershipId: projectMemberships[0].id,
      content: "Adopt the project as a new host.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.petition.update({ where: { id: result.groupPetitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prisma, result.groupPetitionId);

    const proposal = await prisma.projectHostingProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    const projectPetition = await prisma.petition.findUniqueOrThrow({ where: { id: result.projectPetitionId } });
    assert.equal(proposal.status, "failed-rejected");
    assert.equal(projectPetition.status, "superseded");
  } finally {
    await cleanupFixture("ph_fail");
  }
});

test("project hosting proposal uses frozen electorate membership ids", async () => {
  const { candidateGroup, candidateMemberships, project, projectMemberships } = await createFixture("ph_frozen");
  try {
    await makeHostless(project.id, "ph_frozen_group");
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[0].id,
      projectCreatedByProjectMembershipId: projectMemberships[0].id,
      content: "Adopt the project as a new host.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.projectMembership.update({
      where: { id: projectMemberships[0].id },
      data: { participationStatus: "quiet" },
    });
    const quietSupport = await addPetitionSupport(prisma, {
      petitionId: result.projectPetitionId,
      actorAccountId: projectMemberships[0].accountId,
      projectMembershipId: projectMemberships[0].id,
    });
    assert.equal(quietSupport.ok, true);

    await prisma.projectMembership.update({
      where: { id: projectMemberships[1].id },
      data: { status: "inactive" },
    });
    const inactiveSupport = await addPetitionSupport(prisma, {
      petitionId: result.projectPetitionId,
      actorAccountId: projectMemberships[1].accountId,
      projectMembershipId: projectMemberships[1].id,
    });
    assert.equal(inactiveSupport.ok, false);
    if (!inactiveSupport.ok) assert.equal(inactiveSupport.reason, "not_eligible");
  } finally {
    await cleanupFixture("ph_frozen");
  }
});

test("project hosting proposal rejects a pending-closure project with an empty electorate", async () => {
  const { candidateGroup, candidateMemberships, project } = await createFixture("ph_empty");
  try {
    await prisma.projectMembership.updateMany({ where: { projectId: project.id }, data: { participationStatus: "quiet" } });
    await makeHostless(project.id, "ph_empty_group");
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[0].id,
      projectCreatedByProjectMembershipId: "ph_empty_project_membership_0",
      content: "Adopt the project as a new host.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_electorate");
  } finally {
    await cleanupFixture("ph_empty");
  }
});

test("additional-host proposal succeeds on a hosted project and keeps the existing host", async () => {
  const { group, candidateGroup, candidateMemberships, project, projectMemberships } = await createFixture("ph_addhost");
  try {
    // No makeHostless: the project is normally hosted by `group`, so this opens in
    // additional-host mode (pendingClosureAt is null).
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[0].id,
      projectCreatedByProjectMembershipId: projectMemberships[0].id,
      content: "Add a second host collective.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The stored snapshot pins additional-host mode.
    const proposalRow = await prisma.projectHostingProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal((proposalRow.projectSnapshot as { pendingClosureAt: string | null }).pendingClosureAt, null);

    // Duplicate (project, group) pair is rejected while the first proposal is open.
    const dup = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: candidateGroup.id,
      groupCreatedByMembershipId: candidateMemberships[1].id,
      projectCreatedByProjectMembershipId: projectMemberships[1].id,
      content: "Duplicate.",
    });
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.reason, "proposal_already_open");

    for (const membership of candidateMemberships) {
      await addPetitionSupport(prisma, { petitionId: result.groupPetitionId, actorAccountId: membership.accountId, membershipId: membership.id });
    }
    for (const membership of projectMemberships) {
      await addPetitionSupport(prisma, { petitionId: result.projectPetitionId, actorAccountId: membership.accountId, projectMembershipId: membership.id });
    }
    await prisma.petition.updateMany({
      where: { id: { in: [result.groupPetitionId, result.projectPetitionId] } },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    // Cross-mode pin: the closure clock starts MID-VOTE (e.g. the existing host withdrew).
    // Evaluation must still run the additional-host path — pinned by the stored snapshot —
    // not auto-fail on the adoption deadline.
    await prisma.project.update({
      where: { id: project.id },
      data: {
        pendingClosureAt: new Date(),
        pendingClosureElectorate: {
          projectId: project.id,
          capturedAt: new Date().toISOString(),
          projectMembershipIds: projectMemberships.map((m) => m.id),
          accountIds: projectMemberships.map((m) => m.accountId),
        },
      },
    });

    await evaluateAndApplyPetition(prisma, result.groupPetitionId);
    await evaluateAndApplyPetition(prisma, result.projectPetitionId);

    const proposal = await prisma.projectHostingProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    assert.equal(proposal.status, "succeeded");

    // Both hosts are active concurrently (multi-host decision, feedback #7).
    const activeHostings = await prisma.projectHosting.findMany({
      where: { projectId: project.id, endedAt: null },
      select: { groupId: true },
    });
    const activeHostGroupIds = activeHostings.map((h) => h.groupId).sort();
    assert.deepEqual(activeHostGroupIds, [group.id, candidateGroup.id].sort());

    // The mid-vote closure clock was cancelled — the project is hosted again.
    const updatedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(updatedProject.pendingClosureAt, null);
  } finally {
    await cleanupFixture("ph_addhost");
  }
});

test("additional-host proposal rejects a candidate that already hosts the project", async () => {
  const { group, groupMemberships, project, projectMemberships } = await createFixture("ph_duphost");
  try {
    const result = await openProjectHostingProposal(prisma, {
      projectId: project.id,
      candidateGroupId: group.id,
      groupCreatedByMembershipId: groupMemberships[0].id,
      projectCreatedByProjectMembershipId: projectMemberships[0].id,
      content: "Already hosting.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "already_hosted");
  } finally {
    await cleanupFixture("ph_duphost");
  }
});

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });
  const candidateGroup = await prisma.group.create({
    data: { id: `${prefix}_candidate`, nodeId: node.id, name: `Candidate ${prefix}`, membershipPolicy: "open" },
  });

  const groupMemberships = [];
  const candidateMemberships = [];
  const projectMemberships = [];

  for (let i = 0; i < 3; i++) {
    const account = await prisma.account.create({
      data: {
        id: `${prefix}_account_${i}`,
        homeNodeId: node.id,
        displayName: `User ${prefix} ${i}`,
        accountType: "member",
        profileVisibility: "private",
      },
    });
    groupMemberships.push(await prisma.groupMembership.create({
      data: { id: `${prefix}_group_membership_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    }));
    candidateMemberships.push(await prisma.groupMembership.create({
      data: { id: `${prefix}_candidate_membership_${i}`, accountId: account.id, groupId: candidateGroup.id, status: "active", participationStatus: "active" },
    }));
  }

  const project = await prisma.project.create({
    data: { id: `${prefix}_project`, foundingGroupId: group.id, name: `Project ${prefix}`, status: "active" },
  });
  await prisma.projectHosting.create({ data: { projectId: project.id, groupId: group.id } });

  for (let i = 0; i < 2; i++) {
    projectMemberships.push(await prisma.projectMembership.create({
      data: {
        id: `${prefix}_project_membership_${i}`,
        accountId: `${prefix}_account_${i}`,
        projectId: project.id,
        status: "active",
        participationStatus: "active",
      },
    }));
  }

  return { node, group, candidateGroup, groupMemberships, candidateMemberships, project, projectMemberships };
}

async function makeHostless(projectId: string, groupId: string) {
  await prisma.projectHosting.updateMany({
    where: { projectId, groupId, endedAt: null },
    data: { endedAt: new Date() },
  });
  await syncProjectHostingLifecycle(prisma, projectId);
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { OR: [{ groupId: { startsWith: prefix } }, { scopeId: { startsWith: prefix } }] } } });
  await prisma.projectHostingProposal.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({ where: { OR: [{ groupId: { startsWith: prefix } }, { scopeId: { startsWith: prefix } }] } });
  await prisma.actionLog.deleteMany({ where: { OR: [{ groupId: { startsWith: prefix } }, { actorAccountId: { startsWith: prefix } }] } });
  await prisma.projectMembership.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.projectHosting.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
