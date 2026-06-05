import Link from "next/link";
import { ArrowLeft, Flag, HandHeart, HelpCircle, Star, UserPlus } from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import { resolveCurrentNode } from "../../../lib/node-context";
import { capitalize } from "../../../lib/support-form";

export const dynamic = "force-dynamic";

const PLANNED_INTERACTIONS = [
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


export default async function FindGroupsPage() {
  const session = await getSession();
  const accountId = session.accountId ?? null;

  const prisma = createPrismaClient();
  let groups: Array<{
    id: string;
    name: string;
    description: string | null;
    membershipPolicy: string;
    serviceOfferings: Array<{ serviceType: string }>;
  }> = [];
  let myGroupIds = new Set<string>();

  try {
    const node = await resolveCurrentNode(prisma);
    if (node) {
      const [groupRows, memberships] = await Promise.all([
        prisma.group.findMany({
          where: { nodeId: node.id, visibility: "public" },
          select: {
            id: true,
            name: true,
            description: true,
            membershipPolicy: true,
            serviceOfferings: {
              where: { status: "active" },
              select: { serviceType: true },
              orderBy: { serviceType: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        accountId
          ? prisma.groupMembership.findMany({
              where: { accountId, status: "active" },
              select: { groupId: true },
            })
          : Promise.resolve([] as { groupId: string }[]),
      ]);
      groups = groupRows;
      myGroupIds = new Set(memberships.map((m) => m.groupId));
    }
  } finally {
    await prisma.$disconnect();
  }

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          {!accountId && (
            <Link href="/request" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Request Support
            </Link>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <h1 className={`${accountId ? "" : "mt-4 "}text-2xl font-bold tracking-tight`}>Find Groups</h1>
            {accountId && (
              <Link href="/groups/new" className="text-xs font-medium text-[var(--accent)] hover:underline">
                Create Group
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--soft-text)]">Publicly listed groups on this node.</p>
        </header>

        <div>
          {groups.length === 0 ? (
            <div className="border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--soft-text)]">
              No groups are currently publicly listed on this node.
            </div>
          ) : (
            <ul className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
              {groups.map((group) => {
                const isMember = myGroupIds.has(group.id);
                const canJoinDirectly = !isMember && group.membershipPolicy === "open";

                return (
                  <li key={group.id} className="bg-[var(--surface)] p-5 sm:p-6">
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

                    {/* Open button on card for members */}
                    {isMember && (
                      <div className="mt-4">
                        <Link
                          href={`/groups/${group.id}`}
                          className="inline-flex items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
                        >
                          Open Group
                        </Link>
                      </div>
                    )}

                    {/* Interactions dropdown */}
                    <div className="mt-4">
                      <details>
                        <summary className="cursor-pointer list-none px-1 py-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] select-none">
                          Interactions ▸
                        </summary>
                        <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border)] pt-3">

                          {/* Request Support */}
                          {group.serviceOfferings.length > 0 ? (
                            <Link
                              href={`/request/${group.id}`}
                              className="inline-flex items-center gap-2 border border-transparent bg-[var(--accent)] px-4 py-2 text-sm font-medium leading-none text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
                            >
                              <HelpCircle className="h-4 w-4" aria-hidden="true" />
                              Request Support
                            </Link>
                          ) : (
                            <div>
                              <div className="flex items-center gap-2 border border-[var(--border)] bg-[var(--subtle)] px-4 py-2 text-sm font-medium leading-none text-[var(--muted)]">
                                <HelpCircle className="h-4 w-4" aria-hidden="true" />
                                Request Support
                              </div>
                              <p className="mt-1 text-xs leading-4 text-[var(--muted)]">No active services are currently available from this group.</p>
                            </div>
                          )}

                          {/* Request to Join / Apply to Join */}
                          {!isMember && (
                            <Link
                              href={`/groups/${group.id}/join`}
                              className="inline-flex items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium leading-none text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
                            >
                              <UserPlus className="h-4 w-4" aria-hidden="true" />
                              {canJoinDirectly ? "Request to Join" : "Apply to Join"}
                            </Link>
                          )}

                          {/* Planned interactions */}
                          {PLANNED_INTERACTIONS.map(({ label, description, icon: Icon }) => (
                            <div key={label} className="flex items-start justify-between gap-3 px-1 py-2">
                              <div className="flex items-start gap-2 min-w-0">
                                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                                <div className="min-w-0">
                                  <p className="text-sm text-[var(--soft-text)]">{label}</p>
                                  <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">{description}</p>
                                </div>
                              </div>
                              <span className="shrink-0 border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)]">α</span>
                            </div>
                          ))}

                          <p className="pt-1 text-xs leading-5 text-[var(--muted)]">
                            Planned features for building accountability relationships between individuals and groups.
                          </p>
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
