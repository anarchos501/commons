import Link from "next/link";
import { ArrowLeft, Flag, HandHeart, HelpCircle, Shield, Star, UserPlus } from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { resolveCurrentNode } from "../../../lib/node-context";
import { capitalize } from "../../../lib/support-form";

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

const PLANNED_INTERACTIONS = [
  {
    label: "Request to Join",
    description: "Ask to become a member of this group.",
    icon: UserPlus,
  },
  {
    label: "Offer Contribution",
    description: "Signal that you have something to offer this group.",
    icon: HandHeart,
  },
  {
    label: "Propose Endorsement",
    description: "Formally recognize this group's work.",
    icon: Star,
  },
  {
    label: "Propose Sanction",
    description: "Raise a concern about this group's conduct.",
    icon: Flag,
  },
] as const;

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
          <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Request received</h1>
            </div>
            <p className="mt-4 text-sm leading-7 text-[var(--soft-text)]">
              Your request has been shared with people in the group who may be able to help. Someone will reach out using the contact information you provided.
            </p>
            <div className="mt-4 border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy reminder
              </div>
              <p className="mt-1">Your contact information will not be stored after your request expires or is filled. No account was created.</p>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/request"
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
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Find Groups</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            Groups you can connect with on this node.
          </p>
        </header>

        <AlphaNotice />

        {groups.length === 0 ? (
          <div className="border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--soft-text)]">
            No groups are currently listed on this node.
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {groups.map((group) => (
              <li key={group.id}>
                <div className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  {/* Group info */}
                  <p className="font-semibold text-[var(--text)]">{group.name}</p>
                  {group.description && (
                    <p className="mt-1 text-sm text-[var(--soft-text)]">{group.description}</p>
                  )}
                  {group.serviceOfferings.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {group.serviceOfferings.map((o) => capitalize(o.serviceType)).join(" · ")}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-4 flex flex-col gap-2">
                    {/* Primary: Request Support */}
                    {group.serviceOfferings.length > 0 ? (
                      <Link
                        href={`/request/${group.id}`}
                        className="btn-primary flex items-center justify-between gap-2 bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
                      >
                        <span className="flex items-center gap-2">
                          <HelpCircle className="h-4 w-4" aria-hidden="true" />
                          Request Support
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]">
                        <span className="flex items-center gap-2">
                          <HelpCircle className="h-4 w-4" aria-hidden="true" />
                          Request Support
                        </span>
                        <span className="text-xs">No active services</span>
                      </div>
                    )}

                    {/* Expandable: planned interactions */}
                    <details>
                      <summary className="cursor-pointer list-none px-1 py-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] select-none">
                        More interactions ▸
                      </summary>
                      <div className="mt-2 space-y-px border-t border-[var(--border)] pt-3">
                        {PLANNED_INTERACTIONS.map(({ label, description, icon: Icon }) => (
                          <div
                            key={label}
                            className="flex items-start justify-between gap-3 px-1 py-2"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="text-sm text-[var(--soft-text)]">{label}</p>
                                <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">{description}</p>
                              </div>
                            </div>
                            <span className="shrink-0 border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                              α
                            </span>
                          </div>
                        ))}
                        <p className="pt-2 text-xs leading-5 text-[var(--muted)]">
                          These interactions are planned features. They will allow individuals and groups to build accountability relationships with each other.
                        </p>
                      </div>
                    </details>
                  </div>
                </div>
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
