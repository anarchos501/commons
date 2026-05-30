import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Check,
  Clock,
  FolderOpen,
  HandHeart,
  HeartHandshake,
  HelpCircle,
  Inbox,
  Languages,
  LogOut,
  MapPin,
  Shield,
  X,
} from "lucide-react";
import { createPrismaClient } from "../../lib/prisma";
import { getSession } from "../../lib/session";
import {
  createContributionFromAcceptedRoute,
  createSupportRequest,
  decideRequestRoute,
  declareServiceCapability,
  routeSupportRequest,
} from "../../lib/capability-routing";
import { joinOpenGroup, leaveGroup, requireGroupMembership } from "../../lib/group-membership";
import { buildRequestDescription, capitalize, optionalString, requiredString, trustPreferenceOptions } from "../../lib/support-form";
import { deleteSupportRequest, fulfillSupportRequest, REQUEST_STATUS_LABELS } from "../../lib/request-lifecycle";
import { logAction } from "../../lib/action-log";
import { applyParticipationTransitions, recordGroupPresence } from "../../lib/participation";

export const dynamic = "force-dynamic";

const availabilityOptions = [
  {
    value: "available",
    label: "Available",
    description: "It is okay to route matching requests to me.",
  },
  {
    value: "limited",
    label: "Limited",
    description: "I may be able to help, but keep expectations light.",
  },
  {
    value: "time-sensitive-capable",
    label: "Time-sensitive capable",
    description: "I can sometimes help when timing matters, with no obligation implied.",
  },
  {
    value: "unavailable",
    label: "Unavailable",
    description: "Do not route new requests to me right now.",
  },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();

  if (!session.accountId) {
    redirect("/login");
  }

  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const data = await getDashboardData(session.accountId, session.activeGroupId ?? null);

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-[var(--muted)]">Northside Commons</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--text)] sm:text-4xl">
                Ask for help. Offer help. Keep it human.
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--soft-text)]">
                Commons helps a group connect needs with people who can help, without turning private hardship into public history.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:w-72">
              <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--soft-text)]">
                <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Privacy first
                </div>
                <p className="mt-2">Help requests are shared only for coordination. Contribution summaries do not name who received help.</p>
              </div>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--soft-text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out ({data.account.displayName})
                </button>
              </form>
            </div>
          </div>
          <nav aria-label="Primary actions" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <JumpLink href="#request" icon={<HelpCircle className="h-4 w-4" />}>
              Request Help
            </JumpLink>
            <JumpLink href="#offer" icon={<HandHeart className="h-4 w-4" />}>
              Offer Help
            </JumpLink>
            <JumpLink href="#groups" icon={<HeartHandshake className="h-4 w-4" />}>
              My Groups
            </JumpLink>
            {data.group ? (
              <JumpLink href="#projects" icon={<FolderOpen className="h-4 w-4" />}>
                Projects
              </JumpLink>
            ) : null}
            <JumpLink href="#routes" icon={<Inbox className="h-4 w-4" />}>
              Notifications
            </JumpLink>
          </nav>
        </header>

        {notice ? <Notice message={notice} /> : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.82fr)]">
          <div className="flex flex-col gap-6">
            <Section id="request" title="Request Help" eyebrow="Ask only what is needed">
              <form action={requestHelpAction} className="space-y-5">
                {data.serviceOfferings.length === 0 ? (
                  <EmptyState text="No services are currently available on this node. Check back later." />
                ) : null}
                <label className="block">
                  <span className="field-label">What do you need help with?</span>
                  <select name="serviceType" className="field-input" defaultValue={data.serviceOfferings[0]?.serviceType ?? ""}>
                    {data.serviceOfferings.map((offering) => (
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
                  <p className="mt-1 text-xs text-[var(--muted)]">You know best what level of trust you need. The group may also require a minimum for certain services.</p>
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
                    This is kept inside the private request record and is only for coordination after someone accepts.
                  </p>
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
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
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      General area
                    </span>
                    <input name="location" className="field-input" placeholder="Neighborhood or nearby area" />
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
                  <span className="field-label">How long should this request stay active?</span>
                  <select name="activeDays" className="field-input" defaultValue="30">
                    <option value="3">3 days</option>
                    <option value="7">1 week</option>
                    <option value="14">2 weeks</option>
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                  </select>
                  <p className="mt-1 text-xs text-[var(--muted)]">Requests expire automatically. You can also close yours from My Requests at any time.</p>
                </label>
                <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
                  <p className="font-medium text-[var(--text)]">Privacy check</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Your request is not posted as a public feed.</li>
                    <li>Only the minimum matching details are routed before someone accepts.</li>
                    <li>Requests expire automatically. Contact details are removed after any accountability period has concluded.</li>
                  </ul>
                </div>
                <SubmitButton disabled={data.serviceOfferings.length === 0}>Ask for help</SubmitButton>
              </form>
            </Section>

            <Section id="offer" title="Offer Help" eyebrow="Set your own boundaries">
              <form action={offerHelpAction} className="space-y-5">
                <p className="text-sm leading-6 text-[var(--soft-text)]">
                  Offering as <strong className="font-medium text-[var(--text)]">{data.account.displayName}</strong>. Choose only what feels realistic right now. This is private coordination information, not a promise or public status.
                </p>
                <fieldset>
                  <legend className="field-label">What can you help with?</legend>
                  <p className="text-sm leading-6 text-[var(--muted)]">Pick at least one.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {data.serviceOfferings.map((offering) => (
                      <label key={offering.serviceType} className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                        <input name="services" type="checkbox" value={offering.serviceType} className="h-4 w-4 accent-[#496b5d]" />
                        <span>{capitalize(offering.serviceType)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="field-label">Availability boundary</span>
                  <select name="availabilityPreference" className="field-input" defaultValue="available">
                    {availabilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2">
                  {availabilityOptions.map((option) => (
                    <p key={option.value} className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-sm leading-6 text-[var(--soft-text)]">
                      <strong className="font-medium text-[var(--text)]">{option.label}:</strong> {option.description}
                    </p>
                  ))}
                </div>
                <SubmitButton>Save what I can offer</SubmitButton>
              </form>
            </Section>
          </div>

          <aside className="flex flex-col gap-6">
            <Section id="groups" title="My Group" eyebrow="Where this is happening">
              {data.group ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">{data.group.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">{data.group.description}</p>
                  </div>
                  {data.memberships.length > 1 ? (
                    <div className="space-y-2 border-t border-[var(--border)] pt-4">
                      <p className="text-xs font-medium text-[var(--muted)]">Your groups</p>
                      {data.memberships.map((m) => {
                        const isActive = m.groupId === data.group!.id;
                        return (
                          <div
                            key={m.groupId}
                            className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{m.group.name}</p>
                              {m.group.description ? (
                                <p className="text-xs text-[var(--muted)]">{m.group.description}</p>
                              ) : null}
                            </div>
                            {isActive ? (
                              <span className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium text-[var(--soft-text)]">
                                Active
                              </span>
                            ) : (
                              <form action={switchGroupAction} className="shrink-0">
                                <input type="hidden" name="groupId" value={m.groupId} />
                                <SubmitButton variant="secondary">Switch</SubmitButton>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="border-t border-[var(--border)] pt-4">
                    <form action={leaveGroupAction}>
                      <input type="hidden" name="groupId" value={data.group.id} />
                      <button
                        type="submit"
                        className="text-xs text-[var(--muted)] transition hover:text-[var(--soft-text)]"
                      >
                        Leave {data.group.name}
                      </button>
                    </form>
                  </div>
                  {data.openGroups.length > 0 ? (
                    <div className="space-y-2 border-t border-[var(--border)] pt-4">
                      <p className="text-xs font-medium text-[var(--muted)]">Other open groups</p>
                      {data.openGroups.map((g) => (
                        <form key={g.id} action={joinGroupAction}>
                          <input type="hidden" name="groupId" value={g.id} />
                          <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3">
                            <p className="text-sm font-medium">{g.name}</p>
                            {g.description ? (
                              <p className="mt-1 text-xs text-[var(--muted)]">{g.description}</p>
                            ) : null}
                            <div className="mt-3">
                              <SubmitButton variant="secondary">Join {g.name}</SubmitButton>
                            </div>
                          </div>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : data.openGroups.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-[var(--soft-text)]">
                    You are not yet a member of any group. You can join an open group below.
                  </p>
                  {data.openGroups.map((g) => (
                    <form key={g.id} action={joinGroupAction}>
                      <input type="hidden" name="groupId" value={g.id} />
                      <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3">
                        <p className="text-sm font-medium">{g.name}</p>
                        {g.description ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">{g.description}</p>
                        ) : null}
                        <div className="mt-3">
                          <SubmitButton variant="secondary">Join {g.name}</SubmitButton>
                        </div>
                      </div>
                    </form>
                  ))}
                </div>
              ) : (
                <EmptyState text="You are not yet a member of any group. No open groups are currently available." />
              )}
            </Section>

            {data.group ? (
            <Section id="projects" title="Projects" eyebrow="Active coordination">
              {data.projects.length > 0 ? (
                <div className="grid gap-2">
                  {data.projects.map((project) => (
                    <div key={project.id} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{project.name}</p>
                        <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{project.status}</span>
                      </div>
                      {project.description ? (
                        <p className="text-xs leading-5 text-[var(--muted)]">{project.description}</p>
                      ) : null}
                      {project.services.length > 0 ? (
                        <p className="text-xs text-[var(--muted)]">{project.services.map(capitalize).join(" · ")}</p>
                      ) : null}
                      {project.contributions.length > 0 ? (
                        <div className="space-y-1 border-t border-[var(--border)] pt-2">
                          {project.contributions.map((c) => (
                            <div key={c.type} className="flex items-center justify-between">
                              <span className="text-xs capitalize text-[var(--soft-text)]">{c.type}</span>
                              <span className="text-xs text-[var(--muted)]">{c.count} logged</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No active projects in this group yet." />
              )}
            </Section>
            ) : null}

            <Section id="routes" title="Requests You Can Help With" eyebrow="Private matching">
              <form action={routeOpenRequestsAction} className="mb-4">
                <SubmitButton variant="secondary" disabled={!data.group}>Check for matching requests</SubmitButton>
              </form>
              <div className="space-y-3">
                {data.routes.length > 0 ? (
                  data.routes.map((route) => <RouteCard key={route.id} route={route} />)
                ) : (
                  <EmptyState text="No matching requests yet. When one appears, it will show only what you need to decide." />
                )}
              </div>
            </Section>

            {data.group ? (
            <Section id="summary" title="Help Given" eyebrow="Private people, shared memory">
              {data.groupContributions.length > 0 ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--muted)]">{data.group.name}</p>
                    <div className="space-y-2">
                      {data.groupContributions.map((item) => (
                        <div key={item.type} className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                          <span className="text-sm font-medium capitalize">{item.type}</span>
                          <span className="text-sm text-[var(--soft-text)]">{item.count} logged</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {data.personalContributions.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs font-medium text-[var(--muted)]">Your contributions</p>
                      <div className="space-y-2">
                        {data.personalContributions.map((item) => (
                          <div key={item.type} className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                            <span className="text-sm font-medium capitalize">{item.type}</span>
                            <span className="text-sm text-[var(--soft-text)]">{item.count} logged</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="When help is finished, it can be remembered here without naming who received it." />
              )}
            </Section>
            ) : null}

            {data.group ? (
            <>
            <Section id="my-requests" title="My Requests" eyebrow="Requests you submitted">
              {data.myRequests.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No active requests.</p>
              ) : (
                <ul className="space-y-3">
                  {data.myRequests.map((request) => {
                    const statusLabel = REQUEST_STATUS_LABELS[request.status] ?? request.status;
                    const isActive = ["open", "routed", "matched"].includes(request.status);

                    async function fulfillMyRequest() {
                      "use server";
                      const s = await getSession();
                      if (!s.accountId) redirect("/login");
                      const p = createPrismaClient();
                      try { await fulfillSupportRequest(p, { supportRequestId: request.id, actorAccountId: s.accountId }); }
                      finally { await p.$disconnect(); }
                      revalidatePath("/dashboard");
                    }

                    async function deleteMyRequest() {
                      "use server";
                      const s = await getSession();
                      if (!s.accountId) redirect("/login");
                      const p = createPrismaClient();
                      try { await deleteSupportRequest(p, { supportRequestId: request.id, actorAccountId: s.accountId }); }
                      finally { await p.$disconnect(); }
                      revalidatePath("/dashboard");
                    }

                    return (
                      <li key={request.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium capitalize">{request.requestType}</p>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{statusLabel}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Submitted {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(request.createdAt)}
                          {request.expiresAt && isActive ? ` · Expires ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(request.expiresAt)}` : ""}
                          {request.accountabilityEndsAt ? ` · Accountability open until ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(request.accountabilityEndsAt)}` : ""}
                        </p>
                        {(isActive || request.status !== "deleted") && (
                          <div className="mt-2 flex gap-2">
                            {request.status === "matched" && (
                              <form action={fulfillMyRequest}>
                                <button type="submit" className="text-xs font-medium text-[var(--accent)] hover:underline">
                                  Mark help received
                                </button>
                              </form>
                            )}
                            {request.status !== "fulfilled" && request.status !== "expired" && (
                              <form action={deleteMyRequest}>
                                <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline">
                                  Delete
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-[var(--muted)]">
                Deleting a request removes it from active views. Contact details and descriptions are removed after any accountability period has concluded.
              </p>
            </Section>

            <Section id="concerns" title="Concerns" eyebrow="Shared accountability">
              {data.groupOpenConcernCount > 0 ? (
                <p className="mb-4 text-sm leading-6 text-[var(--soft-text)]">
                  {data.groupOpenConcernCount} open concern{data.groupOpenConcernCount !== 1 ? "s" : ""} in this group.
                </p>
              ) : null}
              {data.myReports.length > 0 ? (
                <div className="mb-5 space-y-3">
                  <p className="text-xs font-medium text-[var(--muted)]">Your concerns</p>
                  {data.myReports.map((report) => (
                    <div key={report.id} className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{report.subject}</p>
                        <span className="shrink-0 text-xs capitalize text-[var(--muted)]">
                          {report.status.replace("_", " ")}
                        </span>
                      </div>
                      {report.context ? (
                        <p className="text-xs text-[var(--muted)]">{report.context}</p>
                      ) : null}
                      <p className="text-xs leading-5 text-[var(--soft-text)]">{report.description}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              <form action={submitConcernAction} className="space-y-4">
                <label className="block">
                  <span className="field-label">What is the concern about?</span>
                  <input name="subject" type="text" required className="field-input" placeholder="A brief subject" />
                </label>
                <label className="block">
                  <span className="field-label">What happened?</span>
                  <textarea name="description" required rows={4} className="field-input resize-none" placeholder="Describe what happened or what is concerning." />
                </label>
                <label className="block">
                  <span className="field-label">Additional context (optional)</span>
                  <textarea name="context" rows={2} className="field-input resize-none" placeholder="Anything else that helps." />
                </label>
                <SubmitButton variant="secondary">Submit concern</SubmitButton>
              </form>
            </Section>
            </>) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <p className="text-sm font-medium text-[var(--muted)]">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-normal">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function JumpLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--subtle)] px-3 py-2 text-sm font-medium text-[var(--text)] transition hover:border-[var(--muted)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
    >
      {icon}
      {children}
    </a>
  );
}

function SubmitButton({ children, variant = "primary", disabled }: { children: React.ReactNode; variant?: "primary" | "secondary"; disabled?: boolean }) {
  const className =
    variant === "primary"
      ? "min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed"
      : "min-h-11 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button type="submit" className={className} disabled={disabled}>
      {children}
    </button>
  );
}

function Notice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[var(--notice-border)] bg-[var(--notice)] px-4 py-3 text-sm text-[var(--notice-text)]" role="status">
      {message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--muted)]">{text}</p>;
}

function RouteCard({ route }: { route: ExperienceRoute }) {
  const accepted = route.status === "accepted";
  const declined = route.status === "declined";

  return (
    <article className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold capitalize">{route.serviceType} requested</h3>
          <p className="mt-1 text-sm text-[var(--soft-text)]">
            Routed to you. {route.urgencyLabel}
          </p>
        </div>
        <StatusLabel status={route.status} />
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[var(--soft-text)]">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4" aria-hidden="true" />
          <span>Personal details stay private unless help is accepted.</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" aria-hidden="true" />
          <span>Created {route.createdAtLabel}</span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!accepted && !declined ? (
          <>
            <form action={decideRouteAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <input type="hidden" name="decision" value="accepted" />
              <SubmitButton variant="secondary">
                <span className="inline-flex items-center gap-2">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Accept
                </span>
              </SubmitButton>
            </form>
            <form action={decideRouteAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <input type="hidden" name="decision" value="declined" />
              <SubmitButton variant="secondary">
                <span className="inline-flex items-center gap-2">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Decline
                </span>
              </SubmitButton>
            </form>
          </>
        ) : null}
        {accepted ? (
          <form action={recordContributionAction}>
            <input type="hidden" name="routeId" value={route.id} />
            <SubmitButton>
              <span className="inline-flex items-center gap-2">
                <HeartHandshake className="h-4 w-4" aria-hidden="true" />
                Mark as helped
              </span>
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {accepted ? <p className="mt-3 text-sm leading-6 text-[var(--accent)]">Accepted. Coordinate privately, then mark help given when finished.</p> : null}
      {declined ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Declined. That is okay; no contribution or judgment is recorded.</p> : null}
    </article>
  );
}

function StatusLabel({ status }: { status: string }) {
  const label = status.replace("_", " ");
  return <span className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">{label}</span>;
}

async function logoutAction() {
  "use server";

  const session = await getSession();
  session.destroy();
  redirect("/");
}

async function joinGroupAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();

  try {
    const result = await joinOpenGroup(prisma, session.accountId, groupId);
    session.activeGroupId = result.groupId;
    await session.save();

    // Route any open requests that existed before this account joined.
    const openRequests = await prisma.supportRequest.findMany({
      where: { status: "open", groupId },
      select: { id: true },
    });
    for (const request of openRequests) {
      await routeSupportRequest(prisma, { supportRequestId: request.id });
    }
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard");
}

async function leaveGroupAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();

  try {
    await leaveGroup(prisma, session.accountId, groupId);
    // Switch to the next active membership, or clear the active group.
    const nextMembership = await prisma.groupMembership.findFirst({
      where: { accountId: session.accountId, status: "active", NOT: { groupId } },
      orderBy: { joinedAt: "asc" },
      select: { groupId: true },
    });
    session.activeGroupId = nextMembership?.groupId ?? null;
    await session.save();
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard");
}

async function switchGroupAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();

  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    session.activeGroupId = groupId;
    await session.save();
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard");
}

async function requestHelpAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const serviceType = requiredString(formData, "serviceType");
  const contact = requiredString(formData, "contact");
  const location = optionalString(formData, "location");
  const language = optionalString(formData, "language");
  const urgency = requiredString(formData, "urgency") as "low" | "normal" | "high" | "urgent";
  const trustPreference = requiredString(formData, "trustPreference") as "lightweight" | "elevated";
  const activeDays = Math.min(90, Math.max(3, parseInt(optionalString(formData, "activeDays") ?? "30", 10) || 30));
  const groupId = session.activeGroupId;

  if (!groupId) redirect("/dashboard");

  const prisma = createPrismaClient();

  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    const offering = await prisma.groupServiceOffering.findFirst({
      where: { groupId, serviceType, status: "active" },
      select: { projectId: true },
    });
    const request = await createSupportRequest(prisma, {
      submittedByAccountId: session.accountId,
      groupId,
      projectId: offering?.projectId ?? null,
      requestType: serviceType,
      requestedServices: [{ serviceType, trustRequirement: trustPreference }],
      description: buildRequestDescription({ contact, location, language }),
      urgency,
      privacyLevel: "private",
      expiresAt: new Date(Date.now() + activeDays * 24 * 60 * 60 * 1000),
    });

    await routeSupportRequest(prisma, { supportRequestId: request.id });
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/dashboard");
}

async function offerHelpAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const services = formData.getAll("services").map(String).filter(Boolean);

  if (services.length === 0) {
    redirect("/dashboard?notice=Choose%20at%20least%20one%20kind%20of%20help%20before%20saving%20an%20offer.");
  }

  const availabilityPreference = requiredString(formData, "availabilityPreference") as "unavailable" | "available" | "limited" | "time-sensitive-capable";
  const availableNow = availabilityPreference !== "unavailable";
  const prisma = createPrismaClient();

  try {
    for (const serviceType of services) {
      await declareServiceCapability(prisma, {
        accountId: session.accountId,
        serviceType,
        trustRequirement: "lightweight",
        availability: { availableNow, preference: availabilityPreference },
        visibility: "group",
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/dashboard");
}

async function routeOpenRequestsAction() {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const groupId = session.activeGroupId;
  if (!groupId) return;

  const prisma = createPrismaClient();

  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    const requests = await prisma.supportRequest.findMany({ where: { status: "open", groupId }, select: { id: true } });

    for (const request of requests) {
      await routeSupportRequest(prisma, { supportRequestId: request.id });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/dashboard");
}

async function decideRouteAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const routeId = requiredString(formData, "routeId");
  const decision = requiredString(formData, "decision") as "accepted" | "declined";
  const prisma = createPrismaClient();

  try {
    const route = await prisma.requestRoute.findUniqueOrThrow({
      where: { id: routeId },
      select: { supportRequest: { select: { groupId: true } } },
    });
    await requireGroupMembership(prisma, session.accountId, route.supportRequest.groupId);
    await decideRequestRoute(prisma, { routeId, contributorAccountId: session.accountId, decision });
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/dashboard");
}

async function recordContributionAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const routeId = requiredString(formData, "routeId");
  const prisma = createPrismaClient();

  try {
    const route = await prisma.requestRoute.findUniqueOrThrow({
      where: { id: routeId },
      select: { supportRequest: { select: { groupId: true } } },
    });
    await requireGroupMembership(prisma, session.accountId, route.supportRequest.groupId);
    const existing = await prisma.contribution.findFirst({
      where: { privacyEnvelope: { path: ["requestRouteId"], equals: routeId } },
    });

    if (!existing) {
      await createContributionFromAcceptedRoute(prisma, { routeId });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/dashboard");
}

async function submitConcernAction(formData: FormData) {
  "use server";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");

  const subject = requiredString(formData, "subject");
  const description = requiredString(formData, "description");
  const context = optionalString(formData, "context");
  const prisma = createPrismaClient();

  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    const report = await prisma.report.create({
      data: {
        reportedByAccountId: session.accountId,
        groupId,
        subject,
        description,
        context: context ?? null,
        status: "open",
        visibility: "private",
      },
    });
    await logAction(prisma, {
      actorAccountId: session.accountId,
      groupId,
      action: "concern.submitted",
      targetType: "report",
      targetId: report.id,
    });
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard#concerns");
}

async function getDashboardData(accountId: string, groupId: string | null) {
  const prisma = createPrismaClient();

  try {
    if (groupId) {
      await recordGroupPresence(prisma, accountId, groupId);
      await applyParticipationTransitions(prisma, groupId);
    }

    const [account, group, memberships] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
      groupId ? prisma.group.findUnique({ where: { id: groupId }, include: { node: true } }) : Promise.resolve(null),
      prisma.groupMembership.findMany({
        where: { accountId, status: "active" },
        orderBy: { joinedAt: "asc" },
        select: {
          groupId: true,
          group: { select: { id: true, name: true, description: true } },
        },
      }),
    ]);

    const nodeId = group?.nodeId ?? account.homeNodeId;

    const [projects, routes, serviceOfferings, openGroups, groupContributions, personalContributions, projectServices, projectContributions, myReports, groupOpenConcernCount, myRequests] = await Promise.all([
      group ? prisma.project.findMany({ where: { groupId: group.id, status: "active" }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
      prisma.requestRoute.findMany({
        where: {
          contributorAccountId: accountId,
          ...(groupId ? { supportRequest: { groupId } } : {}),
        },
        include: { contributor: true, supportRequest: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.groupServiceOffering.findMany({
        where: { status: "active", group: { nodeId } },
        distinct: ["serviceType"],
        orderBy: { serviceType: "asc" },
      }),
      prisma.group.findMany({
        where: {
          nodeId: account.homeNodeId,
          membershipPolicy: "open",
          memberships: { none: { accountId, status: { in: ["active", "pending"] } } },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, description: true },
      }),
      group
        ? prisma.contribution.groupBy({
            by: ["contributionType"],
            where: { groupId: group.id, visibility: "group" },
            _count: { contributionType: true },
            orderBy: { _count: { contributionType: "desc" } },
          })
        : Promise.resolve([]),
      group
        ? prisma.contribution.groupBy({
            by: ["contributionType"],
            where: { contributorAccountId: accountId, groupId: group.id, visibility: "group" },
            _count: { contributionType: true },
            orderBy: { _count: { contributionType: "desc" } },
          })
        : Promise.resolve([]),
      group
        ? prisma.groupServiceOffering.findMany({
            where: { groupId: group.id, status: "active", projectId: { not: null } },
            select: { projectId: true, serviceType: true },
          })
        : Promise.resolve([]),
      group
        ? prisma.contribution.groupBy({
            by: ["projectId", "contributionType"],
            where: { groupId: group.id, visibility: "group", projectId: { not: null } },
            _count: { contributionType: true },
            orderBy: { _count: { contributionType: "desc" } },
          })
        : Promise.resolve([]),
      group
        ? prisma.report.findMany({
            where: { reportedByAccountId: accountId, groupId: group.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, subject: true, context: true, description: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
      group
        ? prisma.report.count({ where: { groupId: group.id, status: "open" } })
        : Promise.resolve(0),
      group
        ? prisma.supportRequest.findMany({
            where: { submittedByAccountId: accountId, groupId: group.id, status: { notIn: ["deleted"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, requestType: true, status: true, createdAt: true, expiresAt: true, accountabilityEndsAt: true },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    return {
      account,
      group,
      memberships,
      openGroups,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        services: projectServices
          .filter((s) => s.projectId === p.id)
          .map((s) => s.serviceType),
        contributions: projectContributions
          .filter((c) => c.projectId === p.id)
          .map((c) => ({ type: c.contributionType, count: c._count.contributionType })),
      })),
      serviceOfferings,
      routes: routes.map((route) => ({
        id: route.id,
        contributorAccountId: route.contributorAccountId,
        contributor: { displayName: route.contributor.displayName },
        serviceType: route.serviceType,
        status: route.status,
        urgencyLabel: urgencyLabel(route.supportRequest.urgency),
        createdAtLabel: formatRelativeDate(route.createdAt),
      })),
      groupContributions: groupContributions.map((r) => ({ type: r.contributionType, count: r._count.contributionType })),
      personalContributions: personalContributions.map((r) => ({ type: r.contributionType, count: r._count.contributionType })),
      myReports,
      groupOpenConcernCount,
      myRequests,
    };
  } finally {
    await prisma.$disconnect();
  }
}


function urgencyLabel(urgency: string) {
  if (urgency === "urgent") return "Time-sensitive, but not broadcast publicly.";
  if (urgency === "high") return "Today if possible.";
  return "Shared without pressure.";
}

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

type ExperienceRoute = {
  id: string;
  contributorAccountId: string;
  contributor: { displayName: string };
  serviceType: string;
  status: string;
  urgencyLabel: string;
  createdAtLabel: string;
};
