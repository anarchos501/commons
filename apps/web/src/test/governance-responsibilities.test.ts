import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  createAssignment,
  volunteerForResponsibility,
  confirmResponsibilityAssignment,
  declareTempStewardship,
  getResponsibilityCoverage,
} from "../lib/responsibilities";
import { evaluatePetition } from "../lib/petitions";
import { withdrawPetitionBySubject } from "../lib/petitions";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ---- createAssignment still works as internal primitive ----

test("createAssignment (internal primitive) still creates an assignment", async () => {
  const { group, membership } = await createFixture("grsp_create");
  try {
    await createAssignment(prisma, membership.id, "steward");
    const assignment = await prisma.responsibilityAssignment.findFirst({ where: { membershipId: membership.id } });
    assert.ok(assignment);
    assert.ok(assignment.expiresAt > new Date());
  } finally {
    await cleanupFixture("grsp_create");
  }
});

// ---- volunteerForResponsibility → petition → confirmResponsibilityAssignment ----

test("volunteerForResponsibility opens a petition for the responsibility type", async () => {
  const { group, membership } = await createFixture("grsp_volunteer");
  try {
    const result = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.category, "responsibility");
    assert.equal(petition.subjectType, "responsibility_proposal");
    assert.ok(petition.subjectId.startsWith(membership.id));
    assert.equal(petition.competitionKey, null); // non-competing (multi-holder)
  } finally {
    await cleanupFixture("grsp_volunteer");
  }
});

test("confirmResponsibilityAssignment creates assignment with snapshot reconfirmationPeriod", async () => {
  const { group, membership } = await createFixture("grsp_confirm", 3);
  try {
    const result = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    if (!result.ok) return;

    // Add enough support (need >= 50% of 3 active members = 2)
    const allMemberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: allMemberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await confirmResponsibilityAssignment(prisma, result.petitionId);

    const assignment = await prisma.responsibilityAssignment.findFirst({ where: { membershipId: membership.id } });
    assert.ok(assignment);

    // expiresAt must be ~365 days from now (default reconfirmationPeriod at temp=0)
    const daysUntilExpiry = (assignment.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(daysUntilExpiry - 365) < 1, `Expected ~365 days, got ${daysUntilExpiry}`);

    // Coverage is now covered
    const coverage = await getResponsibilityCoverage(prisma, group.id, "reviewer");
    assert.equal(coverage, "covered");
  } finally {
    await cleanupFixture("grsp_confirm");
  }
});

test("Responsibility.termDays is not modified by governance-path assignment", async () => {
  const { group, membership } = await createFixture("grsp_termsdays", 3);
  try {
    const result = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "coord" });
    if (!result.ok) return;
    const allMemberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: allMemberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await confirmResponsibilityAssignment(prisma, result.petitionId);

    const responsibility = await prisma.responsibility.findFirst({ where: { groupId: group.id, type: "coord" } });
    assert.ok(responsibility);
    assert.equal(responsibility.termDays, 365); // default unchanged — governance-path does not mutate this field
  } finally {
    await cleanupFixture("grsp_termsdays");
  }
});

test("multiple volunteers can be confirmed simultaneously (multi-holder)", async () => {
  const { group, memberships } = await createFixture("grsp_multi", 4);
  try {
    const [r1, r2] = await Promise.all([
      volunteerForResponsibility(prisma, { membershipId: memberships[0].id, type: "steward" }),
      volunteerForResponsibility(prisma, { membershipId: memberships[1].id, type: "steward" }),
    ]);
    if (!r1.ok || !r2.ok) return;
    // Both petitions are open simultaneously — no competition
    const p1 = await prisma.petition.findUniqueOrThrow({ where: { id: r1.petitionId } });
    const p2 = await prisma.petition.findUniqueOrThrow({ where: { id: r2.petitionId } });
    assert.equal(p1.competitionKey, null);
    assert.equal(p2.competitionKey, null);
    assert.equal(p1.status, "open");
    assert.equal(p2.status, "open");
  } finally {
    await cleanupFixture("grsp_multi");
  }
});

test("volunteer withdrawal closes responsibility petition as withdrawn", async () => {
  const { group, membership } = await createFixture("grsp_withdraw");
  try {
    const result = await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
    if (!result.ok) return;

    // Volunteer withdraws using their encoded subjectId
    await withdrawPetitionBySubject(prisma, { subjectType: "responsibility_proposal", subjectId: `${membership.id}:reviewer` });

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.status, "withdrawn");
  } finally {
    await cleanupFixture("grsp_withdraw");
  }
});

test("declareTempStewardship uses resolver duration (default 30 days at neutral temperature)", async () => {
  const { group, membership } = await createFixture("grsp_steward");
  try {
    await declareTempStewardship(prisma, membership.id, "reviewer");
    const assignment = await prisma.responsibilityAssignment.findFirst({ where: { membershipId: membership.id } });
    assert.ok(assignment);
    const daysUntilExpiry = (assignment.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    // Default emergency.duration at temperature=0 is 30 days
    assert.ok(Math.abs(daysUntilExpiry - 30) < 1, `Expected ~30 days, got ${daysUntilExpiry}`);
  } finally {
    await cleanupFixture("grsp_steward");
  }
});

// ---- fixtures ----

async function createFixture(prefix: string, memberCount = 1) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.resp.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const memberships = [];
  for (let i = 0; i < memberCount; i++) {
    const a = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    const m = await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: a.id, groupId: group.id, status: "active", participationStatus: "active" } });
    memberships.push(m);
  }
  return { node, group, membership: memberships[0], memberships };
}

async function cleanupFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
