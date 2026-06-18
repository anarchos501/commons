import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlphaNotice } from "../../../../components/shared/Notice";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import type { FormState } from "../../../../components/shared/form-state";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { LocalTime } from "../../../../components/shared/LocalTime";
import {
  FEEDBACK_STATUSES,
  compileFeedbackDigest,
  exportFeedbackToGithub,
  githubFeedbackConfigured,
  listFeedbackDigests,
  updateFeedbackReview,
} from "../../../../lib/feedback";
import { activeNodeHostExists } from "../../../../lib/node-governance";
import { resolveCurrentNode } from "../../../../lib/node-context";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { requiredString } from "../../../../lib/support-form";

export const dynamic = "force-dynamic";

export default async function FeedbackInboxPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const prisma = createPrismaClient();
  try {
    const node = await resolveCurrentNode(prisma);
    if (!node || !(await activeNodeHostExists(prisma, node.id, session.accountId))) redirect("/dashboard");
    const reports = await prisma.feedbackReport.findMany({
      where: { nodeId: node.id, status: { not: "archived" } },
      include: { account: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const digests = await listFeedbackDigests(prisma, node.id);
    const reviewedCount = reports.filter((r) => r.status !== "new").length;
    const exportConfigured = githubFeedbackConfigured();

    return (
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <AlphaNotice />
          <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Node host tools</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--text)]">Feedback Inbox</h1>
            <p className="mt-2 text-sm text-[var(--soft-text)]">
              Preserve the local report, prepare a redacted export draft, and only then submit suitable reports upstream.
            </p>
            <FormWithNotice action={compileAction} className="mt-4">
              <input type="hidden" name="nodeId" value={node.id} />
              <SubmitButton variant="secondary" disabled={reviewedCount === 0}>
                Compile {reviewedCount} reviewed report{reviewedCount === 1 ? "" : "s"} into a document
              </SubmitButton>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Compiling moves reviewed reports into a saved digest (below) and clears them from this inbox. Unreviewed reports stay.
              </p>
            </FormWithNotice>
          </div>

          {digests.length > 0 && (
            <details className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">
                Saved digests ({digests.length})
              </summary>
              <div className="mt-3 space-y-3">
                {digests.map((digest) => (
                  <details key={digest.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <summary className="cursor-pointer text-sm text-[var(--text)]">
                      {digest.title} · <LocalTime value={digest.compiledAt.toISOString()} />
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--soft-text)]">{digest.body}</pre>
                  </details>
                ))}
              </div>
            </details>
          )}
          <div className="mt-4 space-y-4">
            {reports.length === 0 && <EmptyState text="No feedback reports have been submitted." />}
            {reports.map((report) => (
              <article key={report.id} className="border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs capitalize text-[var(--muted)]">{report.type.replaceAll("_", " ")}</p>
                    <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">{report.title}</h2>
                  </div>
                  <span className="text-xs capitalize text-[var(--muted)]">{report.status.replaceAll("_", " ")}</span>
                </div>
                <dl className="mt-3 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2">
                  <div>Submitted by: {report.account?.displayName ?? "Anonymous"}</div>
                  <div>Created: <LocalTime value={report.createdAt.toISOString()} /></div>
                  <div>Page: {report.path ?? "Not provided"}</div>
                  <div>App: {report.appVersion ?? "Not provided"}</div>
                </dl>
                <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-3">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--soft-text)]">{report.body}</p>
                  {report.expected && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--soft-text)]"><strong>Expected:</strong> {report.expected}</p>}
                </div>
                {report.status === "exported_to_github" ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">
                    Exported reports are read-only so the saved review remains consistent with the GitHub issue.
                  </p>
                ) : (
                <FormWithNotice action={saveReviewAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="nodeId" value={node.id} />
                  <input type="hidden" name="reportId" value={report.id} />
                  <label className="block">
                    <span className="field-label">Status</span>
                    <select name="status" defaultValue={report.status} className="field-input">
                      {FEEDBACK_STATUSES.filter((status) => status !== "exported_to_github" && status !== "archived").map((status) => (
                        <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Redacted title</span>
                    <input name="redactedTitle" maxLength={200} defaultValue={report.redactedTitle ?? report.title} className="field-input" />
                  </label>
                  <label className="block">
                    <span className="field-label">Redacted description</span>
                    <textarea name="redactedBody" maxLength={10000} rows={6} defaultValue={report.redactedBody ?? report.body} className="field-input resize-y" />
                  </label>
                  <label className="block">
                    <span className="field-label">Redacted expected behavior</span>
                    <textarea name="redactedExpected" maxLength={4000} rows={3} defaultValue={report.redactedExpected ?? report.expected ?? ""} className="field-input resize-y" />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block"><span className="field-label">Redacted path</span><input name="redactedPath" defaultValue={report.redactedPath ?? report.path ?? ""} className="field-input" /></label>
                    <label className="block"><span className="field-label">Redacted app version</span><input name="redactedAppVersion" defaultValue={report.redactedAppVersion ?? report.appVersion ?? ""} className="field-input" /></label>
                    <label className="block"><span className="field-label">Redacted browser</span><input name="redactedUserAgent" defaultValue={report.redactedUserAgent ?? report.userAgent ?? ""} className="field-input" /></label>
                  </div>
                  <label className="block">
                    <span className="field-label">Node host note</span>
                    <textarea name="hostNotes" maxLength={10000} rows={3} defaultValue={report.hostNotes ?? ""} className="field-input resize-y" />
                  </label>
                  <SubmitButton variant="secondary">Save review</SubmitButton>
                </FormWithNotice>
                )}
                <div className="mt-3">
                  {report.githubIssueUrl ? (
                    <a href={report.githubIssueUrl} target="_blank" rel="noreferrer" className="text-sm text-[var(--accent)] hover:underline">
                      View GitHub issue
                    </a>
                  ) : (
                    <FormWithNotice action={exportAction}>
                      <input type="hidden" name="nodeId" value={node.id} />
                      <input type="hidden" name="reportId" value={report.id} />
                      <SubmitButton variant="secondary" disabled={!exportConfigured}>Create GitHub issue</SubmitButton>
                      {!exportConfigured && <p className="mt-2 text-xs text-[var(--muted)]">GitHub export is not configured.</p>}
                    </FormWithNotice>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function saveReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const prisma = createPrismaClient();
  try {
    await updateFeedbackReview(prisma, {
      nodeId: requiredString(formData, "nodeId"),
      hostAccountId: session.accountId,
      reportId: requiredString(formData, "reportId"),
      status: requiredString(formData, "status"),
      hostNotes: field(formData, "hostNotes"),
      redactedTitle: field(formData, "redactedTitle"),
      redactedBody: field(formData, "redactedBody"),
      redactedExpected: field(formData, "redactedExpected"),
      redactedPath: field(formData, "redactedPath"),
      redactedUserAgent: field(formData, "redactedUserAgent"),
      redactedAppVersion: field(formData, "redactedAppVersion"),
    });
    revalidatePath("/node/feedback");
    return { kind: "success", message: "Review saved." };
  } catch {
    return { kind: "error", message: "The review could not be saved." };
  } finally {
    await prisma.$disconnect();
  }
}

async function compileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const prisma = createPrismaClient();
  try {
    const result = await compileFeedbackDigest(prisma, {
      nodeId: requiredString(formData, "nodeId"),
      hostAccountId: session.accountId,
    });
    revalidatePath("/node/feedback");
    if (!result.ok) return { kind: "error", message: "No reviewed reports to compile." };
    return { kind: "success", message: `Compiled ${result.reportCount} report${result.reportCount === 1 ? "" : "s"} into a digest.` };
  } catch {
    return { kind: "error", message: "The digest could not be compiled." };
  } finally {
    await prisma.$disconnect();
  }
}

async function exportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const prisma = createPrismaClient();
  try {
    const result = await exportFeedbackToGithub(prisma, {
      nodeId: requiredString(formData, "nodeId"),
      hostAccountId: session.accountId,
      reportId: requiredString(formData, "reportId"),
    });
    revalidatePath("/node/feedback");
    return { kind: "success", message: `GitHub issue created: ${result.issueUrl}` };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "GitHub export failed." };
  } finally {
    await prisma.$disconnect();
  }
}

function field(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}
