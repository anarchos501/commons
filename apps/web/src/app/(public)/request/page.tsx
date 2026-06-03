import Link from "next/link";
import { ArrowLeft, HelpCircle, Shield } from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { resolveCurrentNode } from "../../../lib/node-context";
import { capitalize } from "../../../lib/support-form";

function AlphaNotice() {
  return (
    <div
      className="rounded-md border border-[var(--notice-border)] bg-[var(--notice)] px-4 py-3 text-sm text-[var(--notice-text)]"
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

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RequestDiscoveryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Backwards-compatible success confirmation for any links that still point here
  if (params.submitted === "1") {
    return (
      <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
        <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
          <header>
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Home
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
  let groups: Array<{
    id: string;
    name: string;
    description: string | null;
    serviceOfferings: Array<{ serviceType: string }>;
  }> = [];

  try {
    const node = await resolveCurrentNode(prisma);
    if (node) {
      groups = await prisma.group.findMany({
        where: {
          nodeId: node.id,
          serviceOfferings: { some: { status: "active" } },
        },
        include: {
          serviceOfferings: {
            where: { status: "active" },
            select: { serviceType: true },
            orderBy: { serviceType: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
        <header>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Home
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Request support</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            Choose the group you'd like to request help from.
          </p>
        </header>

        <AlphaNotice />

        {groups.length === 0 ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--soft-text)]">
            No groups are currently accepting requests on this node.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/request/${group.id}`}
                  className="block rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--border-strong)] hover:bg-[var(--hover)]"
                >
                  <p className="font-medium text-[var(--text)]">{group.name}</p>
                  {group.description && (
                    <p className="mt-1 text-sm text-[var(--soft-text)]">{group.description}</p>
                  )}
                  {group.serviceOfferings.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {group.serviceOfferings.map((o) => capitalize(o.serviceType)).join(" · ")}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

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
