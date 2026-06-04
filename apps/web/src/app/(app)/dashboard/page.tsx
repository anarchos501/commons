import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Check,
  Clock,
  HandHeart,
  HeartHandshake,
  HelpCircle,
  Inbox,
  Languages,
  MapPin,
  Shield,
  Users,
  X,
} from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import {
  createContributionFromAcceptedRoute,
  createSupportRequest,
  decideRequestRoute,
  declareServiceCapability,
  routeSupportRequest,
} from "../../../lib/capability-routing";
import { joinOpenGroup, leaveGroup, requireGroupMembership } from "../../../lib/group-membership";
import { buildRequestDescription, capitalize, optionalString, requiredString, trustPreferenceOptions } from "../../../lib/support-form";
import { deleteSupportRequest, fulfillSupportRequest, REQUEST_STATUS_LABELS } from "../../../lib/request-lifecycle";
import { CollapsibleSection } from "../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../components/shared/SubmitButton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../components/shared/Notice";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const availabilityOptions = [
  { value: "available", label: "Available", description: "It is okay to route matching requests to me." },
  { value: "limited", label: "Limited", description: "I may be able to help, but keep expectations light." },
  { value: "time-sensitive-capable", label: "Time-sensitive capable", description: "I can sometimes help when timing matters, with no obligation implied." },
  { value: "unavailable", label: "Unavailable", description: "Do not route new requests to me right now." },
];

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const data = await getDashboardData(session.accountId, session.activeGroupId ?? null);

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">

        <AlphaNotice />
        {notice && <Notice message={notice} />}

        {/* Hero / intro */}
        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Commons</h1>
          <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">
            Ask for help. Offer help. Keep it human.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
            <Shield className="h-3.5 w-3.5" />
            Help requests are shared only for coordination. Contribution summaries do not name who received help.
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">

          {/* Left: request + offer */}
          <div className="flex flex-col gap-6">

            <CollapsibleSection id="request" title="Request Help" eyebrow="Ask only what is needed" storageKey="dashboard:request">
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
                  <p className="mt-1 text-xs text-[var(--muted)]">You know best what level of trust you need.</p>
                </label>
                <label className="block">
                  <span className="field-label">Safe contact note</span>
                  <input name="contact" className="field-input" placeholder="Phone, email, or a safe way to reach you" required />
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
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
                    <span className="field-label inline-flex items-center gap-1"><MapPin className="h-4 w-4" />General area</span>
                    <input name="location" className="field-input" placeholder="Neighborhood or nearby area" />
                  </label>
                  <label className="block">
                    <span className="field-label inline-flex items-center gap-1"><Languages className="h-4 w-4" />Language</span>
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
                </label>
                <SubmitButton disabled={data.serviceOfferings.length === 0}>Ask for help</SubmitButton>
              </form>
            </CollapsibleSection>

            <CollapsibleSection id="offer" title="Offer Help" eyebrow="Set your own boundaries" storageKey="dashboard:offer">
              <form action={offerHelpAction} className="space-y-5">
                <p className="text-sm leading-6 text-[var(--soft-text)]">
                  Offering as <strong className="font-medium text-[var(--text)]">{data.account.displayName}</strong>. Choose only what feels realistic right now.
                </p>
                <fieldset>
                  <legend className="field-label">What can you help with?</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {data.serviceOfferings.map((offering) => (
                      <label key={offering.serviceType} className="flex min-h-11 items-center gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                        <input name="services" type="checkbox" value={offering.serviceType} className="h-4 w-4 accent-[#0d9488]" />
                        <span>{capitalize(offering.serviceType)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="field-label">Availability boundary</span>
                  <select name="availabilityPreference" className="field-input" defaultValue="available">
                    {availabilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <SubmitButton variant="secondary">Save what I can offer</SubmitButton>
              </form>
            </CollapsibleSection>

          </div>

          {/* Right: groups + routes + my requests */}
          <aside className="flex flex-col gap-6">

            {/* My Groups */}
            <CollapsibleSection id="groups" title="My Groups" eyebrow="Your coordination spaces" storageKey="dashboard:groups">
              {data.myGroups.length > 0 ? (
                <div className="space-y-3">
                  {data.myGroups.map((g) => (
                    <div key={g.groupId} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-[var(--text)]">{g.groupName}</p>
                          {g.description && <p className="mt-0.5 text-xs text-[var(--muted)] line-clamp-2">{g.description}</p>}
                        </div>
                        <a
                          href={`/groups/${g.groupId}`}
                          className="btn-secondary shrink-0 border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                        >
                          Open
                        </a>
                      </div>
                      <form action={leaveGroupAction} className="mt-2">
                        <input type="hidden" name="groupId" value={g.groupId} />
                        <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                          Leave {g.groupName}
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="You are not yet a member of any group." />
              )}
              {data.openGroups.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                  <p className="text-xs font-medium text-[var(--muted)]">Open groups you can join</p>
                  {data.openGroups.map((g) => (
                    <form key={g.id} action={joinGroupAction}>
                      <input type="hidden" name="groupId" value={g.id} />
                      <div className="border border-[var(--border)] bg-[var(--surface)] p-3">
                        <p className="text-sm font-medium">{g.name}</p>
                        {g.description && <p className="mt-1 text-xs text-[var(--muted)]">{g.description}</p>}
                        <div className="mt-3 flex gap-2">
                          <SubmitButton variant="secondary">
                            <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Join {g.name}</span>
                          </SubmitButton>
                        </div>
                      </div>
                    </form>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Notifications / routes */}
            <CollapsibleSection id="routes" title="Notifications" eyebrow="Requests you can help with" storageKey="dashboard:routes">
              <form action={routeOpenRequestsAction} className="mb-4">
                <SubmitButton variant="secondary">Check for matching requests</SubmitButton>
              </form>
              {data.routes.length > 0 ? (
                <div className="space-y-4">
                  {data.routes.map((route) => (
                    <RouteCard key={route.id} route={route} />
                  ))}
                </div>
              ) : (
                <EmptyState text="No pending requests have been routed to you." />
              )}
            </CollapsibleSection>

            {/* My Requests */}
            {data.myGroups.length > 0 && (
              <CollapsibleSection id="my-requests" title="My Requests" eyebrow="Requests you submitted" storageKey="dashboard:my-requests">
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
                        <li key={request.id} className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium capitalize">{request.requestType}</p>
                            <span className="shrink-0 text-xs text-[var(--muted)]">{statusLabel}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Submitted {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(request.createdAt)}
                          </p>
                          {(isActive || request.status !== "deleted") && (
                            <div className="mt-2 flex gap-2">
                              {request.status === "matched" && (
                                <form action={fulfillMyRequest}>
                                  <button type="submit" className="text-xs font-medium text-[var(--accent)] hover:underline">Mark help received</button>
                                </form>
                              )}
                              {request.status !== "fulfilled" && request.status !== "expired" && (
                                <form action={deleteMyRequest}>
                                  <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline">Delete</button>
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
                  Deleting a request removes it from active views. Contact details are removed after any accountability period.
                </p>
              </CollapsibleSection>
            )}

          </aside>
        </div>
      </div>
    </main>
  );
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function getDashboardData(accountId: string, groupId: string | null) {
  const prisma = createPrismaClient();
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const nodeId = account.homeNodeId;

    const [myGroupMemberships, serviceOfferings, openGroups, routes, myRequests] = await Promise.all([
      prisma.groupMembership.findMany({
        where: { accountId, status: "active" },
        orderBy: { joinedAt: "asc" },
        select: { groupId: true, group: { select: { name: true, description: true } } },
      }),
      prisma.groupServiceOffering.findMany({
        where: { status: "active", group: { nodeId } },
        distinct: ["serviceType"],
        orderBy: { serviceType: "asc" },
      }),
      prisma.group.findMany({
        where: {
          nodeId,
          membershipPolicy: "open",
          memberships: { none: { accountId, status: { in: ["active", "pending"] } } },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, description: true },
      }),
      prisma.requestRoute.findMany({
        where: { contributorAccountId: accountId },
        include: { contributor: true, supportRequest: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      groupId
        ? prisma.supportRequest.findMany({
            where: { submittedByAccountId: accountId, groupId, status: { notIn: ["deleted"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, requestType: true, status: true, createdAt: true, expiresAt: true, accountabilityEndsAt: true },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    return {
      account,
      myGroups: myGroupMemberships.map((m) => ({
        groupId: m.groupId,
        groupName: m.group.name,
        description: m.group.description,
      })),
      serviceOfferings,
      openGroups,
      routes: routes.map((route) => ({
        id: route.id,
        serviceType: route.serviceType,
        status: route.status,
        urgencyLabel: urgencyLabel(route.supportRequest.urgency),
        createdAtLabel: formatRelativeDate(route.createdAt),
      })),
      myRequests,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

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
    const openRequests = await prisma.supportRequest.findMany({ where: { status: "open", groupId }, select: { id: true } });
    for (const request of openRequests) await routeSupportRequest(prisma, { supportRequestId: request.id });
  } finally {
    await prisma.$disconnect();
  }
  redirect(`/groups/${groupId}`);
}

async function leaveGroupAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();
  try {
    await leaveGroup(prisma, session.accountId, groupId);
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
  revalidatePath("/dashboard");
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
    const offering = await prisma.groupServiceOffering.findFirst({ where: { groupId, serviceType, status: "active" }, select: { projectId: true } });
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
  if (services.length === 0) redirect("/dashboard?notice=Choose%20at%20least%20one%20kind%20of%20help%20before%20saving%20an%20offer.");
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
    for (const request of requests) await routeSupportRequest(prisma, { supportRequestId: request.id });
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
    const route = await prisma.requestRoute.findUniqueOrThrow({ where: { id: routeId }, select: { supportRequest: { select: { groupId: true } } } });
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
    const route = await prisma.requestRoute.findUniqueOrThrow({ where: { id: routeId }, select: { supportRequest: { select: { groupId: true } } } });
    await requireGroupMembership(prisma, session.accountId, route.supportRequest.groupId);
    const existing = await prisma.contribution.findFirst({ where: { privacyEnvelope: { path: ["requestRouteId"], equals: routeId } } });
    if (!existing) await createContributionFromAcceptedRoute(prisma, { routeId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
}

// ── Local Components ──────────────────────────────────────────────────────────

type ExperienceRoute = {
  id: string;
  serviceType: string;
  status: string;
  urgencyLabel: string;
  createdAtLabel: string;
};

function RouteCard({ route }: { route: ExperienceRoute }) {
  const accepted = route.status === "accepted";
  const declined = route.status === "declined";
  return (
    <article className="border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold capitalize">{route.serviceType} requested</h3>
          <p className="mt-1 text-sm text-[var(--soft-text)]">Routed to you. {route.urgencyLabel}</p>
        </div>
        <span className="border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">
          {route.status.replace("_", " ")}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[var(--soft-text)]">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          <span>Personal details stay private unless help is accepted.</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
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
                <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" />Accept</span>
              </SubmitButton>
            </form>
            <form action={decideRouteAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <input type="hidden" name="decision" value="declined" />
              <SubmitButton variant="secondary">
                <span className="inline-flex items-center gap-2"><X className="h-4 w-4" />Decline</span>
              </SubmitButton>
            </form>
          </>
        ) : null}
        {accepted ? (
          <form action={recordContributionAction}>
            <input type="hidden" name="routeId" value={route.id} />
            <SubmitButton>
              <span className="inline-flex items-center gap-2"><HeartHandshake className="h-4 w-4" />Mark as helped</span>
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {accepted && <p className="mt-3 text-sm leading-6 text-[var(--accent)]">Accepted. Coordinate privately, then mark help given when finished.</p>}
      {declined && <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Declined. That is okay; no contribution or judgment is recorded.</p>}
    </article>
  );
}

// ── Utilities ────────────────────────────────────────────────────────────────

function urgencyLabel(urgency: string) {
  if (urgency === "urgent") return "Time-sensitive, but not broadcast publicly.";
  if (urgency === "high") return "Today if possible.";
  return "Shared without pressure.";
}

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
