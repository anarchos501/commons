import type { PrismaClient } from "../generated/prisma/client";
import type { ConcernClosureReason, ConcernFindingOutcome, ReportStatus, ReportKind, CoordinationAbility } from "../generated/prisma/enums";
import { logAction } from "./action-log";
import { getResponsibilityCoverage } from "./responsibilities";
import { hasActiveAbilityByType } from "./responsibility-abilities";

const ACTIONABLE_OUTCOMES: ConcernFindingOutcome[] = ["substantiated", "partially_substantiated"];

// A concern in a terminal status is immutable. "withdrawn" is intentionally NOT terminal:
// the reporter has stepped back, but eligible reviewers may continue if a live safety or
// accountability issue remains (RFC-002 — withdrawal must not extinguish the concern).
const TERMINAL_STATUSES: ReportStatus[] = ["closed", "resolved", "dismissed"];

function isTerminal(status: ReportStatus | undefined | null): boolean {
  return status != null && TERMINAL_STATUSES.includes(status);
}

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
      select: { reportedByAccountId: true, subjectAccountId: true, groupId: true },
    }),
  ]);

  // Condition 1: Active Participation Status in this group
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    return false;
  }

  // Condition 2: Holds an active reviewer seat that currently carries the review_concerns ability.
  // Routing through the ability (not just the seat type) makes the granted ability the source of
  // truth — and keeps the authority term-bound and recallable (the check fails the instant the
  // seat ends). Every group's auto-provisioned reviewer role carries this ability, so existing
  // behavior is unchanged.
  const canReview = await hasActiveAbilityByType(prisma, membership.id, "reviewer", "review_concerns");
  if (!canReview) return false;

  // Condition 3: No direct involvement in this specific concern
  if (!report) return false;
  // Cross-group guard: group/report mismatch is a caller error, not an eligibility failure
  if (report.groupId !== groupId) throw new Error("Concern does not belong to this group.");
  if (report.reportedByAccountId === accountId) return false;
  // The subject of a concern cannot review it — no one sits in judgment of a concern about themselves (RFC-002).
  if (report.subjectAccountId === accountId) return false;

  // Condition 4: No active conflict specific to this concern (not global concern history)
  // Future: check linked request/project participation here

  return true;
}

/**
 * Whether `accountId` may VIEW a concern at all (feedback #7). A concern is visible only to
 * the reporter (who raised it) and to eligible reviewers — never to the wider collective or
 * to the concern's subject. The decision is role/identity-derived (reporter + reviewer
 * eligibility), deliberately NOT reading the stored `Report.visibility` flag, which has never
 * been enforced and so cannot be trusted on legacy rows. Returns false for an unknown report
 * or a group mismatch (fail closed).
 */
export async function canViewConcern(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
  reportId: string,
): Promise<boolean> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { reportedByAccountId: true, groupId: true },
  });
  if (!report || report.groupId !== groupId) return false;
  // The reporter can always see the concern they raised.
  if (report.reportedByAccountId === accountId) return true;
  // Otherwise only an eligible reviewer (active seat + not the reporter/subject) may see it.
  return isEligibleReviewer(prisma, accountId, groupId, reportId);
}

/**
 * True when the account currently holds an active reviewer seat in `groupId` that carries
 * `ability` now. Resolves the membership and routes through the term-bound ability check —
 * the per-action accountability gate (issue_findings, issue_action_proposals, etc.).
 */
