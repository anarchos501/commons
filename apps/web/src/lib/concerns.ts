import type { PrismaClient } from "../generated/prisma/client";
import type { ConcernClosureReason, ConcernFindingOutcome } from "../generated/prisma/enums";
import { logAction } from "./action-log";
import { getResponsibilityCoverage, hasActiveEligibleAssignment } from "./responsibilities";

const ACTIONABLE_OUTCOMES: ConcernFindingOutcome[] = ["substantiated", "partially_substantiated"];

// Closure reasons allowed even when actionable findings exist.
// All other reasons are blocked by the actionable-finding guardrail.
const ALLOWED_WITH_ACTIONABLE_FINDINGS: ConcernClosureReason[] = [
  "action_accepted_and_implemented",
  "action_rejected_no_further_proposal",
  "administrative_closure",
  "reporter_withdrawal",
];

/**
 * Checks all four RFC-002 eligibility conditions for a specific concern.
 * Eligibility is concern-scoped: filing an unrelated concern against a reviewer
 * does not globally disable them.
 */
export async function isEligibleReviewer(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
  reportId: string,
): Promise<boolean> {
  const [membership, report] = await Promise.all([
    prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    }),
    prisma.report.findUnique({
      where: { id: reportId },
      select: { reportedByAccountId: true, groupId: true },
    }),
  ]);

  // Condition 1: Active Participation Status in this group
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    return false;
  }

  // Condition 2: Holds an active eligible reviewer assignment in this group
  const hasReviewer = await hasActiveEligibleAssignment(prisma, membership.id, "reviewer");
  if (!hasReviewer) return false;

  // Condition 3: No direct involvement in this specific concern
  if (!report) return false;
  // Cross-group guard: group/report mismatch is a caller error, not an eligibility failure
  if (report.groupId !== groupId) throw new Error("Concern does not belong to this group.");
  if (report.reportedByAccountId === accountId) return false;
  // Note: subject-of-concern check deferred — subject field not yet defined

  // Condition 4: No active conflict specific to this concern (not global concern history)
  // Future: check linked request/project participation here

  return true;
}

/**
 * Returns whether at least one structurally eligible reviewer exists in a group.
 * Used for coverage indicators. Does not check concern-specific involvement.
 */
export async function getCoverageStatus(
  prisma: PrismaClient,
  groupId: string,
): Promise<"available" | "unavailable"> {
  const coverage = await getResponsibilityCoverage(prisma, groupId, "reviewer");
  return coverage === "covered" ? "available" : "unavailable";
}

/**
 * Marks the beginning of active review by an eligible reviewer.
 * Multiple reviewers may start reviews on the same concern (append-only).
 */
export async function startReview(
  prisma: PrismaClient,
  reviewerId: string,
  groupId: string,
  reportId: string,
): Promise<void> {
  // isEligibleReviewer throws on group/report mismatch; returns false on eligibility failure
  const eligible = await isEligibleReviewer(prisma, reviewerId, groupId, reportId);
  if (!eligible) throw new Error("Reviewer is not eligible to review this concern.");

  // Terminal-state guard: closed concerns are immutable
  const reportState = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  if (reportState?.status === "closed") throw new Error("Concern is closed and cannot be reviewed.");

  const review = await prisma.concernReview.create({
    data: { reportId, reviewerId, groupId },
  });

  await prisma.report.update({
    where: { id: reportId },
    data: { status: "under_review" },
  });

  await logAction(prisma, {
    actorAccountId: reviewerId,
    groupId,
    action: "concern.review_started",
    targetType: "report",
    targetId: reportId,
    metadata: { reviewId: review.id },
  });
}

/**
 * Records a finding for a reviewer who has an active ConcernReview on this concern.
 * Supports multiple findings per concern from different reviewers.
 */
export async function issueFindings(
  prisma: PrismaClient,
  reviewerId: string,
  reportId: string,
  outcome: ConcernFindingOutcome,
  summary: string,
): Promise<void> {
  // Fetch report directly for terminal-state guard (not just via ConcernReview)
  const [review, reportState] = await Promise.all([
    prisma.concernReview.findFirst({ where: { reportId, reviewerId }, select: { id: true, groupId: true } }),
    prisma.report.findUnique({ where: { id: reportId }, select: { status: true } }),
  ]);

  if (!review) {
    throw new Error("Reviewer has no active review for this concern.");
  }
  if (reportState?.status === "closed") throw new Error("Concern is closed and cannot receive new findings.");

  const finding = await prisma.concernFinding.create({
    data: { reportId, reviewerId, groupId: review.groupId, outcome, summary },
  });

  await prisma.report.update({
    where: { id: reportId },
    data: { status: "findings_issued" },
  });

  await logAction(prisma, {
    actorAccountId: reviewerId,
    groupId: review.groupId,
    action: "concern.finding_issued",
    targetType: "concern_finding",
    targetId: finding.id,
    metadata: { outcome },
  });
}

