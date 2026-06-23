import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { isEligibleReviewer, canViewConcern, getCoverageStatus, startReview, issueFindings, proposeAction, closeConcern, autoCloseStaleWithdrawnConcerns } from "../lib/concerns";
import { provisionConcernReviewer } from "../lib/concern-reviewer";
import { revokeAbility } from "../lib/responsibility-abilities";

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

test("isEligibleReviewer returns false when the reviewer is the subject of the concern (F3)", async () => {
  const { group, reviewerAccount, report } = await createFixture("cer_subject");
  try {
    // The reviewer is named as the subject of this concern.
    await prisma.report.update({ where: { id: report.id }, data: { subjectAccountId: reviewerAccount.id } });
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id);
    assert.equal(eligible, false);
  } finally {
    await cleanupFixture("cer_subject");
  }
});

test("naming a different member as subject leaves the reviewer eligible (F3)", async () => {
  const { account, group, reviewerAccount, report } = await createFixture("cer_subject_other");
  try {
    // The reporter (not the reviewer) is named as the subject — reviewer remains impartial.
    await prisma.report.update({ where: { id: report.id }, data: { subjectAccountId: account.id } });
    const eligible = await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id);
    assert.equal(eligible, true);
  } finally {
    await cleanupFixture("cer_subject_other");
  }
});

// --- canViewConcern (the concern detail page gate) ---

test("canViewConcern allows the reporter and an eligible reviewer, denies an unrelated member", async () => {
  const { group, account, reviewerAccount } = await createFixture("cvc_basic");
  try {
    const report = await prisma.report.findFirstOrThrow({ where: { groupId: group.id } });
    // Reporter can always view their own concern; eligible reviewer can view.
    assert.equal(await canViewConcern(prisma, account.id, group.id, report.id), true);
    assert.equal(await canViewConcern(prisma, reviewerAccount.id, group.id, report.id), true);
    // An active member who is neither the reporter nor a reviewer cannot view.
    const outsider = await prisma.account.create({
      data: { id: "cvc_basic_outsider", homeNodeId: "cvc_basic_node", displayName: "Outsider", accountType: "member", profileVisibility: "private" },
    });
    await prisma.groupMembership.create({ data: { accountId: outsider.id, groupId: group.id, status: "active", participationStatus: "active" } });
    assert.equal(await canViewConcern(prisma, outsider.id, group.id, report.id), false);
  } finally {
    await cleanupFixture("cvc_basic");
  }
});

test("canViewConcern denies the SUBJECT of the concern even if they hold the reviewer role", async () => {
  const { group, reviewerAccount, report } = await createFixture("cvc_subject");
  try {
    await prisma.report.update({ where: { id: report.id }, data: { subjectAccountId: reviewerAccount.id } });
    assert.equal(await canViewConcern(prisma, reviewerAccount.id, group.id, report.id), false);
  } finally {
    await cleanupFixture("cvc_subject");
  }
});

test("canViewConcern fails closed on a group mismatch", async () => {
  const { account, report } = await createFixture("cvc_mismatch");
  try {
    assert.equal(await canViewConcern(prisma, account.id, "cvc_mismatch_wronggroup", report.id), false);
  } finally {
    await cleanupFixture("cvc_mismatch");
  }
});

test("revoking review_concerns disables review even with an active reviewer seat (F1.1: ability is the source of truth)", async () => {
  const { group, reviewerAccount, report, responsibility } = await createFixture("cer_revoke");
  try {
    // The active reviewer is eligible...
    assert.equal(await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id), true);
    // ...until the group revokes the ability from the reviewer responsibility — the seat persists,
    // but the authority does not. (Behavior is now sourced from the granted ability, not the type.)
    await revokeAbility(prisma, responsibility.id, "review_concerns");
    assert.equal(await isEligibleReviewer(prisma, reviewerAccount.id, group.id, report.id), false);
    await assert.rejects(
      () => startReview(prisma, reviewerAccount.id, group.id, report.id),
      /not eligible/i,
    );
  } finally {
    await cleanupFixture("cer_revoke");
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

test("reporter_withdrawal marks a concern 'withdrawn' (not closed), even with an actionable finding (F4)", async () => {
  const { account, group, reviewerAccount, report } = await createFixture("cc_withdraw");
  try {
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Issue verified.");
    // Reporter (account) withdraws despite actionable finding.
    await closeConcern(prisma, account.id, group.id, report.id, "reporter_withdrawal");

    const updated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    // Withdrawal must NOT extinguish the concern — it is marked withdrawn, not closed.
    assert.equal(updated.status, "withdrawn");
    assert.ok(updated.withdrawnAt);
    assert.equal(updated.closedAt, null);
  } finally {
    await cleanupFixture("cc_withdraw");
  }
});

test("review may continue after reporter withdrawal, and a reviewer can then close (F4)", async () => {
  const { account, group, reviewerAccount, report } = await createFixture("cc_withdraw_continue");
  try {
    // Reporter withdraws before any review.
    await closeConcern(prisma, account.id, group.id, report.id, "reporter_withdrawal");
    let state = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(state.status, "withdrawn");

    // An eligible reviewer determines a live concern remains and continues the review.
    await startReview(prisma, reviewerAccount.id, group.id, report.id);
    await issueFindings(prisma, reviewerAccount.id, report.id, "substantiated", "Safety issue persists.");
    await proposeAction(prisma, reviewerAccount.id, group.id, report.id, "warning", "Document the pattern.");

    // The reviewer can then close the concern through the normal path.
    await closeConcern(prisma, reviewerAccount.id, group.id, report.id, "action_accepted_and_implemented");
    state = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(state.status, "closed");
    assert.equal(state.closureReason, "action_accepted_and_implemented");
  } finally {
    await cleanupFixture("cc_withdraw_continue");
  }
});

test("autoCloseStaleWithdrawnConcerns closes a withdrawn concern left untouched past the cutoff (F4)", async () => {
  const { account, group, report } = await createFixture("cc_withdraw_sweep");
  try {
    await closeConcern(prisma, account.id, group.id, report.id, "reporter_withdrawal");
    // Backdate the withdrawal beyond the auto-close window.
    await prisma.report.update({
      where: { id: report.id },
      data: { withdrawnAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    await autoCloseStaleWithdrawnConcerns(prisma, group.id);

    const swept = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(swept.status, "closed");
    assert.equal(swept.closureReason, "reporter_withdrawal");
  } finally {
    await cleanupFixture("cc_withdraw_sweep");
  }
});

test("autoCloseStaleWithdrawnConcerns leaves a recently-withdrawn concern open for review (F4)", async () => {
  const { account, group, report } = await createFixture("cc_withdraw_recent");
  try {
    await closeConcern(prisma, account.id, group.id, report.id, "reporter_withdrawal");
    // withdrawnAt is "now" — inside the window.
    await autoCloseStaleWithdrawnConcerns(prisma, group.id);

    const state = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(state.status, "withdrawn");
  } finally {
    await cleanupFixture("cc_withdraw_recent");
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

  // Provision the Concern Reviewer responsibility WITH its abilities, exactly as createGroup does —
  // concern actions are now gated on those abilities (F1.1), so the seat alone is not enough.
  await provisionConcernReviewer(prisma, group.id);
  const responsibility = await prisma.responsibility.findUniqueOrThrow({
    where: { groupId_type: { groupId: group.id, type: "reviewer" } },
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
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
