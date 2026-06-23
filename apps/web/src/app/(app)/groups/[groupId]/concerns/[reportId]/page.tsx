import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { isEligibleReviewer } from "../../../../../../lib/concerns";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { startReviewAction, issueFindingsAction, proposeActionAction, closeConcernAction } from "./actions";

export const dynamic = "force-dynamic";

const COMPACT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open", under_review: "Under review", findings_issued: "Findings issued",
  action_proposed: "Action proposed", withdrawn: "Withdrawn by reporter", closed: "Closed",
  resolved: "Resolved", dismissed: "Dismissed",
};
const OUTCOME_LABELS: Record<string, string> = {
  substantiated: "Substantiated", partially_substantiated: "Partially substantiated",
  unsubstantiated: "Unsubstantiated", insufficient_information: "Insufficient information", withdrawn: "Withdrawn",
};
const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending", accepted: "Accepted", rejected: "Rejected", superseded: "Superseded",
};
const FINDING_OUTCOME_OPTIONS = ["substantiated", "partially_substantiated", "unsubstantiated", "insufficient_information", "withdrawn"];
const REVIEWER_CLOSE_REASONS = ["review_complete_no_action", "action_accepted_and_implemented", "action_rejected_no_further_proposal", "administrative_closure"];
const CLOSE_REASON_LABELS: Record<string, string> = {
  review_complete_no_action: "Review complete — no action", action_accepted_and_implemented: "Action accepted and implemented",
  action_rejected_no_further_proposal: "Action rejected — no further proposal", administrative_closure: "Administrative closure",
};

