import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { describePetitionSubject, getPetitionDetail } from "../lib/petition-evaluation";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const PREFIX = "pe_test";

type Fixture = {
  groupId: string;
  creatorMembershipId: string;
  creatorName: string;
  pendingMembershipId: string;
  applicantName: string;
  proposalId: string;
  reviewerDraftId: string;
};

async function setup(): Promise<Fixture> {
  await cleanup();
  const node = await prisma.node.create({
    data: { id: `${PREFIX}_node`, name: "PE Node", domain: `${PREFIX}.cc.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const creator = await prisma.account.create({
    data: { id: `${PREFIX}_creator`, homeNodeId: node.id, displayName: "Dana Creator", accountType: "member", profileVisibility: "private" },
  });
  const applicant = await prisma.account.create({
    data: { id: `${PREFIX}_applicant`, homeNodeId: node.id, displayName: "Pat Applicant", accountType: "member", profileVisibility: "private" },
  });
  const group = await prisma.group.create({
    data: { id: `${PREFIX}_group`, nodeId: node.id, name: "PE Collective", membershipPolicy: "request_required", visibility: "private" },
  });
  const creatorMembership = await prisma.groupMembership.create({
    data: { id: `${PREFIX}_cmem`, accountId: creator.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  const pendingMembership = await prisma.groupMembership.create({
    data: { id: `${PREFIX}_pmem`, accountId: applicant.id, groupId: group.id, status: "pending", applicationNote: "I cook on weekends." },
  });
  const proposal = await prisma.proposal.create({
    data: { id: `${PREFIX}_proposal`, groupId: group.id, title: "Community Garden", body: "A shared plot behind the library.", createdByAccountId: creator.id, status: "open" },
  });
  const reviewerDraft = await prisma.responsibilityProposalDraft.create({
    data: {
      id: `${PREFIX}_rdraft`,
      groupId: group.id,
      type: "reviewer",
      description: "Reviews concerns raised in the group.",
      abilities: [
        { ability: "review_concerns", availability: "always_available" },
        { ability: "issue_findings", availability: "always_available" },
      ],
      proposedByMembershipId: creatorMembership.id,
    },
  });
  return {
    groupId: group.id,
    creatorMembershipId: creatorMembership.id,
    creatorName: creator.displayName,
    pendingMembershipId: pendingMembership.id,
    applicantName: applicant.displayName,
    proposalId: proposal.id,
    reviewerDraftId: reviewerDraft.id,
  };
}

async function cleanup() {
  await prisma.responsibilityProposalDraft.deleteMany({ where: { group: { nodeId: { startsWith: PREFIX } } } });
  await prisma.proposal.deleteMany({ where: { group: { nodeId: { startsWith: PREFIX } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: PREFIX } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: PREFIX } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

test("describePetitionSubject returns human-readable labels, never a raw id", async () => {
  const f = await setup();
  try {
    assert.equal(await describePetitionSubject(prisma, "membership_request", f.pendingMembershipId), f.applicantName);
    assert.equal(await describePetitionSubject(prisma, "project_proposal", f.proposalId), "Community Garden");
    assert.equal(await describePetitionSubject(prisma, "group_visibility_proposal", f.groupId), 'Make "PE Collective" publicly visible');

    // Unhandled family must degrade to the family label, never echo the raw subjectId.
    const coalitionLabel = await describePetitionSubject(prisma, "coalition_formation", "some-opaque-cuid-1234");
    assert.equal(coalitionLabel, "Coalition formation");
    assert.ok(!coalitionLabel.includes("cuid"));
  } finally {
    await cleanup();
  }
});

test("getPetitionDetail: membership_request summary, proposer, fields, and status-aware outcome", async () => {
  const f = await setup();
  try {
    const open = await getPetitionDetail(prisma, {
      subjectType: "membership_request",
      subjectId: f.pendingMembershipId,
      status: "open",
      createdByMembershipId: f.creatorMembershipId,
      createdByAccountId: null,
    });
    assert.equal(open.summary, f.applicantName);
    assert.equal(open.proposer, f.creatorName);
    assert.ok(open.outcome.startsWith("If approved:"));
    assert.ok(open.outcome.includes(`${f.applicantName} becomes a member`));
    const applicantField = open.fields.find((x) => x.label === "Applicant");
    const messageField = open.fields.find((x) => x.label === "Application message");
    assert.equal(applicantField?.value, f.applicantName);
    assert.equal(messageField?.value, "I cook on weekends.");

    // Status-aware framing: resolved petitions must NOT say "If approved".
    const approved = await getPetitionDetail(prisma, {
      subjectType: "membership_request", subjectId: f.pendingMembershipId, status: "approved",
      createdByMembershipId: f.creatorMembershipId, createdByAccountId: null,
    });
    assert.ok(approved.outcome.startsWith("Approved:"));
    assert.ok(!approved.outcome.includes("If approved"));

    const rejected = await getPetitionDetail(prisma, {
      subjectType: "membership_request", subjectId: f.pendingMembershipId, status: "rejected",
      createdByMembershipId: f.creatorMembershipId, createdByAccountId: null,
    });
    assert.ok(rejected.outcome.startsWith("Rejected. Would have:"));
  } finally {
    await cleanup();
  }
});

test("getPetitionDetail: project, responsibility, and generic-fallback details", async () => {
  const f = await setup();
  try {
    const project = await getPetitionDetail(prisma, {
      subjectType: "project_proposal", subjectId: f.proposalId, status: "open",
      createdByMembershipId: f.creatorMembershipId, createdByAccountId: null,
    });
    assert.equal(project.summary, "Community Garden");
    assert.equal(project.fields.find((x) => x.label === "Project")?.value, "Community Garden");
    assert.equal(project.fields.find((x) => x.label === "Description")?.value, "A shared plot behind the library.");

    // Reviewer responsibility proposal: type "reviewer" must render as "Concern Reviewer".
    const reviewer = await getPetitionDetail(prisma, {
      subjectType: "responsibility_creation_proposal", subjectId: f.reviewerDraftId, status: "open",
      createdByMembershipId: f.creatorMembershipId, createdByAccountId: null,
    });
    assert.ok(reviewer.summary.includes("Concern Reviewer"));
    assert.equal(reviewer.fields.find((x) => x.label === "Responsibility")?.value, "Concern Reviewer");
    assert.ok(reviewer.fields.find((x) => x.label === "Abilities")?.value.includes("review concerns"));
    assert.ok(reviewer.outcome.includes('"Concern Reviewer"'));

    // System-initiated petition (no creator) -> proposer null; unhandled family -> generic outcome + label summary.
    const generic = await getPetitionDetail(prisma, {
      subjectType: "coalition_formation", subjectId: "opaque-id", status: "open",
      createdByMembershipId: null, createdByAccountId: null,
    });
    assert.equal(generic.proposer, null);
    assert.equal(generic.summary, "Coalition formation");
    assert.ok(generic.outcome.startsWith("If approved:"));
  } finally {
    await cleanup();
  }
});

test("getPetitionDetail does not throw when the subject record is missing", async () => {
  await setup();
  try {
    const detail = await getPetitionDetail(prisma, {
      subjectType: "membership_request", subjectId: "does-not-exist", status: "open",
      createdByMembershipId: null, createdByAccountId: null,
    });
    // Falls back gracefully — no raw id leak, no crash.
    assert.equal(detail.summary, "membership request");
    assert.ok(detail.outcome.includes("the applicant"));
  } finally {
    await cleanup();
  }
});
