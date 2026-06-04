import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { isEligibleReviewer, getCoverageStatus, startReview, issueFindings, proposeAction, closeConcern } from "../lib/concerns";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- isEligibleReviewer ---

test("isEligibleReviewer returns true for active member with reviewer responsibility", async () => {
  const { group, reviewerAccount, report } = await createFixture("cer_eligible");
  try {
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id);
    assert.equal(eligible, true);
  } finally {
    await cleanupFixture("cer_eligible");
  }
});

test("isEligibleReviewer returns false when member lacks reviewer responsibility", async () => {
  const { group, report } = await createFixture("cer_norole");
  try {
    const member = await prisma.account.create({
      data: { id: "cer_norole_member2", homeNodeId: `cer_norole_node`, displayName: "Member 2", accountType: "member", profileVisibility: "private" },
    });
    await prisma.groupMembership.create({ data: { accountId: member.id, groupId: group.id, status: "active" } });

    const eligible = await isEligibleReviewer(prisma, member.id, group.id, report.id);
    assert.equal(eligible, false);
  } finally {
    await cleanupFixture("cer_norole");
  }
});

test("isEligibleReviewer returns false when reviewer is the reporter", async () => {
  const { group, reviewerAccount } = await createFixture("cer_reporter");
  try {
    // Report submitted by reviewerAccount — reviewer is the reporter
    const selfReport = await prisma.report.create({
      data: { reportedByAccountId: reviewerAccount.id, groupId: group.id, subject: "Self", description: "Self-filed" },
    });
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, selfReport.id);
    assert.equal(eligible, false);
    await prisma.report.delete({ where: { id: selfReport.id } });
  } finally {
    await cleanupFixture("cer_reporter");
  }
});

test("isEligibleReviewer returns false when participation is not active", async () => {
  const { group, reviewerAccount, report } = await createFixture("cer_quiet");
  try {
    await prisma.groupMembership.updateMany({
      where: { accountId: reviewerAccount.id, groupId: group.id },
      data: { participationStatus: "quiet" },
    });
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id);
    assert.equal(eligible, false);
  } finally {
    await cleanupFixture("cer_quiet");
  }
});

test("filing an unrelated concern against a reviewer does not disable them globally", async () => {
  const { account, group, reviewerAccount, report } = await createFixture("cer_unrelated");
  try {
    // File a concern against the reviewer (a different concern)
    const unrelatedReport = await prisma.report.create({
      data: { reportedByAccountId: account.id, groupId: group.id, subject: "About reviewer", description: "Unrelated issue" },
    });

    // Reviewer should still be eligible for the original report
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id);
    assert.equal(eligible, true);

    await prisma.report.delete({ where: { id: unrelatedReport.id } });
  } finally {
    await cleanupFixture("cer_unrelated");
  }
});

// --- getCoverageStatus ---

test("getCoverageStatus returns available when eligible reviewer exists", async () => {
  const { group } = await createFixture("ccs_avail");
  try {
    const status = await getCoverageStatus(prisma, group.id);
    assert.equal(status, "available");
  } finally {
    await cleanupFixture("ccs_avail");
  }
});

test("getCoverageStatus returns unavailable when no reviewer assignment exists", async () => {
  const { group, reviewerAccount } = await createFixture("ccs_unavail");
  try {
    // End all assignments for the reviewer to simulate no coverage
    const membership = await prisma.groupMembership.findFirstOrThrow({
      where: { accountId: reviewerAccount.id, groupId: group.id },
      select: { id: true },
    });
    await prisma.responsibilityAssignment.updateMany({
      where: { membershipId: membership.id },
      data: { endedAt: new Date(), endReason: "resigned" },
    });
    const status = await getCoverageStatus(prisma, group.id);
    assert.equal(status, "unavailable");
  } finally {
    await cleanupFixture("ccs_unavail");
  }
});

// --- startReview ---

test("startReview creates ConcernReview and transitions report to under_review", async () => {
  const { group, reviewerAccount, report } = await createFixture("csr_start");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(updated.status, "under_review");

    const review = await prisma.concernReview.findFirst({ where: { reportId: report.id, reviewerId: reviewerAccount.id } });
    assert.ok(review);

    const logs = await prisma.actionLog.findMany({ where: { targetId: report.id, action: "concern.review_started" } });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupFixture("csr_start");
  }
});

