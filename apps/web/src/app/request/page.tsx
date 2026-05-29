import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, HelpCircle, Languages, MapPin, Shield } from "lucide-react";
import { createPrismaClient } from "../../lib/prisma";
import { createSupportRequest, routeSupportRequest } from "../../lib/capability-routing";
import { randomUUID } from "crypto";
import { buildRequestDescription, capitalize, trustPreferenceOptions } from "../../lib/support-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GuestRequestPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const submitted = params.submitted === "1";

  if (submitted) {
    return (
      <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
        <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
          <header>
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Northside Commons
            </Link>
          </header>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Request received</h1>
            </div>
            <p className="mt-4 text-sm leading-7 text-[var(--soft-text)]">
              Your request has been shared with people in the group who may be able to help. Someone will reach out using the contact information you provided.
            </p>
            <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy reminder
              </div>
              <p className="mt-1">Your contact information will not be stored after your request expires or is filled. No account was created.</p>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/request"
                className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)]"
              >
                Submit another request
              </Link>
              <Link
                href="/"
                className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)]"
              >
                Back to home
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const prisma = createPrismaClient();
  let serviceOfferings: Array<{ serviceType: string }> = [];
  try {
    serviceOfferings = await prisma.groupServiceOffering.findMany({
      where: { status: "active" },
      distinct: ["serviceType"],
      orderBy: { serviceType: "asc" },
      select: { serviceType: true },
    });
  } finally {
    await prisma.$disconnect();
  }

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
        <header>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Northside Commons
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Request support</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            No account needed. Provide only what is necessary to coordinate help.
          </p>
        </header>

        <form action={submitGuestRequestAction} className="flex flex-col gap-5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <label className="block">
            <span className="field-label">What do you need help with?</span>
            <select name="serviceType" className="field-input" defaultValue={serviceOfferings[0]?.serviceType ?? ""}>
              {serviceOfferings.map((offering) => (
                <option key={offering.serviceType} value={offering.serviceType}>
                  {capitalize(offering.serviceType)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="field-label">Who should help?</span>
            <select name="trustPreference" className="field-input" defaultValue="lightweight">
              {trustPreferenceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">You know best what level of trust you need.</p>
          </label>

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

          <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
            <div className="flex items-center gap-2 font-medium text-[var(--text)]">
              <Shield className="h-4 w-4" aria-hidden="true" />
              Privacy
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>No account is created.</li>
              <li>Your contact note is only shared after someone accepts.</li>
              <li>This request expires after 30 days.</li>
            </ul>
          </div>

          <button
            type="submit"
            className="min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
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
}

async function submitGuestRequestAction(formData: FormData) {
  "use server";

  const serviceType = formData.get("serviceType");
  const contact = formData.get("contact");
  const urgency = formData.get("urgency") as "low" | "normal" | "high" | "urgent" | null;
  const location = formData.get("location");
  const language = formData.get("language");
  const trustPreference = (formData.get("trustPreference") ?? "lightweight") as "lightweight" | "elevated";

  if (typeof serviceType !== "string" || typeof contact !== "string" || !contact.trim()) {
    redirect("/request?error=1");
  }

  const prisma = createPrismaClient();

  try {
    const group = await prisma.group.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

    const description = buildRequestDescription({
      contact: contact.trim(),
      location: location && typeof location === "string" && location.trim() ? location.trim() : undefined,
      language: language && typeof language === "string" && language.trim() ? language.trim() : undefined,
    });

    const request = await createSupportRequest(prisma, {
      guestRequestId: randomUUID(),
      submittedByAccountId: null,
      groupId: group.id,
      requestType: serviceType,
      requestedServices: [{ serviceType, trustRequirement: trustPreference }],
      description,
      urgency: urgency ?? "normal",
      privacyLevel: "private",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await routeSupportRequest(prisma, { supportRequestId: request.id });
  } finally {
    await prisma.$disconnect();
  }

  redirect("/request?submitted=1");
}