/**
 * Attaches a proposed accountability response. Any eligible reviewer may propose
 * after rejection (prevents deadlock). Prior pending/rejected proposals are marked
 * superseded. Blocked unless actionable findings exist.
 */
export async function proposeAction(
  prisma: PrismaClient,
  proposedById: string,
  groupId: string,
  reportId: string,
  proposedAction: string,
  rationale: string,
): Promise<void> {
  // isEligibleReviewer throws on group/report mismatch
  const eligible = await isEligibleReviewer(prisma, proposedById, groupId, reportId);
  if (!eligible) throw new Error("Proposer is not eligible to propose an action for this concern.");

  // Terminal-state guard: closed concerns are immutable
  const reportState = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  if (reportState?.status === "closed") throw new Error("Concern is closed. No further proposals can be submitted.");

  const actionableFindings = await prisma.concernFinding.count({
    where: { reportId, outcome: { in: ACTIONABLE_OUTCOMES } },
  });

  if (actionableFindings === 0) {
    throw new Error("Action proposals require at least one actionable finding (substantiated or partially substantiated).");
  }

  // Supersede prior proposals
  const priorCount = await prisma.concernActionProposal.count({ where: { reportId } });
  if (priorCount > 0) {
    await prisma.concernActionProposal.updateMany({
      where: { reportId, status: { in: ["pending", "rejected"] } },
      data: { status: "superseded" },
    });
  }

  const proposal = await prisma.concernActionProposal.create({
    data: {
      reportId,
      proposedById,
      groupId,
      proposedAction,
      rationale,
      iteration: priorCount + 1,
    },
  });

  await prisma.report.update({
    where: { id: reportId },
    data: { status: "action_proposed" },
  });

  await logAction(prisma, {
    actorAccountId: proposedById,
    groupId,
    action: "concern.action_proposed",
    targetType: "concern_action_proposal",
    targetId: proposal.id,
  });
}

/**
 * Closes a concern with a recorded reason. Enforces two guardrails:
 * 1. Administrative closure requires reviewer authority (RFC-004).
 * 2. When actionable findings exist, only specific closure reasons are permitted.
 *
 * Note: reporter_withdrawal closes the concern immediately and blocks further
 * review actions. RFC-002's "continued review after withdrawal for safety reasons"
 * is acknowledged but deferred as a future refinement.
 */
export async function closeConcern(
  prisma: PrismaClient,
  actorId: string,
  groupId: string,
  reportId: string,
  reason: ConcernClosureReason,
): Promise<void> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { reportedByAccountId: true, status: true, groupId: true },
  });

  if (!report) throw new Error("Concern not found.");
  if (report.groupId !== groupId) throw new Error("Concern does not belong to this group.");
  if (report.status === "closed") throw new Error("Concern is already closed.");

  // Administrative closure requires reviewer authority (RFC-004)
  if (reason === "administrative_closure") {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: actorId, groupId } },
      select: { id: true },
    });
    const hasReviewer = membership ? await hasActiveEligibleAssignment(prisma, membership.id, "reviewer") : false;
    if (!hasReviewer) {
      throw new Error("Administrative closure requires reviewer authority.");
    }
  } else if (reason === "reporter_withdrawal") {
    // Reporter may close their own concern
    if (report.reportedByAccountId !== actorId) {
      throw new Error("Only the reporter may withdraw a concern.");
    }
  } else {
    // All other closure reasons require reviewer eligibility
    const eligible = await isEligibleReviewer(prisma, actorId, groupId, reportId);
    if (!eligible) throw new Error("Only eligible reviewers may close a concern.");
  }

  // Actionable finding guardrail: positive allowlist when actionable findings exist
  const actionableFindings = await prisma.concernFinding.count({
    where: { reportId, outcome: { in: ACTIONABLE_OUTCOMES } },
  });

  if (actionableFindings > 0 && !ALLOWED_WITH_ACTIONABLE_FINDINGS.includes(reason)) {
    throw new Error(
      `Cannot close with reason "${reason}" when actionable findings exist. ` +
        `Use one of: ${ALLOWED_WITH_ACTIONABLE_FINDINGS.join(", ")}.`,
    );
  }

  await prisma.report.update({
    where: { id: reportId },
    data: { status: "closed", closureReason: reason, closedAt: new Date() },
  });

  await logAction(prisma, {
    actorAccountId: actorId,
    groupId,
    action: "concern.closed",
    targetType: "report",
    targetId: reportId,
    metadata: { reason },
  });
}