test("startReview rejects ineligible reviewer", async () => {
  const { account, group, report } = await createFixture("csr_reject");
  try {
    await assert.rejects(
      () => startReview(prisma, account.id, group.id, report.id),
      /not eligible/,
    );
  } finally {
    await cleanupFixture("csr_reject");
  }
});

// --- issueFindings ---

test("issueFindings creates ConcernFinding and transitions to findings_issued", async () => {
  const { group, reviewerAccount, report } = await createFixture("cif_issue");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "The concern was verified.");

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(updated.status, "findings_issued");

    const finding = await prisma.concernFinding.findFirst({ where: { reportId: report.id, reviewerId: reviewerAccount.id } });
    assert.ok(finding);
    assert.equal(finding?.outcome, "substantiated");

    const logs = await prisma.actionLog.findMany({ where: { targetId: finding!.id, action: "concern.finding_issued" } });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupFixture("cif_issue");
  }
});

test("issueFindings rejects reviewer who has not started a review", async () => {
  const { reviewerAccount, report } = await createFixture("cif_noreview");
  try {
    await assert.rejects(
      () => issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Without starting review first."),
      /no active review/i,
    );
  } finally {
    await cleanupFixture("cif_noreview");
  }
});

// --- proposeAction ---

test("proposeAction creates proposal after substantiated finding", async () => {
  const { group, reviewerAccount, report } = await createFixture("cpa_propose");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Verified.");
    await proposeAction(prisma, reviewerAccount.id, group.id, report.id, "warning", "First warning issued.");

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(updated.status, "action_proposed");

    const proposal = await prisma.concernActionProposal.findFirst({ where: { reportId: report.id } });
    assert.equal(proposal?.proposedAction, "warning");
    assert.equal(proposal?.status, "pending");
    assert.equal(proposal?.iteration, 1);
  } finally {
    await cleanupFixture("cpa_propose");
  }
});

test("proposeAction rejects when no actionable findings exist", async () => {
  const { group, reviewerAccount, report } = await createFixture("cpa_nofinding");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "unsubstantiated", "No issue found.");
    await assert.rejects(
      () => proposeAction(prisma, reviewerAccount.id, group.id, report.id, "warning", "Attempted despite unsubstantiated finding."),
      /actionable/i,
    );
  } finally {
    await cleanupFixture("cpa_nofinding");
  }
});

test("revised proposal supersedes prior rejected proposal", async () => {
  const { group, reviewerAccount, report } = await createFixture("cpa_supersede");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Verified.");
    await proposeAction(prisma, reviewerAccount.id, group.id, report.id, "warning", "First proposal.");

    // Simulate rejection
    await prisma.concernActionProposal.updateMany({ where: { reportId: report.id }, data: { status: "rejected" } });

    // Revised proposal
    await proposeAction(prisma, reviewerAccount.id, group.id, report.id, "responsibility suspension", "Revised after rejection.");

    const proposals = await prisma.concernActionProposal.findMany({ where: { reportId: report.id }, orderBy: { iteration: "asc" } });
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].status, "superseded");
    assert.equal(proposals[1].status, "pending");
    assert.equal(proposals[1].iteration, 2);
  } finally {
    await cleanupFixture("cpa_supersede");
  }
});

// --- closeConcern ---

test("closeConcern closes concern with recorded reason and ActionLog", async () => {
  const { group, reviewerAccount, report } = await createFixture("cc_close");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "unsubstantiated", "No issue.");
    await closeConcern(prisma, reviewerAccount.id, group.id, report.id, "review_complete_no_action");

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(updated.status, "closed");
    assert.equal(updated.closureReason, "review_complete_no_action");
    assert.ok(updated.closedAt);

    const logs = await prisma.actionLog.findMany({ where: { targetId: report.id, action: "concern.closed" } });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupFixture("cc_close");
  }
});

test("closeConcern blocks review_complete_no_action when actionable finding exists", async () => {
  const { group, reviewerAccount, report } = await createFixture("cc_guardrail");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Issue verified.");
    await assert.rejects(
      () => closeConcern(prisma, reviewerAccount.id, group.id, report.id, "review_complete_no_action"),
      /actionable findings/i,
    );
  } finally {
    await cleanupFixture("cc_guardrail");
  }
});