async function holderHasReviewerAbility(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
  ability: CoordinationAbility,
): Promise<boolean> {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true },
  });
  if (!membership) return false;
  return hasActiveAbilityByType(prisma, membership.id, "reviewer", ability);
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

  // Terminal-state guard: closed concerns are immutable. A withdrawn concern remains reviewable.
  const reportState = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  if (isTerminal(reportState?.status)) throw new Error("Concern is closed and cannot be reviewed.");

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
  if (isTerminal(reportState?.status)) throw new Error("Concern is closed and cannot receive new findings.");
  if (!(await holderHasReviewerAbility(prisma, reviewerId, review.groupId, "issue_findings"))) {
    throw new Error("Issuing findings requires the issue_findings ability on an active reviewer responsibility.");
  }

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

  // Terminal-state guard: closed concerns are immutable. A withdrawn concern remains reviewable.
  const reportState = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  if (isTerminal(reportState?.status)) throw new Error("Concern is closed. No further proposals can be submitted.");
  if (!(await holderHasReviewerAbility(prisma, proposedById, groupId, "issue_action_proposals"))) {
    throw new Error("Proposing an action requires the issue_action_proposals ability on an active reviewer responsibility.");
  }

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
 * Resolves a concern with a recorded reason. Enforces two guardrails:
 * 1. Administrative closure requires reviewer authority (RFC-004).
 * 2. When actionable findings exist, only specific closure reasons are permitted.
 *
 * reporter_withdrawal does NOT close the concern: it marks it "withdrawn" (recording
 * withdrawnAt) so eligible reviewers may continue if a live safety/accountability issue
 * remains (RFC-002). All other reasons close the concern terminally. A withdrawn concern
 * can later be closed by a reviewer, or auto-closed once it has gone untouched (see the sweep).
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
  if (isTerminal(report.status)) throw new Error("Concern is already closed.");
  // A reporter cannot withdraw a concern they have already withdrawn.
  if (reason === "reporter_withdrawal" && report.status === "withdrawn") {
    throw new Error("Concern is already withdrawn.");
  }

  // Administrative closure requires the administrative_closure ability on an active reviewer seat (RFC-004).
  if (reason === "administrative_closure") {
    const canClose = await holderHasReviewerAbility(prisma, actorId, groupId, "administrative_closure");
    if (!canClose) {
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

  if (reason === "reporter_withdrawal") {
    // Withdrawal steps the reporter back without extinguishing the concern.
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "withdrawn", withdrawnAt: new Date() },
    });
  } else {
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "closed", closureReason: reason, closedAt: new Date() },
    });
  }

  await logAction(prisma, {
    actorAccountId: actorId,
    groupId,
    action: reason === "reporter_withdrawal" ? "concern.withdrawn" : "concern.closed",
    targetType: "report",
    targetId: reportId,
    metadata: { reason },
  });
}

const WITHDRAWN_AUTO_CLOSE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lazily closes concerns the reporter withdrew that reviewers have left untouched for
 * WITHDRAWN_AUTO_CLOSE_AFTER_MS. Any reviewer who continues a withdrawn concern moves it out
 * of "withdrawn" status (startReview → under_review), so a row still marked "withdrawn" past
 * the cutoff means no reviewer took it up — realizing RFC-002's "withdrawal normally results
 * in closure" while still allowing continuation in the window. Mirrors archiveStalePetitions.
 */
export async function autoCloseStaleWithdrawnConcerns(
  prisma: PrismaClient,
  groupId: string,
  now: Date = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - WITHDRAWN_AUTO_CLOSE_AFTER_MS);
  await prisma.report.updateMany({
    where: { groupId, status: "withdrawn", withdrawnAt: { lte: cutoff } },
    data: { status: "closed", closureReason: "reporter_withdrawal", closedAt: now },
  });
}

export type SubmitMemberConcernInput = {
  groupId: string;
  reportedByAccountId: string;
  subject: string;
  description: string;
  context?: string | null;
  // Only set for person-targeting concerns (kind person_concern). A request_flag must leave this null.
  subjectAccountId?: string | null;
  kind?: ReportKind;
  supportRequestId?: string | null;
};

/**
 * Creates a member-submitted Report (concern or request flag) and writes the audit log.
 * Intentionally thin: eligibility and subject resolution are the caller's responsibility
 * (they differ per surface). Shared by the group Concerns form and the accepted-request page.
 */
export async function submitMemberConcern(
  prisma: PrismaClient,
  input: SubmitMemberConcernInput,
): Promise<{ id: string }> {
  const report = await prisma.report.create({
    data: {
      groupId: input.groupId,
      reportedByAccountId: input.reportedByAccountId,
      subject: input.subject,
      description: input.description,
      context: input.context ?? null,
      subjectAccountId: input.subjectAccountId ?? null,
      kind: input.kind ?? "person_concern",
      supportRequestId: input.supportRequestId ?? null,
    },
  });
  await logAction(prisma, {
    actorAccountId: input.reportedByAccountId,
    groupId: input.groupId,
    action: "concern.submitted",
    targetType: "report",
    targetId: report.id,
    metadata: { kind: report.kind },
  });
  return { id: report.id };
}
