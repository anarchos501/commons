import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { REQUEST_STATUS_LABELS } from "../../../../../../lib/request-lifecycle";
import type { ReportKind } from "../../../../../../generated/prisma/enums";
import { submitConcernAction } from "./actions";

function ReportKindBadge({ kind }: { kind: ReportKind }) {
  const isFlag = kind === "request_flag";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium ${isFlag ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
      {isFlag ? "Request flag" : "Person concern"}
    </span>
  );
}

export type ConcernsReviewItem = {
  id: string;
  subject: string;
  status: string;
  kind: ReportKind;
  supportRequest: { requestType: string; customNeed: string | null; status: string } | null;
  findings: Array<{ outcome: string }>;
};

export type ConcernsMyReport = {
  id: string;
  subject: string;
  status: string;
  kind: ReportKind;
  closureReason: string | null;
  description: string;
};

export type ConcernsModuleData = {
  coverageStatus: string;
  openConcernCount: number;
  reviewerQueue: ConcernsReviewItem[];
  myReports: ConcernsMyReport[];
  groupMembers: Array<{ id: string; account: { displayName: string } }>;
};

export function ConcernsModule({
  data,
  groupId,
}: {
  data: ConcernsModuleData;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="concerns" title="Concerns" eyebrow="Shared accountability" storageKey={`group:${groupId}:section:concerns`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${data.coverageStatus === "available" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
          Review Coverage: {data.coverageStatus === "available" ? "Available" : "Unavailable"}
        </span>
        {data.openConcernCount > 0 && (
          <span className="text-xs text-[var(--muted)]">
            {data.openConcernCount} active {data.openConcernCount === 1 ? "concern" : "concerns"}
          </span>
        )}
      </div>
      {data.coverageStatus === "unavailable" && (
        <p className="mb-4 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-xs text-[var(--muted)]">
          No active concern reviewers are currently available.
        </p>
      )}
      {data.reviewerQueue.length > 0 && (
        <div className="mb-5 space-y-3">
          <p className="text-xs font-medium text-[var(--muted)]">Reviewer queue</p>
          {data.reviewerQueue.map((concern) => (
            <div key={concern.id} className="space-y-1 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ReportKindBadge kind={concern.kind} />
                  <p className="mt-1 text-sm font-medium">{concern.subject}</p>
                </div>
                <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{concern.status.replace(/_/g, " ")}</span>
              </div>
              {concern.kind === "request_flag" && concern.supportRequest && (
                <p className="text-xs text-[var(--muted)]">
                  Flagged request: {concern.supportRequest.requestType === "custom"
                    ? `Custom${concern.supportRequest.customNeed ? ` — ${concern.supportRequest.customNeed}` : ""}`
                    : concern.supportRequest.requestType} · {(REQUEST_STATUS_LABELS[concern.supportRequest.status] ?? concern.supportRequest.status)}
                </p>
              )}
              {concern.findings.length > 0 && (
                <p className="text-xs text-[var(--muted)]">
                  {concern.findings.length} finding{concern.findings.length !== 1 ? "s" : ""}: {concern.findings.map((f) => f.outcome.replace(/_/g, " ")).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {data.myReports.length > 0 && (
        <div className="mb-5 space-y-3">
          <p className="text-xs font-medium text-[var(--muted)]">Your concerns</p>
          {data.myReports.map((report) => (
            <div key={report.id} className="space-y-1 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ReportKindBadge kind={report.kind} />
                  <p className="mt-1 text-sm font-medium">{report.subject}</p>
                </div>
                <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{report.status.replace(/_/g, " ")}</span>
              </div>
              {report.closureReason && (
                <p className="text-xs text-[var(--muted)]">Closed: {report.closureReason.replace(/_/g, " ")}</p>
              )}
              <p className="text-xs leading-5 text-[var(--soft-text)]">{report.description}</p>
            </div>
          ))}
        </div>
      )}
      <form action={submitConcernAction} className="space-y-4">
        <input type="hidden" name="groupId" value={groupId} />
        <label className="block">
          <span className="field-label">What is the concern about?</span>
          <input name="subject" type="text" required className="field-input" placeholder="A brief subject" />
        </label>
        {data.groupMembers.length > 0 && (
          <label className="block">
            <span className="field-label">Is this concern about a specific member? (optional)</span>
            <select name="subjectMembershipId" className="field-input">
              <option value="">Not about a specific member</option>
              {data.groupMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.account.displayName}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              If named, that member is excluded from reviewing this concern.
            </span>
          </label>
        )}
        <label className="block">
          <span className="field-label">What happened?</span>
          <textarea name="description" required rows={4} className="field-input resize-none" placeholder="Describe what happened or what is concerning." />
        </label>
        <label className="block">
          <span className="field-label">Additional context (optional)</span>
          <textarea name="context" rows={2} className="field-input resize-none" placeholder="Anything else that helps." />
        </label>
        <SubmitButton variant="secondary">Submit concern</SubmitButton>
      </form>
    </CollapsibleSection>
  );
}
