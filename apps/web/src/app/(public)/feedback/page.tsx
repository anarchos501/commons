import Link from "next/link";
import { headers } from "next/headers";
import { AlphaNotice } from "../../../components/shared/Notice";
import { FormWithNotice } from "../../../components/shared/FormWithNotice";
import type { FormState } from "../../../components/shared/form-state";
import { SubmitButton } from "../../../components/shared/SubmitButton";
import { FEEDBACK_TYPES, clientIpCandidate, submitFeedback } from "../../../lib/feedback";
import { resolveCurrentNode } from "../../../lib/node-context";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import { requiredString } from "../../../lib/support-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TYPE_LABELS: Record<(typeof FEEDBACK_TYPES)[number], string> = {
  bug: "Bug",
  ux_confusion: "UX confusion",
  feature_request: "Feature request",
  safety_privacy: "Safety or privacy concern",
};

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const path = safePath(typeof params.path === "string" ? params.path : null);

  return (
    <main className="flex-1 bg-[var(--page)] px-4 py-8 text-[var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link href={path ?? "/"} className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
          Back
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Report feedback</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
          Reports stay on this node until a node host reviews and optionally exports a redacted version.
        </p>
        <div className="mt-5"><AlphaNotice /></div>
        <div className="mt-5 border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--soft-text)]">
          Do not include private personal information unless necessary. Node hosts can see this report.
        </div>
        <FormWithNotice action={submitFeedbackAction} className="mt-5 space-y-4 border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          {path && <input type="hidden" name="path" value={path} />}
          <label className="block">
            <span className="field-label">Type</span>
            <select name="type" required className="field-input">
              {FEEDBACK_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Title</span>
            <input name="title" required maxLength={200} className="field-input" placeholder="A short summary" />
          </label>
          <label className="block">
            <span className="field-label">What happened?</span>
            <textarea name="body" required maxLength={10000} rows={7} className="field-input resize-y" />
          </label>
          <label className="block">
            <span className="field-label">What did you expect?</span>
            <textarea name="expected" maxLength={4000} rows={4} className="field-input resize-y" />
          </label>
          {path && <p className="text-xs text-[var(--muted)]">Page: {path}</p>}
          <SubmitButton>Send feedback</SubmitButton>
        </FormWithNotice>
      </div>
    </main>
  );
}

async function submitFeedbackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const prisma = createPrismaClient();
  try {
    const [node, session, headerList] = await Promise.all([resolveCurrentNode(prisma), getSession(), headers()]);
    if (!node) return { kind: "error", message: "This node is not available." };
    const result = await submitFeedback(prisma, {
      nodeId: node.id,
      accountId: session.accountId || null,
      type: requiredString(formData, "type"),
      title: requiredString(formData, "title"),
      body: requiredString(formData, "body"),
      expected: stringValue(formData, "expected"),
      path: safePath(stringValue(formData, "path")),
      userAgent: headerList.get("user-agent"),
      appVersion: process.env.COMMONS_APP_VERSION ?? "0.1.0",
      ipCandidate: clientIpCandidate({
        forwardedFor: headerList.get("x-forwarded-for"),
        realIp: headerList.get("x-real-ip"),
      }),
    });
    if (!result.ok) {
      return {
        kind: "error",
        message: result.reason === "rate_limited"
          ? "Too many anonymous reports were submitted recently. Please wait and try again."
          : "Please check the report fields and try again.",
      };
    }
    return { kind: "success", message: "Feedback received. Thank you for helping improve Commons." };
  } finally {
    await prisma.$disconnect();
  }
}

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function safePath(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized?.startsWith("/") && !normalized.startsWith("//") ? normalized.slice(0, 1000) : null;
}