test("closeConcern allows reporter_withdrawal even when actionable finding exists", async () => {
  const { account, group, reviewerAccount, report } = await createFixture("cc_withdraw");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Issue verified.");
    // Reporter (account) withdraws despite actionable finding
    await closeConcern(prisma, account.id, group.id, report.id, "reporter_withdrawal");

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(updated.status, "closed");
    assert.equal(updated.closureReason, "reporter_withdrawal");
  } finally {
    await cleanupFixture("cc_withdraw");
  }
});

test("administrative_closure rejected without reviewer authority", async () => {
  const { account, group, report } = await createFixture("cc_admin_reject");
  try {
    // account is the reporter (no reviewer assignment) — cannot do admin closure
    await assert.rejects(
      () => closeConcern(prisma, account.id, group.id, report.id, "administrative_closure"),
      /reviewer authority/i,
    );
  } finally {
    await cleanupFixture("cc_admin_reject");
  }
});

// --- Cross-group and terminal-state guards ---

test("reviewer from Group A cannot start review on concern from Group B", async () => {
  const { group: groupA, reviewerAccount } = await createFixture("cg_groupa");
  const { report: reportB } = await createFixture("cg_groupb");
  try {
    await assert.rejects(
      () => startReview(prisma, reviewerAccount.id, groupA.id, reportB.id),
      /does not belong to this group/i,
    );
  } finally {
    await cleanupFixture("cg_groupa");
    await cleanupFixture("cg_groupb");
  }
});

test("startReview rejects closed concerns", async () => {
  const { group, reviewerAccount, report } = await createFixture("cg_start_closed");
  try {
    await prisma.report.update({ where: { id: report.id }, data: { status: "closed", closureReason: "review_complete_no_action", closedAt: new Date() } });
    await assert.rejects(
      () => startReview(prisma, reviewerAccount.id, group.id, report.id),
      /closed/i,
    );
  } finally {
    await cleanupFixture("cg_start_closed");
  }
});

test("issueFindings rejects closed concerns", async () => {
  const { group, reviewerAccount, report } = await createFixture("cg_findings_closed");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await prisma.report.update({ where: { id: report.id }, data: { status: "closed", closureReason: "reporter_withdrawal", closedAt: new Date() } });
    await assert.rejects(
      () => issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Post-close attempt."),
      /closed/i,
    );
  } finally {
    await cleanupFixture("cg_findings_closed");
  }
});

test("proposeAction rejects closed concerns", async () => {
  const { group, reviewerAccount, report } = await createFixture("cg_propose_closed");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Verified.");
    await prisma.report.update({ where: { id: report.id }, data: { status: "closed", closureReason: "reporter_withdrawal", closedAt: new Date() } });
    await assert.rejects(
      () => proposeAction(prisma, reviewerAccount.id, group.id, report.id, "warning", "Post-close attempt."),
      /closed/i,
    );
  } finally {
    await cleanupFixture("cg_propose_closed");
  }
});

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });

  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });

  const account = await prisma.account.create({
    data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `Reporter ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const reviewerAccount = await prisma.account.create({
    data: { id: `${prefix}_reviewer`, homeNodeId: node.id, displayName: `Reviewer ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const [, reviewerMembership] = await Promise.all([
    prisma.groupMembership.create({
      data: { accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
    }),
    prisma.groupMembership.create({
      data: { accountId: reviewerAccount.id, groupId: group.id, status: "active", participationStatus: "active" },
    }),
  ]);

  const responsibility = await prisma.responsibility.create({
    data: { groupId: group.id, type: "reviewer" },
  });
  const assignment = await prisma.responsibilityAssignment.create({
    data: {
      responsibilityId: responsibility.id,
      membershipId: reviewerMembership.id,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  const report = await prisma.report.create({
    data: { reportedByAccountId: account.id, groupId: group.id, subject: `Test concern ${prefix}`, description: "Something needs review." },
  });

  return { node, group, account, reviewerAccount, report, responsibility, assignment };
}

async function cleanupFixture(prefix: string) {
  // ActionLog first (FK to Account and Group)
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.actionLog.deleteMany({ where: { actorAccountId: { startsWith: prefix } } });
  await prisma.concernActionProposal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.concernFinding.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.concernReview.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.report.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.responsibilityAssignment.deleteMany({
    where: { membership: { groupId: { startsWith: prefix } } },
  });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
