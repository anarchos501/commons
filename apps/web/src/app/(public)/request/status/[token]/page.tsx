import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle, Shield, Trash2, TriangleAlert } from "lucide-react";
import { createPrismaClient } from "../../../../../lib/prisma";
import {
  concernWindowEndsAt,
  deleteSupportRequest,
  fulfillSupportRequest,
  REQUEST_STATUS_LABELS,
  validateGuestAccessToken,
} from "../../../../../lib/request-lifecycle";
import { logAction } from "../../../../../lib/action-log";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GuestRequestStatusPage({ params, searchParams }: PageProps) {
  const { token: rawToken } = await params;
  const resolvedSearch = await searchParams;

  const prisma = createPrismaClient();

  try {
    let validatedResult: Awaited<ReturnType<typeof validateGuestAccessToken>>;
    try {
      validatedResult = await validateGuestAccessToken(prisma, rawToken);
    } catch {
      notFound();
    }

    const { supportRequest, token } = validatedResult;

    const group = await prisma.group.findUnique({
      where: { id: supportRequest.groupId },
      select: { name: true },
    });

    const concernDeadline = concernWindowEndsAt(supportRequest, token);
    const now = new Date();
    const canReportConcern = concernDeadline !== null && concernDeadline > now;

    // Handle form submissions
    if (resolvedSearch.action === "fulfill") {
      async function fulfillAction() {
        "use server";
        const actionPrisma = createPrismaClient();
        try {
          await fulfillSupportRequest(actionPrisma, { supportRequestId: supportRequest.id, rawToken });
        } finally {
          await actionPrisma.$disconnect();
        }
        redirect(`/request/status/${rawToken}?notice=fulfilled`);
      }

      return (
        <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
          <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <header>
              <Link href={`/request/status/${rawToken}`} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </Link>
              <h1 className="mt-4 text-2xl font-semibold">Mark support received?</h1>
              <p className="mt-2 text-sm text-[var(--soft-text)]">This will mark your request as fulfilled and open a 30-day window to report concerns if needed.</p>
            </header>
            <form action={fulfillAction} className="flex flex-col gap-3">
              <button type="submit" className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]">
                Yes, support was received
              </button>
              <Link href={`/request/status/${rawToken}`} className="btn-secondary flex min-h-11 items-center justify-center border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]">
                Cancel
              </Link>
            </form>
          </section>
        </main>
      );
    }

    if (resolvedSearch.action === "delete") {
      async function deleteAction() {
        "use server";
        const actionPrisma = createPrismaClient();
        try {
          await deleteSupportRequest(actionPrisma, { supportRequestId: supportRequest.id, rawToken });
        } finally {
          await actionPrisma.$disconnect();
        }
        redirect(`/request/status/${rawToken}?notice=deleted`);
      }

      return (
        <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
          <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <header>
              <Link href={`/request/status/${rawToken}`} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </Link>
              <h1 className="mt-4 text-2xl font-semibold">Delete this request?</h1>
              <p className="mt-2 text-sm text-[var(--soft-text)]">
                Your request will be removed from all active views immediately. Contact details and descriptions are removed after any accountability period has concluded.
              </p>
            </header>
            <form action={deleteAction} className="flex flex-col gap-3">
              <button type="submit" className="btn-secondary min-h-11 border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]">
                Delete request
              </button>
              <Link href={`/request/status/${rawToken}`} className="btn-primary flex min-h-11 items-center justify-center bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]">
                Keep request
              </Link>
            </form>
          </section>
        </main>
      );
    }

    if (resolvedSearch.action === "concern") {
      if (!canReportConcern) {
        redirect(`/request/status/${rawToken}`);
      }

      async function submitConcernAction(formData: FormData) {
        "use server";
        const subject = formData.get("subject");
        const description = formData.get("description");
        if (typeof subject !== "string" || !subject.trim() || typeof description !== "string" || !description.trim()) {
          redirect(`/request/status/${rawToken}?action=concern&error=1`);
        }
        const actionPrisma = createPrismaClient();
        try {
          // Validate token again inside the action
          const result = await validateGuestAccessToken(actionPrisma, rawToken);
          const report = await actionPrisma.report.create({
            data: {
              reportedByAccountId: null,
              guestAccessTokenId: result.token.id,
              groupId: result.supportRequest.groupId,
              subject: subject.trim(),
              description: description.trim(),
            },
          });
          await logAction(actionPrisma, {
            actorAccountId: null,
            groupId: result.supportRequest.groupId,
            action: "concern.submitted",
            targetType: "report",
            targetId: report.id,
          });
        } finally {
          await actionPrisma.$disconnect();
        }
        redirect(`/request/status/${rawToken}?notice=concern_submitted`);
      }

      return (
        <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
          <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <header>
              <Link href={`/request/status/${rawToken}`} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </Link>
              <h1 className="mt-4 text-2xl font-semibold">Report a concern</h1>
              <p className="mt-2 text-sm text-[var(--soft-text)]">Describe what happened. This will be reviewed by the group&apos;s members. No account is required.</p>
            </header>
            <form action={submitConcernAction} className="flex flex-col gap-4 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <label className="block">
                <span className="field-label">Subject</span>
                <input name="subject" className="field-input" placeholder="Brief description of the issue" required />
              </label>
              <label className="block">
                <span className="field-label">What happened?</span>
                <textarea name="description" className="field-input min-h-28 resize-y" placeholder="Describe the concern in as much or as little detail as you are comfortable sharing." required />
              </label>
              <button type="submit" className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]">
                Submit concern
              </button>
            </form>
          </section>
        </main>
      );
    }

    // Main status view
    const statusLabel = REQUEST_STATUS_LABELS[supportRequest.status] ?? supportRequest.status;
    const isActive = ["open", "routed", "matched"].includes(supportRequest.status);
    const notice = typeof resolvedSearch.notice === "string" ? resolvedSearch.notice : null;

    return (
      <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <header>
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Home
            </Link>
            <h1 className="mt-4 text-2xl font-semibold">{supportRequest.requestType}</h1>
            {group && <p className="mt-1 text-sm text-[var(--muted)]">{group.name}</p>}
          </header>

          {notice === "fulfilled" && (
            <div className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--soft-text)]">
              <CheckCircle className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              Support marked as received. A concern reporting window is now open for 30 days.
            </div>
          )}
          {notice === "deleted" && (
            <div className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--soft-text)]">
              <CheckCircle className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              Request removed from active views.
            </div>
          )}
          {notice === "concern_submitted" && (
            <div className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--soft-text)]">
              <CheckCircle className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              Concern submitted. Group members will review it.
            </div>
          )}

          <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <dl className="flex flex-col gap-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Status</dt>
                <dd className="mt-1 font-medium text-[var(--text)]">{statusLabel}</dd>
              </div>
              {supportRequest.expiresAt && isActive && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Expires</dt>
                  <dd className="mt-1 text-[var(--text)]">{supportRequest.expiresAt.toLocaleDateString()}</dd>
                </div>
              )}
              {supportRequest.accountabilityEndsAt && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Accountability window open until</dt>
                  <dd className="mt-1 text-[var(--text)]">{supportRequest.accountabilityEndsAt.toLocaleDateString()}</dd>
                </div>
              )}
              {concernDeadline && concernDeadline > now && !supportRequest.accountabilityEndsAt && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Concern reporting open until</dt>
                  <dd className="mt-1 text-[var(--text)]">{concernDeadline.toLocaleDateString()}</dd>
                </div>
              )}
            </dl>

            <div className="mt-6 flex flex-col gap-2">
              {supportRequest.status === "matched" && (
                <Link
                  href={`/request/status/${rawToken}?action=fulfill`}
                  className="btn-primary flex min-h-11 items-center justify-center bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]"
                >
                  <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Mark support received
                </Link>
              )}
              {supportRequest.status !== "deleted" && (
                <Link
                  href={`/request/status/${rawToken}?action=delete`}
                  className="btn-secondary flex min-h-11 items-center justify-center border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Delete this request
                </Link>
              )}
              {canReportConcern && (
                <Link
                  href={`/request/status/${rawToken}?action=concern`}
                  className="btn-secondary flex min-h-11 items-center justify-center border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  <TriangleAlert className="mr-2 h-4 w-4" aria-hidden="true" />
                  Report a concern
                </Link>
              )}
            </div>
          </div>

          <div className="border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
            <div className="flex items-center gap-2 font-medium text-[var(--text)]">
              <Shield className="h-4 w-4" aria-hidden="true" />
              About this link
            </div>
            <p className="mt-1">This private link is your temporary access to manage this request. Keep it safe and do not share it. It will stop working after the request lifecycle and any accountability period have concluded.</p>
          </div>
        </section>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}