export default async function ConcernDetailPage({ params }: { params: Promise<{ groupId: string; reportId: string }> }) {
  const { groupId, reportId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const accountId = session.accountId;

  const prisma = createPrismaClient();
  try {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: {
        groupId: true, subject: true, description: true, context: true, kind: true, status: true,
        closureReason: true, createdAt: true, withdrawnAt: true, reportedByAccountId: true, subjectAccountId: true,
        reportedBy: { select: { displayName: true } },
        subjectAccount: { select: { displayName: true } },
        supportRequest: { select: { requestType: true, customNeed: true, status: true } },
        group: { select: { name: true } },
      },
    });
    if (!report || report.groupId !== groupId) notFound();

    const isReporter = report.reportedByAccountId === accountId;
    // reporter and eligible reviewer are mutually exclusive for one concern (the reporter is
    // excluded by isEligibleReviewer). Gate = reporter OR eligible reviewer — exactly
    // canViewConcern, computed here so we also get the role for role-differentiated rendering.
    const isReviewer = isReporter ? false : await isEligibleReviewer(prisma, accountId, groupId, reportId);
    if (!isReporter && !isReviewer) notFound();

    const terminal = ["closed", "resolved", "dismissed"].includes(report.status);

    // Reviewer-only packet: the full coordination timeline + whether this reviewer has an active
    // review. The reporter never loads or sees this (don't widen reporter disclosure here).
    let timeline: {
      reviews: { id: string; startedAt: Date; reviewer: { displayName: string } }[];
      findings: { id: string; outcome: string; summary: string; createdAt: Date; reviewer: { displayName: string } }[];
      proposals: { id: string; proposedAction: string; rationale: string; iteration: number; status: string; createdAt: Date; proposedBy: { displayName: string } }[];
    } | null = null;
    let hasActiveReview = false;
    if (isReviewer) {
      const [reviews, findings, proposals, myReview] = await Promise.all([
        prisma.concernReview.findMany({ where: { reportId }, orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true, reviewer: { select: { displayName: true } } } }),
        prisma.concernFinding.findMany({ where: { reportId }, orderBy: { createdAt: "asc" }, select: { id: true, outcome: true, summary: true, createdAt: true, reviewer: { select: { displayName: true } } } }),
        prisma.concernActionProposal.findMany({ where: { reportId }, orderBy: { iteration: "asc" }, select: { id: true, proposedAction: true, rationale: true, iteration: true, status: true, createdAt: true, proposedBy: { select: { displayName: true } } } }),
        prisma.concernReview.findFirst({ where: { reportId, reviewerId: accountId }, select: { id: true } }),
      ]);
      timeline = { reviews, findings, proposals };
      hasActiveReview = !!myReview;
    }

    const reporterName = report.reportedBy?.displayName ?? "A guest (no account)";

    return (
      <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <Link href={`/groups/${groupId}#concerns`} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            {report.group?.name ?? "Back to collective"}
          </Link>

          <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold">{report.subject}</h1>
              <span className="shrink-0 border border-[var(--border)] bg-[var(--subtle)] px-2 py-0.5 text-xs text-[var(--soft-text)]">
                {STATUS_LABELS[report.status] ?? report.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {report.kind === "request_flag" ? "Request flag" : "Person concern"} · raised by {reporterName} ·{" "}
              <LocalTime value={report.createdAt.toISOString()} options={COMPACT} />
            </p>

            {report.subjectAccount?.displayName && (
              <p className="mt-3 text-sm text-[var(--soft-text)]">
                <span className="font-medium text-[var(--text)]">About:</span> {report.subjectAccount.displayName}
              </p>
            )}

            <div className="mt-4">
              <p className="text-xs font-medium text-[var(--muted)]">What happened</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--soft-text)]">{report.description}</p>
            </div>
            {report.context && (
              <div className="mt-4">
                <p className="text-xs font-medium text-[var(--muted)]">Additional context</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--soft-text)]">{report.context}</p>
              </div>
            )}
            {report.kind === "request_flag" && report.supportRequest && (
              <p className="mt-4 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-xs text-[var(--soft-text)]">
                Flagged request: {report.supportRequest.requestType === "custom"
                  ? `Custom${report.supportRequest.customNeed ? ` — ${report.supportRequest.customNeed}` : ""}`
                  : report.supportRequest.requestType}
              </p>
            )}
          </div>

          {/* Reporter view — status + outcome only (no reviewer identities / internal deliberation). */}
          {isReporter && (
            <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <p className="text-sm font-medium text-[var(--text)]">Status of your concern</p>
              <p className="mt-1 text-sm text-[var(--soft-text)]">
                This concern is <span className="font-medium">{(STATUS_LABELS[report.status] ?? report.status).toLowerCase()}</span>
                {report.closureReason ? ` (${(CLOSE_REASON_LABELS[report.closureReason] ?? report.closureReason.replace(/_/g, " "))}).` : "."}
                {" "}Eligible reviewers handle the details; the status will appear here.
              </p>
              {!terminal && report.status !== "withdrawn" && (
                <FormWithNotice action={closeConcernAction} className="mt-4">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="reportId" value={reportId} />
                  <input type="hidden" name="reason" value="reporter_withdrawal" />
                  <SubmitButton variant="secondary">Withdraw this concern</SubmitButton>
                </FormWithNotice>
              )}
            </div>
          )}

          {/* Reviewer view — full coordination packet + actions. */}
          {isReviewer && timeline && (
            <div className="mt-4 space-y-4">
              <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--text)]">Review timeline</p>
                {timeline.reviews.length === 0 && timeline.findings.length === 0 && timeline.proposals.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">No review activity yet.</p>
                ) : (
                  <div className="mt-3 space-y-3 border-l border-[var(--border)] pl-3">
                    {timeline.reviews.map((r) => (
                      <p key={r.id} className="text-xs text-[var(--soft-text)]">
                        <span className="font-medium text-[var(--text)]">{r.reviewer.displayName}</span> started a review ·{" "}
                        <LocalTime value={r.startedAt.toISOString()} options={COMPACT} />
                      </p>
                    ))}
                    {timeline.findings.map((f) => (
                      <div key={f.id} className="text-xs text-[var(--soft-text)]">
                        <span className="font-medium text-[var(--text)]">{f.reviewer.displayName}</span> — finding:{" "}
                        <span className="font-medium">{OUTCOME_LABELS[f.outcome] ?? f.outcome}</span> ·{" "}
                        <LocalTime value={f.createdAt.toISOString()} options={COMPACT} />
                        <p className="mt-0.5 whitespace-pre-wrap leading-5">{f.summary}</p>
                      </div>
                    ))}
                    {timeline.proposals.map((p) => (
                      <div key={p.id} className="text-xs text-[var(--soft-text)]">
                        <span className="font-medium text-[var(--text)]">{p.proposedBy.displayName}</span> proposed an action
                        {" "}(iteration {p.iteration}, {PROPOSAL_STATUS_LABELS[p.status] ?? p.status}) ·{" "}
                        <LocalTime value={p.createdAt.toISOString()} options={COMPACT} />
                        <p className="mt-0.5 whitespace-pre-wrap leading-5">{p.proposedAction}</p>
                        <p className="mt-0.5 whitespace-pre-wrap leading-5 text-[var(--muted)]">Rationale: {p.rationale}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!terminal && (
                <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm space-y-5">
                  <p className="text-sm font-medium text-[var(--text)]">Review actions</p>

                  {!hasActiveReview && (
                    <FormWithNotice action={startReviewAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="reportId" value={reportId} />
                      <p className="mb-2 text-xs text-[var(--soft-text)]">Start a review to record findings on this concern.</p>
                      <SubmitButton variant="secondary">Start review</SubmitButton>
                    </FormWithNotice>
                  )}

                  {hasActiveReview && (
                    <FormWithNotice action={issueFindingsAction} className="space-y-2">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="reportId" value={reportId} />
                      <p className="text-xs font-medium text-[var(--soft-text)]">Issue a finding</p>
                      <select name="outcome" required className="field-input text-sm">
                        {FINDING_OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
                      </select>
                      <textarea name="summary" required rows={3} placeholder="Summary of the finding" className="field-input resize-none" />
                      <SubmitButton variant="secondary">Record finding</SubmitButton>
                    </FormWithNotice>
                  )}

                  <FormWithNotice action={proposeActionAction} className="space-y-2">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="reportId" value={reportId} />
                    <p className="text-xs font-medium text-[var(--soft-text)]">Propose an action <span className="font-normal text-[var(--muted)]">(requires a substantiated finding)</span></p>
                    <textarea name="proposedAction" required rows={2} placeholder="Proposed action" className="field-input resize-none" />
                    <textarea name="rationale" required rows={2} placeholder="Rationale" className="field-input resize-none" />
                    <SubmitButton variant="secondary">Propose action</SubmitButton>
                  </FormWithNotice>

                  <FormWithNotice action={closeConcernAction} className="space-y-2">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="reportId" value={reportId} />
                    <p className="text-xs font-medium text-[var(--soft-text)]">Close the concern</p>
                    <select name="reason" required className="field-input text-sm">
                      {REVIEWER_CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABELS[r]}</option>)}
                    </select>
                    <SubmitButton variant="secondary">Close concern</SubmitButton>
                  </FormWithNotice>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}
