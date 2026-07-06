import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Shield, Clock, Flag } from "lucide-react";
import { createPrismaClient } from "../../../../../lib/prisma";
import { getSession } from "../../../../../lib/session";
import { requireGroupMembership } from "../../../../../lib/group-membership";
import { submitMemberConcern } from "../../../../../lib/concerns";
import { logContactViewedOnce } from "../../../../../lib/request-access";
import { capitalize, serviceTypeLabel } from "../../../../../lib/support-form";
import { FormWithNotice } from "../../../../../components/shared/FormWithNotice";
import { SubmitButton } from "../../../../../components/shared/SubmitButton";
import { LocalTime } from "../../../../../components/shared/LocalTime";
import type { FormState } from "../../../../../components/shared/form-state";
import type { PrismaClient } from "../../../../../generated/prisma/client";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ routeId: string }> };

/**
 * Single authorization predicate, used by BOTH the render and the report action:
 * the viewer must own the route AND the route must be accepted. Returns null otherwise —
 * callers render/return a generic "not available" message (no not-found vs not-yours leak).
 * Intentionally NOT gated on current group membership: an accepting helper keeps access until
 * the request's redaction window (so an in-flight helper is not stranded).
 */
async function authorizeAcceptedRoute(prisma: PrismaClient, routeId: string, accountId: string) {
  const route = await prisma.requestRoute.findUnique({
    where: { id: routeId },
    include: {
      supportRequest: {
        include: {
          group: { select: { id: true, name: true } },
          services: { where: { serviceType: "category" }, select: { category: { select: { name: true } } }, take: 1 },
        },
      },
    },
  });
  if (!route || route.contributorAccountId !== accountId || route.status !== "accepted") return null;
  return route;
}

export default async function AcceptedRequestPage({ params }: PageProps) {
  const { routeId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const accountId = session.accountId;

  async function fileRequestFlag(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const innerSession = await getSession();
    if (!innerSession.accountId) return { kind: "error", message: "Please sign in." };
    const subject = ((formData.get("subject") as string) ?? "").trim();
    const description = ((formData.get("description") as string) ?? "").trim();
    const context = ((formData.get("context") as string) ?? "").trim() || null;
    if (!subject || !description) return { kind: "error", message: "Please add a subject and a description." };

    const actionPrisma = createPrismaClient();
    try {
      const authz = await authorizeAcceptedRoute(actionPrisma, routeId, innerSession.accountId);
      if (!authz) return { kind: "error", message: "This request is not available to you." };
      await requireGroupMembership(actionPrisma, innerSession.accountId, authz.supportRequest.groupId);
      await submitMemberConcern(actionPrisma, {
        groupId: authz.supportRequest.groupId,
        reportedByAccountId: innerSession.accountId,
        subject,
        description,
        context,
        // A request flag is about the request, never the person — no subject is ever bound here.
        subjectAccountId: null,
        kind: "request_flag",
        supportRequestId: authz.supportRequestId,
      });
    } catch {
      return { kind: "error", message: "Could not submit your report. Please try again." };
    } finally {
      await actionPrisma.$disconnect();
    }
    return { kind: "success", message: "Thanks — your report was sent to the collective's reviewers." };
  }

  const prisma = createPrismaClient();
  try {
    const route = await authorizeAcceptedRoute(prisma, routeId, accountId);

    if (!route) {
      return (
        <Shell>
          <p className="text-sm text-[var(--soft-text)]">This request is not available to you.</p>
        </Shell>
      );
    }

    const req = route.supportRequest;
    const redacted = req.description === "";
    const withdrawn = req.status === "deleted";
    const canReveal = !redacted && !withdrawn;

    if (canReveal) {
      // First-reveal, de-duped: one row per helper per request — never stores the contact itself.
      await logContactViewedOnce(prisma, {
        actorAccountId: accountId,
        groupId: req.groupId,
        supportRequestId: req.id,
        routeId: route.id,
      });
    }

    return (
      <Shell groupName={route.supportRequest.group.name}>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Coordinate this request</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{route.supportRequest.group.name}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className="border border-[var(--border)] bg-[var(--subtle)] px-2 py-0.5">
            {route.serviceType === "custom"
              ? "Custom request"
              : serviceTypeLabel(route.serviceType, route.supportRequest.services[0]?.category?.name)}
          </span>
          <span className="capitalize">Urgency: {capitalize(req.urgency)}</span>
          {route.decidedAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Accepted <LocalTime value={route.decidedAt.toISOString()} />
            </span>
          )}
        </div>

        {route.serviceType === "custom" && req.customNeed && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs font-medium text-[var(--muted)]">What they need</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text)]">{req.customNeed}</p>
          </div>
        )}

        <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Requester contact
          </div>
          {canReveal ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{req.description}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Shared with you because you accepted this request. Coordinate privately; the requester can see that you viewed their contact.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--soft-text)]">
              {withdrawn
                ? "The requester withdrew this request."
                : "Contact details are no longer available — the accountability period has ended."}
            </p>
          )}
        </div>

        {/* Deliberate, non-targeted: a flag about the request, not an accusation about a person.
            Collapsed by default so it is an explicit choice, not a primed button. */}
        <details className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--text)] select-none">
            <Flag className="h-4 w-4" aria-hidden="true" />
            Report a problem with this request
          </summary>
          <p className="mt-2 text-xs leading-5 text-[var(--soft-text)]">
            Flag the request itself (for example: spam, fraudulent, or inappropriate). This goes to your collective&apos;s
            reviewers and is not an accusation about a person. To raise a concern about a specific person, use your
            collective&apos;s{" "}
            <Link href={`/groups/${req.groupId}#concerns`} className="text-[var(--accent)] hover:underline">
              Concerns area
            </Link>
            .
          </p>
          <FormWithNotice action={fileRequestFlag} className="mt-3 space-y-3">
            <label className="block">
              <span className="field-label">Subject</span>
              <input name="subject" required className="field-input" placeholder="Brief description of the problem" />
            </label>
            <label className="block">
              <span className="field-label">What is wrong with this request?</span>
              <textarea name="description" required rows={3} className="field-input resize-y" placeholder="Describe the problem with the request." />
            </label>
            <label className="block">
              <span className="field-label">Additional context (optional)</span>
              <textarea name="context" rows={2} className="field-input resize-y" placeholder="Anything else that helps." />
            </label>
            <SubmitButton variant="secondary">Submit report</SubmitButton>
          </FormWithNotice>
        </details>
      </Shell>
    );
  } finally {
    await prisma.$disconnect();
  }
}

function Shell({ children, groupName }: { children: React.ReactNode; groupName?: string }) {
  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard?myReqView=accepted" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to my requests
        </Link>
        {groupName === undefined ? (
          <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">{children}</div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}
