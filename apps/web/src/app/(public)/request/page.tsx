import Link from "next/link";
import { ArrowLeft, HelpCircle, Key, Shield } from "lucide-react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createPrismaClient } from "../../../lib/prisma";
import { resolveCurrentNode } from "../../../lib/node-context";
import { createSupportRequest, routeSupportRequest } from "../../../lib/capability-routing";
import { buildRequestDescription } from "../../../lib/support-form";
import { generateGuestAccessToken } from "../../../lib/request-lifecycle";
import { AlphaNotice } from "../../../components/shared/Notice";
import { RequestHelpForm } from "../../../components/shared/RequestHelpForm";
import type { GroupOption } from "../../../components/shared/RequestHelpForm";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RequestPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // ── Success state (Type C — centered, wider card) ─────────────────────────
  if (params.submitted === "1") {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get("pending_request_token")?.value ?? null;
    const headersList = await headers();
    const host = headersList.get("host") ?? "";
    const proto = headersList.get("x-forwarded-proto") ?? (host.split(":")[0] === "localhost" ? "http" : "https");
    const privateLink = rawToken ? `${proto}://${host}/request/status/${rawToken}` : null;

    return (
      <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Home
          </Link>
          <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Request received</h1>
            </div>
            <p className="mt-4 text-sm leading-7 text-[var(--soft-text)]">
              Your request has been shared with people in the group who may be able to provide support. Someone will reach out using the contact information you provided.
            </p>
            {privateLink && (
              <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                  <Key className="h-4 w-4" aria-hidden="true" />
                  Your private request link
                </div>
                <a href={privateLink} className="mt-2 block break-all font-mono text-xs text-[var(--accent)] hover:underline">{privateLink}</a>
                <p className="mt-2 text-[var(--soft-text)]">Save this link. You can use it to check status, mark support received, or delete the request — without creating an account.</p>
              </div>
            )}
            <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy reminder
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>No account was created.</li>
                <li>Contact details are removed after your request expires or is fulfilled.</li>
              </ul>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link href="/request" className="btn-secondary flex min-h-11 flex-1 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]">
                Submit another request
              </Link>
              <Link href="/" className="btn-primary flex min-h-11 flex-1 items-center justify-center bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Load groups ───────────────────────────────────────────────────────────
  const prisma = createPrismaClient();
  let groupOptions: GroupOption[] = [];
  let allServices: string[] = [];

  try {
    const node = await resolveCurrentNode(prisma);
    if (node) {
      const groups = await prisma.group.findMany({
        where: { nodeId: node.id },
        include: {
          serviceOfferings: {
            where: { status: "active" },
            select: { serviceType: true },
            orderBy: { serviceType: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const trustedGroups = groups.length > 0
        ? await prisma.trustedProviderStatus.findMany({
            where: { groupId: { in: groups.map((g) => g.id) }, status: "active" },
            select: { groupId: true },
            distinct: ["groupId"],
          })
        : [];
      const trustedGroupIds = new Set(trustedGroups.map((t) => t.groupId));

      groupOptions = groups.map((g) => ({
        groupId: g.id,
        groupName: g.name,
        services: g.serviceOfferings.map((o) => o.serviceType),
        hasTrustedProviders: trustedGroupIds.has(g.id),
      }));

      const serviceSet = new Set<string>();
      for (const g of groups) for (const o of g.serviceOfferings) serviceSet.add(o.serviceType);
      allServices = [...serviceSet].sort();
    }
  } finally {
    await prisma.$disconnect();
  }

  // ── Server action ─────────────────────────────────────────────────────────
  async function submitVisitorRequest(formData: FormData) {
    "use server";

    const serviceType = ((formData.get("serviceType") as string) ?? "").trim();
    const groupId = ((formData.get("groupId") as string) ?? "").trim();
    const contact = ((formData.get("contact") as string) ?? "").trim();
    const trustPreference = ((formData.get("trustPreference") as string) ?? "lightweight") as "lightweight" | "elevated";
    const urgency = ((formData.get("urgency") as string) ?? "normal") as "low" | "normal" | "high" | "urgent";
    const location = ((formData.get("location") as string) ?? "").trim() || undefined;
    const language = ((formData.get("language") as string) ?? "").trim() || undefined;
    const activeDays = Math.min(90, Math.max(3, parseInt((formData.get("activeDays") as string) ?? "30", 10) || 30));

    if (!groupId || !serviceType || !contact) redirect("/request?error=1");

    const actionPrisma = createPrismaClient();
    let rawToken: string | null = null;
    try {
      const [actionNode, actionGroup] = await Promise.all([
        resolveCurrentNode(actionPrisma),
        actionPrisma.group.findUnique({ where: { id: groupId }, select: { id: true, nodeId: true } }),
      ]);
      if (!actionGroup || !actionNode || actionGroup.nodeId !== actionNode.id) redirect("/request");

      const description = buildRequestDescription({ contact, location, language });
      const expiresAt = new Date(Date.now() + activeDays * 24 * 60 * 60 * 1000);

      const request = await createSupportRequest(actionPrisma, {
        guestRequestId: randomUUID(),
        submittedByAccountId: null,
        groupId: actionGroup.id,
        requestType: serviceType,
        requestedServices: [{ serviceType, trustRequirement: trustPreference }],
        description,
        urgency,
        privacyLevel: "private",
        expiresAt,
      });

      rawToken = await generateGuestAccessToken(actionPrisma, request.id, expiresAt);
      await routeSupportRequest(actionPrisma, { supportRequestId: request.id });
    } finally {
      await actionPrisma.$disconnect();
    }

    if (rawToken) {
      (await cookies()).set("pending_request_token", rawToken, {
        httpOnly: true,
        maxAge: 120,
        sameSite: "strict",
        path: "/",
      });
    }
    redirect("/request?submitted=1");
  }

  // ── Form page (Type A — two-column on lg:) ────────────────────────────────
  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Home
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Request support</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            No account needed. Provide only what is necessary to coordinate support.
          </p>
        </header>

        <AlphaNotice />

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Left — form */}
          <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <RequestHelpForm
              groupOptions={groupOptions}
              allServices={allServices}
              action={submitVisitorRequest}
              submitLabel="Send request"
              noGroupsMessage="No groups are currently available on this node."
            />
          </div>

          {/* Right — info panel */}
          <aside className="flex flex-col gap-4">
            <div className="border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--soft-text)]">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                <li>No account is created.</li>
                <li>Your contact note is only shared after someone accepts to provide support.</li>
                <li>You will receive a private link to manage or delete your request at any time.</li>
                <li>Contact details are removed once your request expires or is fulfilled.</li>
              </ul>
            </div>

            <div className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <p className="font-medium text-[var(--text)]">Want to do more?</p>
              <p className="mt-1 text-xs text-[var(--soft-text)]">Create a member account to offer support, participate in group governance, and track your requests.</p>
              <Link
                href="/register"
                className="mt-3 inline-block border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
              >
                Create an account
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
