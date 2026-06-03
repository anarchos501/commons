import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BookOpen,
  Check,
  Clock,
  FileText,
  FolderOpen,
  HandHeart,
  HeartHandshake,
  HelpCircle,
  Inbox,
  Languages,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircle,
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
import { applyParticipationTransitions, getActiveParticipantCount, recordGroupPresence } from "../../lib/participation";
import { getCoverageStatus } from "../../lib/concerns";
import { confirmResponsibilityAssignment, expireStaleAssignments, hasActiveEligibleAssignment, volunteerForResponsibility } from "../../lib/responsibilities";
import { createBulletin } from "../../lib/bulletins";
import { createPublication } from "../../lib/publications";
import { createLivingDocument, draftLivingDocumentRevision, onLivingDocumentArchivalPetitionApproved, onRevisionPetitionApproved, openRevisionPetition } from "../../lib/living-documents";
import { createDiscussionThread, ensureGeneralDiscussion, listDiscussionMessages, listDiscussionThreads, onThreadClosurePetitionApproved, openThreadClosurePetition, postDiscussionMessage } from "../../lib/discussions";
import { addPetitionSupport, evaluatePetition, withdrawPetitionSupport } from "../../lib/petitions";
import { GOVERNANCE_CATEGORIES, type GovernanceCategory } from "../../lib/governance-categories";
import { resolveGovernanceParams } from "../../lib/governance-resolver";
import { upsertGovernanceSignal } from "../../lib/governance-temperature";

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
  const discussionThreadId = typeof params.discussionThread === "string" ? params.discussionThread : null;
  const data = await getDashboardData(session.accountId, session.activeGroupId ?? null, discussionThreadId);

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
            {data.group ? (
              <JumpLink href="#discussion" icon={<MessageCircle className="h-4 w-4" />}>
                Discussion
              </JumpLink>
            ) : null}
            {data.group ? (
              <JumpLink href="#bulletins" icon={<Megaphone className="h-4 w-4" />}>
                Bulletins
              </JumpLink>
            ) : null}
            {data.group ? (
              <JumpLink href="#publications" icon={<BookOpen className="h-4 w-4" />}>
                Publications
              </JumpLink>
            ) : null}
            {data.group ? (
              <JumpLink href="#documents" icon={<FileText className="h-4 w-4" />}>
                Documents
              </JumpLink>
            ) : null}
          </nav>
        </header>

        <AlphaNotice />

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
              <div className="mb-4 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${data.coverageStatus === "available" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                  Review Coverage: {data.coverageStatus === "available" ? "Available" : "Unavailable"}
                </span>
                {data.groupOpenConcernCount > 0 ? (
                  <span className="text-xs text-[var(--muted)]">
                    {data.groupOpenConcernCount} active concern{data.groupOpenConcernCount !== 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>

              {data.coverageStatus === "unavailable" ? (
                <p className="mb-4 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-xs text-[var(--muted)]">
                  No active concern reviewers are currently available.
                </p>
              ) : null}

              {data.reviewerResponsibility && data.reviewerQueue.length > 0 ? (
                <div className="mb-5 space-y-3">
                  <p className="text-xs font-medium text-[var(--muted)]">Reviewer queue</p>
                  {data.reviewerQueue.map((concern) => (
                    <div key={concern.id} className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{concern.subject}</p>
                        <span className="shrink-0 text-xs capitalize text-[var(--muted)]">
                          {concern.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      {concern.findings.length > 0 ? (
                        <p className="text-xs text-[var(--muted)]">
                          {concern.findings.length} finding{concern.findings.length !== 1 ? "s" : ""}: {concern.findings.map((f) => f.outcome.replace(/_/g, " ")).join(", ")}
                        </p>
                      ) : null}
                      {concern.actionProposals.filter((p) => p.status === "pending").length > 0 ? (
                        <p className="text-xs text-[var(--muted)]">Pending proposal</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {data.myReports.length > 0 ? (
                <div className="mb-5 space-y-3">
                  <p className="text-xs font-medium text-[var(--muted)]">Your concerns</p>
                  {data.myReports.map((report) => (
                    <div key={report.id} className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{report.subject}</p>
                        <span className="shrink-0 text-xs capitalize text-[var(--muted)]">
                          {report.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      {report.closureReason ? (
                        <p className="text-xs text-[var(--muted)]">Closed: {report.closureReason.replace(/_/g, " ")}</p>
                      ) : null}
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

            <Section id="discussion" title="Discussion" eyebrow="Temporary coordination">
              {data.groupDiscussionThreads.length > 0 ? (
                <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {data.groupDiscussionThreads.map((thread) => (
                      <a
                        key={thread.id}
                        href={`/dashboard?discussionThread=${thread.id}#discussion`}
                        className={`block rounded border p-3 text-sm transition hover:bg-[var(--hover)] ${
                          data.selectedDiscussionThread?.id === thread.id
                            ? "border-[var(--accent)] bg-[var(--subtle)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <span className="font-medium text-[var(--text)]">{thread.title}</span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} &middot; {formatRelativeDate(thread.lastActivityAt)}
                        </span>
                      </a>
                    ))}
                  </div>
                  <div className="rounded border border-[var(--border)] p-3">
                    {data.selectedDiscussionThread ? (
                      <>
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{data.selectedDiscussionThread.title}</p>
                            <p className="text-xs text-[var(--muted)]">Messages expire automatically.</p>
                          </div>
                          {data.currentMembership?.participationStatus === "active" ? (
                            <form action={openThreadClosurePetitionAction}>
                              <input type="hidden" name="threadId" value={data.selectedDiscussionThread.id} />
                              <SubmitButton variant="secondary">Propose closure</SubmitButton>
                            </form>
                          ) : null}
                        </div>
                        {data.groupDiscussionMessages.length > 0 ? (
                          <div className="mb-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                            {data.groupDiscussionMessages.map((message) => (
                              <div key={message.id} className="rounded bg-[var(--subtle)] px-3 py-2">
                                <p className="text-sm leading-6 text-[var(--soft-text)]">{message.body}</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {message.author.displayName} &middot; {formatRelativeDate(message.createdAt)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState text="No active messages in this thread." />
                        )}
                        {data.currentMembership?.participationStatus === "active" ? (
                          <form action={postDiscussionMessageAction} className="space-y-2">
                            <input type="hidden" name="threadId" value={data.selectedDiscussionThread.id} />
                            <textarea name="body" required rows={3} className="field-input resize-none" placeholder="Add a temporary coordination note." />
                            <SubmitButton variant="secondary">Post message</SubmitButton>
                          </form>
                        ) : (
                          <p className="text-xs text-[var(--muted)]">Quiet members can read discussion but cannot post.</p>
                        )}
                      </>
                    ) : (
                      <EmptyState text="No active discussion thread selected." />
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState text="No active discussion threads yet." />
              )}
              {data.currentMembership?.participationStatus === "active" ? (
                <form action={createDiscussionThreadAction} className="space-y-3">
                  <label className="block">
                    <span className="field-label">New thread</span>
                    <input name="title" type="text" required className="field-input" placeholder="A focused coordination topic" />
                  </label>
                  <SubmitButton variant="secondary">Create thread</SubmitButton>
                </form>
              ) : null}
            </Section>

            <Section id="bulletins" title="Bulletins" eyebrow="Group updates">
              {data.groupBulletins.length > 0 ? (
                <div className="mb-4 space-y-3">
                  {data.groupBulletins.map((b) => (
                    <div key={b.id} className="rounded border border-[var(--border)] p-3">
                      <p className="text-sm font-medium text-[var(--text)]">{b.title}</p>
                      <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-3">{b.body}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {b.author.displayName} &middot; {formatRelativeDate(b.publishedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No bulletins yet." />
              )}
              <form action={createBulletinAction} className="space-y-3">
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="A short title" />
                </label>
                <label className="block">
                  <span className="field-label">Body</span>
                  <textarea name="body" required rows={3} className="field-input resize-none" placeholder="What does the group need to know?" />
                </label>
                <SubmitButton variant="secondary">Post bulletin</SubmitButton>
              </form>
            </Section>

            <Section id="publications" title="Publications" eyebrow="Knowledge collections">
              {data.groupPublications.length > 0 ? (
                <div className="mb-4 space-y-2">
                  {data.groupPublications.map((p) => (
                    <div key={p.id} className="rounded border border-[var(--border)] p-3">
                      <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {p.creator.displayName} &middot; {p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No publications yet." />
              )}
              <form action={createPublicationAction} className="space-y-3">
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="e.g. Meeting Notes" />
                </label>
                <SubmitButton variant="secondary">Create publication</SubmitButton>
              </form>
            </Section>

            <Section id="documents" title="Living Documents" eyebrow="Current reference texts">
              {data.groupLivingDocuments.length > 0 ? (
                <div className="mb-4 space-y-4">
                  {data.groupLivingDocuments.map((doc) => (
                    <div key={doc.id} className="rounded border border-[var(--border)] p-3 space-y-2">
                      <p className="text-sm font-semibold text-[var(--text)]">{doc.title}</p>
                      <p className="text-xs leading-5 text-[var(--soft-text)] line-clamp-3">{doc.currentBody}</p>
                      <p className="text-xs text-[var(--muted)]">Last revised {formatRelativeDate(doc.lastRevisedAt)}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a revision</summary>
                        <form action={proposeLivingDocumentRevisionAction} className="mt-2 space-y-2">
                          <input type="hidden" name="livingDocumentId" value={doc.id} />
                          <textarea name="body" required rows={4} defaultValue={doc.currentBody} className="field-input resize-none text-sm" />
                          <SubmitButton variant="secondary">Open revision petition</SubmitButton>
                        </form>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No living documents yet." />
              )}
              <form action={createLivingDocumentAction} className="space-y-3">
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="e.g. Mission, Charter, Code of Conduct" />
                </label>
                <label className="block">
                  <span className="field-label">Body</span>
                  <textarea name="body" required rows={4} className="field-input resize-none" placeholder="The current text of this document." />
                </label>
                <SubmitButton variant="secondary">Create document</SubmitButton>
              </form>
            </Section>

            <CollapsibleSection id="petitions" title="Petitions" eyebrow="Community decisions">
              <div className="space-y-4">
                <form action={evaluateClosedPetitionsAction}>
                  <SubmitButton variant="secondary">Check petition outcomes</SubmitButton>
                </form>
                {data.groupPetitions.length > 0 ? (
                  <div className="space-y-3">
                    {data.groupPetitions.map((petition) => (
                      <PetitionCard key={petition.id} petition={petition} canSupport={data.currentMembership?.participationStatus === "active"} />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No petitions yet. Proposed document revisions and responsibility volunteers will appear here." />
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection id="responsibilities" title="Responsibilities" eyebrow="Community coverage">
              <div className="space-y-4">
                <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">Reviewer coverage</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {data.coverageStatus === "available"
                          ? "At least one active reviewer can handle concern reviews."
                          : "No active reviewer is currently available."}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${data.coverageStatus === "available" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                      {data.coverageStatus === "available" ? "Covered" : "Needed"}
                    </span>
                  </div>
                  {data.coverageStatus === "unavailable" && data.currentMembership?.participationStatus === "active" ? (
                    <form action={volunteerForReviewerAction} className="mt-3">
                      <SubmitButton variant="secondary">Volunteer as reviewer</SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection id="governance-settings" title="Governance Settings" eyebrow="Decision friction">
              <div className="space-y-4">
                {data.governanceSettings.map((setting) => (
                  <form key={setting.category} action={updateGovernanceSignalAction} className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <input type="hidden" name="category" value={setting.category} />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">{governanceCategoryLabel(setting.category)}</p>
                        <p className="text-xs leading-5 text-[var(--muted)]">
                          Threshold {formatPercent(setting.threshold)} · {Math.round(setting.petitionDuration)} day petition
                        </p>
                      </div>
                      <select name="signal" className="field-input sm:w-44" defaultValue={String(setting.signal)}>
                        <option value="-1">More Careful</option>
                        <option value="0">Neutral</option>
                        <option value="1">Easier To Act</option>
                      </select>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">How this works</summary>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                        Member signals adjust petition thresholds and petition length for this category. They do not approve proposals by themselves.
                      </p>
                    </details>
                    <div className="mt-3">
                      <SubmitButton variant="secondary">Save setting</SubmitButton>
                    </div>
                  </form>
                ))}
              </div>
            </CollapsibleSection>

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

function CollapsibleSection({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium text-[var(--muted)]">{eyebrow}</span>
            <span className="mt-1 block text-2xl font-semibold tracking-normal">{title}</span>
          </span>
          <span className="text-sm text-[var(--muted)]">Expand</span>
        </summary>
        <div className="mt-5">{children}</div>
      </details>
    </section>
  );
}

function PetitionCard({ petition, canSupport }: { petition: DashboardPetition; canSupport: boolean }) {
  const isOpen = petition.status === "open";
  return (
    <article className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">{proposalFamilyLabel(petition.subjectType)}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{petition.subjectLabel}</p>
        </div>
        <span className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">
          {petition.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-3">
        <p>{petition.supportCount} supporting</p>
        <p>{petition.requiredSupport} needed</p>
        <p>{isOpen ? `Closes ${formatRelativeDate(petition.closesAt)}` : `Resolved ${petition.resolvedAt ? formatRelativeDate(petition.resolvedAt) : "later"}`}</p>
      </div>
      {isOpen ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canSupport ? (
            petition.supportedByCurrentMember ? (
              <form action={withdrawPetitionSupportAction}>
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Withdraw support</SubmitButton>
              </form>
            ) : (
              <form action={supportPetitionAction}>
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Support</SubmitButton>
              </form>
            )
          ) : (
            <p className="text-xs text-[var(--muted)]">Only active members may support petitions.</p>
          )}
          <form action={evaluatePetitionAction}>
            <input type="hidden" name="petitionId" value={petition.id} />
            <SubmitButton variant="secondary">Check outcome</SubmitButton>
          </form>
        </div>
      ) : null}
    </article>
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

async function createDiscussionThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    const thread = await createDiscussionThread(prisma, {
      spaceType: "group",
      spaceId: groupId,
      groupId,
      createdByMembershipId: membership.id,
      title,
    });
    revalidatePath("/dashboard");
    redirect(`/dashboard?discussionThread=${thread.id}#discussion`);
  } finally {
    await prisma.$disconnect();
  }
}

async function postDiscussionMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    await postDiscussionMessage(prisma, { threadId, groupId, authorMembershipId: membership.id, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect(`/dashboard?discussionThread=${threadId}#discussion`);
}

async function openThreadClosurePetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const threadId = requiredString(formData, "threadId");
  const prisma = createPrismaClient();
  let notice = "Thread closure petition opened.";
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    const result = await openThreadClosurePetition(prisma, { threadId, groupId, createdByMembershipId: membership.id });
    if (!result.ok) {
      notice = discussionPetitionFailureNotice(result.reason);
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect(`/dashboard?discussionThread=${threadId}&notice=${encodeURIComponent(notice)}#discussion`);
}

async function createBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    await createBulletin(prisma, { spaceType: "group", spaceId: groupId, authorId: session.accountId, title, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#bulletins");
}

async function createPublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    await createPublication(prisma, { spaceType: "group", spaceId: groupId, createdByAccountId: session.accountId, title });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#publications");
}

async function createLivingDocumentAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    await createLivingDocument(prisma, { spaceType: "group", spaceId: groupId, authorId: session.accountId, title, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#documents");
}

async function proposeLivingDocumentRevisionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const livingDocumentId = requiredString(formData, "livingDocumentId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUniqueOrThrow({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    const revision = await draftLivingDocumentRevision(prisma, { livingDocumentId, authorId: session.accountId, body });
    await openRevisionPetition(prisma, { livingDocumentId, revisionId: revision.id, createdByMembershipId: membership.id, groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#documents");
}

async function supportPetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    await addPetitionSupport(prisma, { petitionId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#petitions");
}

async function withdrawPetitionSupportAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    await withdrawPetitionSupport(prisma, { petitionId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#petitions");
}

async function evaluatePetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    await requireDashboardMembership(prisma, session.accountId, groupId);
    await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#petitions");
}

async function evaluateClosedPetitionsAction() {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const prisma = createPrismaClient();
  try {
    await requireDashboardMembership(prisma, session.accountId, groupId);
    const petitions = await prisma.petition.findMany({
      where: { groupId, status: "open", closesAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const petition of petitions) {
      await evaluateAndApplyPetition(prisma, petition.id);
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#petitions");
}

async function volunteerForReviewerAction() {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#responsibilities");
}

async function updateGovernanceSignalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = session.activeGroupId;
  if (!groupId) redirect("/dashboard");
  const category = requiredString(formData, "category");
  const signal = Number(requiredString(formData, "signal"));
  const prisma = createPrismaClient();
  try {
    const membership = await requireDashboardMembership(prisma, session.accountId, groupId);
    await upsertGovernanceSignal(prisma, { membershipId: membership.id, groupId, category, signal });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
  redirect("/dashboard#governance-settings");
}

async function getDashboardData(accountId: string, groupId: string | null, selectedDiscussionThreadId: string | null) {
  const prisma = createPrismaClient();

  try {
    if (groupId) {
      await recordGroupPresence(prisma, accountId, groupId);
      await applyParticipationTransitions(prisma, groupId);
      await expireStaleAssignments(prisma, groupId);
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
    const currentMembership = group
      ? await prisma.groupMembership.findUnique({
          where: { accountId_groupId: { accountId, groupId: group.id } },
          select: { id: true, status: true, participationStatus: true },
        })
      : null;

    const [projects, routes, serviceOfferings, openGroups, groupContributions, personalContributions, projectServices, projectContributions, myReports, groupOpenConcernCount, myRequests, groupBulletins, groupPublications, groupLivingDocuments] = await Promise.all([
      group ? prisma.project.findMany({ where: { groupId: group.id, status: "active", archivedAt: null }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
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
            select: { id: true, subject: true, context: true, description: true, status: true, closureReason: true, createdAt: true },
          })
        : Promise.resolve([]),
      group
        ? prisma.report.count({ where: { groupId: group.id, status: { in: ["open", "under_review", "findings_issued", "action_proposed"] } } })
        : Promise.resolve(0),
      group
        ? prisma.supportRequest.findMany({
            where: { submittedByAccountId: accountId, groupId: group.id, status: { notIn: ["deleted"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, requestType: true, status: true, createdAt: true, expiresAt: true, accountabilityEndsAt: true },
            take: 10,
          })
        : Promise.resolve([]),
      // Communication content for the active group
      group
        ? prisma.bulletin.findMany({
            where: { spaceType: "group", spaceId: group.id, archivedAt: null },
            include: { author: { select: { displayName: true } } },
            orderBy: { publishedAt: "desc" },
          })
        : Promise.resolve([]),
      group
        ? prisma.publication.findMany({
            where: { spaceType: "group", spaceId: group.id, archivedAt: null },
            include: {
              creator: { select: { displayName: true } },
              _count: { select: { entries: { where: { archivedAt: null } } } },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      group
        ? prisma.livingDocument.findMany({
            where: { spaceType: "group", spaceId: group.id, archivedAt: null },
            orderBy: { lastRevisedAt: "desc" },
          })
        : Promise.resolve([]),
    ]);
    const activeParticipantCount = group ? await getActiveParticipantCount(prisma, group.id) : 0;
    const petitions = group
      ? await prisma.petition.findMany({
          where: { groupId: group.id },
          orderBy: [{ status: "asc" }, { closesAt: "asc" }],
          include: {
            _count: { select: { support: true } },
            support: { where: { membershipId: currentMembership?.id ?? "" }, select: { id: true }, take: 1 },
          },
          take: 12,
        })
      : [];
    const groupPetitions = await Promise.all(
      petitions.map(async (petition): Promise<DashboardPetition> => {
        const snapshot = petition.governanceSnapshot as { threshold?: number };
        const threshold = typeof snapshot.threshold === "number" ? snapshot.threshold : 1;
        return {
          id: petition.id,
          subjectType: petition.subjectType,
          subjectLabel: await describePetitionSubject(prisma, petition.subjectType, petition.subjectId),
          status: petition.status,
          closesAt: petition.closesAt,
          resolvedAt: petition.resolvedAt,
          supportCount: petition._count.support,
          requiredSupport: Math.ceil(activeParticipantCount * threshold),
          supportedByCurrentMember: petition.support.length > 0,
        };
      }),
    );
    const governanceCategories = GOVERNANCE_CATEGORIES.filter(
      (category): category is GovernanceCategory => category === "living_document" || category === "responsibility" || category === "discussion",
    );
    const currentSignals = currentMembership
      ? await prisma.memberGovernanceSignal.findMany({
          where: { membershipId: currentMembership.id, category: { in: governanceCategories } },
          select: { category: true, signal: true },
        })
      : [];
    const signalByCategory = new Map(currentSignals.map((signal) => [signal.category, signal.signal]));
    const governanceSettings = group && currentMembership
      ? await Promise.all(
          governanceCategories.map(async (category) => {
            const params = await resolveGovernanceParams(prisma, group.id, category);
            return {
              category,
              threshold: params.threshold,
              petitionDuration: params.petitionDuration,
              signal: signalByCategory.get(category) ?? 0,
            };
          }),
        )
      : [];
    let groupDiscussionThreads = group
      ? await listDiscussionThreads(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id })
      : [];
    if (group && currentMembership?.participationStatus === "active" && groupDiscussionThreads.length === 0) {
      await ensureGeneralDiscussion(prisma, {
        spaceType: "group",
        spaceId: group.id,
        groupId: group.id,
        createdByMembershipId: currentMembership.id,
      });
      groupDiscussionThreads = await listDiscussionThreads(prisma, { spaceType: "group", spaceId: group.id, groupId: group.id });
    }
    const selectedDiscussionThread =
      groupDiscussionThreads.find((thread) => thread.id === selectedDiscussionThreadId) ?? groupDiscussionThreads[0] ?? null;
    const groupDiscussionMessages = selectedDiscussionThread
      ? await listDiscussionMessages(prisma, selectedDiscussionThread.id)
      : [];

    return {
      account,
      group,
      currentMembership,
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
      coverageStatus: group ? await getCoverageStatus(prisma, group.id) : ("unavailable" as const),
      reviewerResponsibility: group
        ? await (async () => {
            const m = await prisma.groupMembership.findUnique({
              where: { accountId_groupId: { accountId, groupId: group.id } },
              select: { id: true },
            });
            return m ? await hasActiveEligibleAssignment(prisma, m.id, "reviewer") : false;
          })()
        : false,
      groupBulletins,
      groupPublications,
      groupLivingDocuments,
      groupDiscussionThreads,
      selectedDiscussionThread,
      groupDiscussionMessages,
      groupPetitions,
      governanceSettings,
      reviewerQueue: group
        ? await prisma.report.findMany({
            where: {
              groupId: group.id,
              status: { in: ["open", "under_review", "findings_issued", "action_proposed"] },
              reportedByAccountId: { not: accountId },
            },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              subject: true,
              status: true,
              createdAt: true,
              findings: { select: { outcome: true, createdAt: true } },
              actionProposals: { select: { proposedAction: true, status: true, iteration: true } },
            },
          })
        : [],
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function requireDashboardMembership(prisma: ReturnType<typeof createPrismaClient>, accountId: string, groupId: string) {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true, participationStatus: true },
  });
  if (!membership || membership.status !== "active") {
    throw new Error("Active group membership required.");
  }
  return membership;
}

async function evaluateAndApplyPetition(prisma: ReturnType<typeof createPrismaClient>, petitionId: string) {
  const result = await evaluatePetition(prisma, petitionId);
  if (result.outcome !== "approved") return;

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectType: true },
  });
  if (!petition) return;

  if (petition.subjectType === "living_document_revision") {
    await onRevisionPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "living_document_archive") {
    await onLivingDocumentArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "discussion_thread_close") {
    await onThreadClosurePetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "responsibility_proposal") {
    await confirmResponsibilityAssignment(prisma, petitionId);
  }
}

async function describePetitionSubject(prisma: ReturnType<typeof createPrismaClient>, subjectType: string, subjectId: string) {
  if (subjectType === "living_document_revision") {
    const revision = await prisma.livingDocumentRevision.findUnique({
      where: { id: subjectId },
      select: { livingDocument: { select: { title: true } }, author: { select: { displayName: true } } },
    });
    return revision ? `${revision.livingDocument.title} revision by ${revision.author.displayName}` : subjectId;
  }

  if (subjectType === "living_document_archive") {
    const document = await prisma.livingDocument.findUnique({
      where: { id: subjectId },
      select: { title: true },
    });
    return document ? `Archive ${document.title}` : subjectId;
  }

  if (subjectType === "responsibility_proposal") {
    const [membershipId, type] = subjectId.split(":", 2);
    const membership = await prisma.groupMembership.findUnique({
      where: { id: membershipId },
      select: { account: { select: { displayName: true } } },
    });
    return membership ? `${membership.account.displayName} for ${capitalize(type)}` : subjectId;
  }

  if (subjectType === "discussion_thread_close") {
    const thread = await prisma.discussionThread.findUnique({
      where: { id: subjectId },
      select: { title: true },
    });
    return thread ? `Close ${thread.title}` : subjectId;
  }

  return subjectId;
}


function urgencyLabel(urgency: string) {
  if (urgency === "urgent") return "Time-sensitive, but not broadcast publicly.";
  if (urgency === "high") return "Today if possible.";
  return "Shared without pressure.";
}

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function proposalFamilyLabel(subjectType: string) {
  switch (subjectType) {
    case "living_document_revision":
      return "Living document revision";
    case "living_document_archive":
      return "Living document archival";
    case "discussion_thread_close":
      return "Discussion thread closure";
    case "responsibility_proposal":
      return "Responsibility volunteer";
    default:
      return subjectType.replace(/_/g, " ");
  }
}

function discussionPetitionFailureNotice(reason: string) {
  switch (reason) {
    case "creator_not_eligible":
      return "Only active members can propose closing a discussion thread.";
    case "petition_already_open":
      return "A closure petition is already open for this discussion thread.";
    case "category_mismatch":
    case "invalid_family":
      return "This discussion closure petition could not be opened.";
    default:
      return "This discussion closure petition could not be opened.";
  }
}

function governanceCategoryLabel(category: GovernanceCategory) {
  switch (category) {
    case "living_document":
      return "Living Documents";
    case "responsibility":
      return "Responsibilities";
    case "discussion":
      return "Discussion";
    default:
      return category.replace(/_/g, " ");
  }
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

type DashboardPetition = {
  id: string;
  subjectType: string;
  subjectLabel: string;
  status: string;
  closesAt: Date;
  resolvedAt: Date | null;
  supportCount: number;
  requiredSupport: number;
  supportedByCurrentMember: boolean;
};
