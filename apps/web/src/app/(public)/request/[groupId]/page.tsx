// NOTE: [groupId] here is an internal CUID — an implementation identifier, not a
// stable public identity. This route shape may change when portable group identity
// is designed. Do not treat the URL segment as the canonical group identity model.

import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, HelpCircle, Key, Languages, MapPin, Shield } from "lucide-react";

function AlphaNotice() {
  return (
    <div
      className="notice-bar px-4 py-3 text-sm text-[var(--notice-text)]"
      role="status"
    >
      <p className="font-medium">Commons Open Alpha</p>
      <div className="mt-0.5">
        Experimental software — not for sensitive real-world use yet.{" "}
        <details className="mt-1">
          <summary className="cursor-pointer underline-offset-2 hover:underline">Alpha limits</summary>
          <div className="mt-2 space-y-1 text-xs leading-5">
            <p>Do not use for medical emergencies, legal emergencies, private organizing, or confidential information.</p>
            <p>Alpha data is plaintext and visible to the server operator. No end-to-end encryption exists yet.</p>
            <p>This version is intended for hypothetical testing, architecture review, and governance feedback.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
import { randomUUID } from "crypto";
import { createPrismaClient } from "../../../../lib/prisma";
import { resolveCurrentNode } from "../../../../lib/node-context";
import { createSupportRequest, routeSupportRequest } from "../../../../lib/capability-routing";
import { buildRequestDescription, capitalize, trustPreferenceOptions } from "../../../../lib/support-form";
import { generateGuestAccessToken } from "../../../../lib/request-lifecycle";
import { getAvailableCategoriesForScope, trustedProviderExistsForCategory } from "../../../../lib/contribution-categories";

export const dynamic = "force-dynamic";

const DURATION_OPTIONS = [
  { value: "3", label: "3 days" },
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

type PageProps = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GroupScopedRequestPage({ params, searchParams }: PageProps) {
  const { groupId } = await params;
  const resolvedSearch = await searchParams;

  const prisma = createPrismaClient();

  try {
    const [node, group] = await Promise.all([
      resolveCurrentNode(prisma),
      prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, nodeId: true },
      }),
    ]);

    if (!group || !node || group.nodeId !== node.id) {
      notFound();
    }

    if (resolvedSearch.submitted === "1") {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get("pending_request_token")?.value ?? null;
      const headersList = await headers();
      const host = headersList.get("host") ?? "";
      const proto = headersList.get("x-forwarded-proto") ?? (host.split(":")[0] === "localhost" ? "http" : "https");
      const privateLink = rawToken ? `${proto}://${host}/request/status/${rawToken}` : null;

      return (
        <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
          <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
            <header>
              <Link href="/request" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                All groups
              </Link>
            </header>
            <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <HelpCircle className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
                <h1 className="text-xl font-semibold">Request received</h1>
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--soft-text)]">
                Your request has been shared with people in {group.name} who may be able to help. Someone will reach out using the contact information you provided.
              </p>

              {privateLink && (
                <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                    <Key className="h-4 w-4" aria-hidden="true" />
                    Your private request link
                  </div>
                  <a href={privateLink} className="mt-2 block break-all font-mono text-xs text-[var(--accent)] hover:underline">{privateLink}</a>
                  <p className="mt-2 text-[var(--soft-text)]">Save this link. You can use it to check status, mark help received, delete the request, or report a concern — without creating an account.</p>
                </div>
              )}

              <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
                <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Privacy reminder
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>No account was created.</li>
                  <li>Your request will only be shared with {group.name}.</li>
                  <li>Contact details are removed after your request expires or is fulfilled.</li>
                </ul>
              </div>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/request/${groupId}`}
                  className="btn-secondary flex min-h-11 flex-1 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  Submit another request
                </Link>
                <Link
                  href="/"
                  className="btn-primary flex min-h-11 flex-1 items-center justify-center bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]"
                >
                  Back to home
                </Link>
              </div>
            </div>
          </section>
        </main>
      );
    }

    const [serviceOfferings, rawCategories] = await Promise.all([
      prisma.groupServiceOffering.findMany({
        where: { groupId: group.id, status: "active" },
        select: { serviceType: true },
        orderBy: { serviceType: "asc" },
      }),
      getAvailableCategoriesForScope(prisma, { groupId: group.id }),
    ]);

    // Pre-compute trusted provider existence per category for the trust preference picker
    const categories = await Promise.all(
      rawCategories.map(async (cat) => ({
        ...cat,
        hasTrustedProviders: await trustedProviderExistsForCategory(prisma, { categoryId: cat.id, groupId: group.id }),
      })),
    );
    const anyTrustedProviders = categories.some((c) => c.hasTrustedProviders);

    async function submitGroupScopedRequest(formData: FormData) {
      "use server";

      const serviceType = formData.get("serviceType") as string | null;
      const categoryId = formData.get("categoryId") as string | null;
      const contact = formData.get("contact");
      const urgency = formData.get("urgency") as "low" | "normal" | "high" | "urgent" | null;
      const location = formData.get("location");
      const language = formData.get("language");
      const trustPreference = (formData.get("trustPreference") ?? "lightweight") as "lightweight" | "elevated";
      const activeDays = Math.min(90, Math.max(3, parseInt((formData.get("activeDays") as string) ?? "30", 10) || 30));

      // Either a category or a legacy service type must be provided
      const selectedCategoryId = categoryId?.trim() || null;
      const selectedServiceType = serviceType?.trim() || "";
      const resolvedServiceType = selectedCategoryId ? "category" : selectedServiceType;
      if (!resolvedServiceType) {
        redirect(`/request/${groupId}?error=1`);
      }
      if (typeof contact !== "string" || !contact.trim()) {
        redirect(`/request/${groupId}?error=1`);
      }

      const actionPrisma = createPrismaClient();
      let rawToken: string | null = null;
      try {
        // groupId is closed over from page params — not user-controllable.
        // Re-validate node ownership inside the action as defense in depth.
        const [actionNode, actionGroup] = await Promise.all([
          resolveCurrentNode(actionPrisma),
          actionPrisma.group.findUnique({ where: { id: groupId }, select: { id: true, nodeId: true } }),
        ]);

        if (!actionGroup || !actionNode || actionGroup.nodeId !== actionNode.id) {
          redirect("/request");
        }

        const description = buildRequestDescription({
          contact: contact.trim(),
          location: location && typeof location === "string" && location.trim() ? location.trim() : undefined,
          language: language && typeof language === "string" && language.trim() ? language.trim() : undefined,
        });

        const expiresAt = new Date(Date.now() + activeDays * 24 * 60 * 60 * 1000);

        const request = await createSupportRequest(actionPrisma, {
          guestRequestId: randomUUID(),
          submittedByAccountId: null,
          groupId: actionGroup.id,
          requestType: resolvedServiceType,
          requestedServices: [{
            serviceType: resolvedServiceType,
            categoryId: selectedCategoryId ?? undefined,
            trustRequirement: trustPreference,
          }],
          description,
          urgency: urgency ?? "normal",
          privacyLevel: "private",
          expiresAt,
        });

        rawToken = await generateGuestAccessToken(actionPrisma, request.id, expiresAt);
        await routeSupportRequest(actionPrisma, { supportRequestId: request.id });
      } finally {
        await actionPrisma.$disconnect();
      }

      // Pass the raw token via a short-lived cookie so it never appears in the URL.
      if (rawToken) {
        (await cookies()).set("pending_request_token", rawToken, {
          httpOnly: true,
          maxAge: 120,
          sameSite: "strict",
          path: "/",
        });
      }
      redirect(`/request/${groupId}?submitted=1`);
    }

    return (
      <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
        <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
          <header>
            <Link href="/request" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              All groups
            </Link>
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Request support</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{group.name}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
              No account needed. Provide only what is necessary to coordinate help.
            </p>
          </header>

          <AlphaNotice />

          <form action={submitGroupScopedRequest} className="flex flex-col gap-5 border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="block">
              <span className="field-label">What do you need help with?</span>
              {categories.length > 0 ? (
                <>
                  <select name="categoryId" className="field-input">
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id} data-has-trusted={cat.hasTrustedProviders ? "1" : "0"}>
                        {cat.name}
                        {cat.offeringEntityName ? ` — ${
                          cat.offeringEntityType === "group" ? cat.offeringEntityName
                          : cat.offeringEntityType === "project" ? `Project: ${cat.offeringEntityName}`
                          : `Responsibility: ${cat.offeringEntityName}`
                        }` : ""}
                      </option>
                    ))}
                  </select>
                  <input type="hidden" name="serviceType" value="" />
                </>
              ) : (
                <>
                  <select name="serviceType" className="field-input" defaultValue={serviceOfferings[0]?.serviceType ?? ""}>
                    {serviceOfferings.map((offering) => (
                      <option key={offering.serviceType} value={offering.serviceType}>
                        {capitalize(offering.serviceType)}
                      </option>
                    ))}
                  </select>
                  <input type="hidden" name="categoryId" value="" />
                </>
              )}
            </div>

            {anyTrustedProviders && (
              <label className="block">
                <span className="field-label">Who should help?</span>
                <select name="trustPreference" className="field-input" defaultValue="lightweight">
                  {trustPreferenceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Trusted providers have been recognized by {group.name}. You decide whether that matters.
                </p>
              </label>
            )}

            <label className="block">
              <span className="field-label">Safe contact note</span>
              <input
                name="contact"
                className="field-input"
                placeholder="Phone, email, or a safe way to reach you"
                aria-describedby="contact-help"
                required
              />
              <p id="contact-help" className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Only shared after someone agrees to help. Not stored after your request expires.
              </p>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">How soon?</span>
                <select name="urgency" className="field-input" defaultValue="normal">
                  <option value="low">Whenever someone can</option>
                  <option value="normal">Soon</option>
                  <option value="high">Today if possible</option>
                  <option value="urgent">Time-sensitive</option>
                </select>
              </label>
              <label className="block">
                <span className="field-label inline-flex items-center gap-1">
                  <Languages className="h-4 w-4" aria-hidden="true" />
                  Language
                </span>
                <input name="language" className="field-input" placeholder="Optional" />
              </label>
            </div>

            <label className="block">
              <span className="field-label inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                General area
              </span>
              <input name="location" className="field-input" placeholder="Neighborhood or nearby area (optional)" />
            </label>

            <label className="block">
              <span className="field-label">How long should this request stay active?</span>
              <select name="activeDays" className="field-input" defaultValue="30">
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">Requests expire automatically. You can also delete yours at any time using your private link.</p>
            </label>

            <div className="border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>No account is created.</li>
                <li>Your request will only be shared with {group.name}.</li>
                <li>Your contact note is only shared after someone accepts.</li>
                <li>You will receive a private link to manage or delete this request.</li>
              </ul>
            </div>

            <button
              type="submit"
              className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
            >
              Send request
            </button>
          </form>

          <p className="text-center text-sm text-[var(--muted)]">
            Want to offer help or participate in governance?{" "}
            <Link href="/register" className="font-medium text-[var(--accent)] hover:underline">
              Create a member account
            </Link>
            .
          </p>
        </section>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}
