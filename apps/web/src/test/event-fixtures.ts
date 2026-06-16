// Shared fixtures for RFC-008 coordination-event tests. Not a *.test.ts file, so the
// test runner never executes it directly — it is imported by the event test files.
import type { PrismaClient } from "../generated/prisma/client";
import { evaluateEventProposalForPetition } from "../lib/events";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function createNode(prisma: PrismaClient, prefix: string) {
  return prisma.node.create({
    data: {
      id: `${prefix}_node`,
      name: `Node ${prefix}`,
      domain: `${prefix}.evt.localhost`,
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
    },
  });
}

export async function createMember(prisma: PrismaClient, nodeId: string, prefix: string, suffix: string) {
  const account = await prisma.account.create({
    data: {
      id: `${prefix}_acct_${suffix}`,
      homeNodeId: nodeId,
      displayName: `User ${prefix} ${suffix}`,
      accountType: "member",
      profileVisibility: "private",
    },
  });
  return account;
}

/** Node + group + one active member. */
export async function createGroupFixture(prisma: PrismaClient, prefix: string) {
  const node = await createNode(prisma, prefix);
  const account = await createMember(prisma, node.id, prefix, "0");
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  return { nodeId: node.id, accountId: account.id, groupId: group.id, membershipId: membership.id };
}

/** Group fixture + a project it hosts, with the member also an active project member. */
export async function createProjectFixture(prisma: PrismaClient, prefix: string) {
  const base = await createGroupFixture(prisma, prefix);
  const project = await prisma.project.create({
    data: { id: `${prefix}_proj`, name: `Project ${prefix}`, foundingGroupId: base.groupId, status: "active" },
  });
  await prisma.projectHosting.create({ data: { projectId: project.id, groupId: base.groupId } });
  const projectMembership = await prisma.projectMembership.create({
    data: { id: `${prefix}_pmem`, accountId: base.accountId, projectId: project.id, status: "active", participationStatus: "active" },
  });
  return { ...base, projectId: project.id, projectMembershipId: projectMembership.id };
}

/** Group fixture + a responsibility the member actively holds. */
export async function createResponsibilityFixture(prisma: PrismaClient, prefix: string, type = "reviewer") {
  const base = await createGroupFixture(prisma, prefix);
  const responsibility = await prisma.responsibility.create({
    data: { id: `${prefix}_resp`, groupId: base.groupId, type, termDays: 365 },
  });
  await prisma.responsibilityAssignment.create({
    data: {
      id: `${prefix}_assign`,
      responsibilityId: responsibility.id,
      membershipId: base.membershipId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + YEAR_MS),
    },
  });
  return { ...base, responsibilityId: responsibility.id, responsibilityType: type };
}

/** Node + coalition with `groupCount` member groups, each with one active member. */
export async function createCoalitionFixture(prisma: PrismaClient, prefix: string, groupCount = 2) {
  const node = await createNode(prisma, prefix);
  const coalition = await prisma.coalition.create({
    data: { id: `${prefix}_coal`, nodeId: node.id, name: `Coalition ${prefix}`, status: "active" },
  });
  const groups: { groupId: string; accountId: string; membershipId: string }[] = [];
  for (let i = 0; i < groupCount; i++) {
    const account = await createMember(prisma, node.id, prefix, `${i}`);
    const group = await prisma.group.create({
      data: { id: `${prefix}_group_${i}`, nodeId: node.id, name: `Group ${prefix} ${i}`, membershipPolicy: "open" },
    });
    const membership = await prisma.groupMembership.create({
      data: { id: `${prefix}_mem_${i}`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    });
    await prisma.coalitionMembership.create({
      data: { id: `${prefix}_cm_${i}`, coalitionId: coalition.id, groupId: group.id },
    });
    groups.push({ groupId: group.id, accountId: account.id, membershipId: membership.id });
  }
  return { nodeId: node.id, coalitionId: coalition.id, groups };
}

/** Force all child petitions of a proposal to approved, then run the apply path. */
export async function approveEventProposal(prisma: PrismaClient, petitionIds: string[]) {
  await prisma.petition.updateMany({ where: { id: { in: petitionIds } }, data: { status: "approved" } });
  return evaluateEventProposalForPetition(prisma, petitionIds[0]);
}

export async function cleanupEventFixture(prisma: PrismaClient, prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.eventInterest.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.calendarEvent.deleteMany({
    where: { OR: [{ hostId: { startsWith: prefix } }, { createdByAccountId: { startsWith: prefix } }] },
  });
  await prisma.eventProposal.deleteMany({ where: { hostId: { startsWith: prefix } } });
  await prisma.calendarFilterPreference.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({
    where: { OR: [{ groupId: { startsWith: prefix } }, { scopeId: { startsWith: prefix } }] },
  });
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.coalitionMembership.deleteMany({ where: { coalitionId: { startsWith: prefix } } });
  await prisma.coalition.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.projectHosting.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { foundingGroupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
