import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Check,
  Clock,
  HeartHandshake,
  Shield,
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
import { leaveGroup, requireGroupMembership } from "../../../lib/group-membership";
import { buildRequestDescription, capitalize, optionalString, requiredString } from "../../../lib/support-form";
import { deleteSupportRequest, fulfillSupportRequest, REQUEST_STATUS_LABELS } from "../../../lib/request-lifecycle";
import { addPetitionSupport, evaluatePetition } from "../../../lib/petitions";
import { CollapsibleSection } from "../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../components/shared/SubmitButton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../components/shared/Notice";
import { RequestHelpForm } from "../../../components/shared/RequestHelpForm";
import type { GroupOption } from "../../../components/shared/RequestHelpForm";
import { NotificationFilters } from "../../../components/shared/NotificationFilters";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const availabilityOptions = [
  { value: "available", label: "Available", description: "It is okay to route matching requests to me." },
  { value: "limited", label: "Limited", description: "I may be able to provide support, but keep expectations light." },
  { value: "time-sensitive-capable", label: "Time-sensitive capable", description: "I can sometimes provide support when timing matters, with no obligation implied." },
  { value: "unavailable", label: "Unavailable", description: "Do not route new requests to me right now." },
];

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const notifFilters = {
    unreadOnly: params.notifUnread === "1",
    type: typeof params.notifType === "string" ? params.notifType : "all",
    groupId: typeof params.notifGroup === "string" ? params.notifGroup : null,
  };
  const data = await getDashboardData(session.accountId, session.activeGroupId ?? null, notifFilters);

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">

        <AlphaNotice />
        {notice && <Notice message={notice} />}

        {/* Hero / intro */}
        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Commons</h1>
          <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">
            Share. Collaborate. Connect.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
            <Shield className="h-3.5 w-3.5" />
            Support requests are shared only for coordination. Contribution summaries do not name who received support.
          </div>
        </div>

        <div className="flex flex-col gap-6">

          {/* Request + Offer */}
          <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

            <CollapsibleSection id="request" title="Request Support" eyebrow="Ask only what is needed" storageKey="dashboard:request" className="bg-[var(--surface)] p-5 sm:p-6">
              <RequestHelpForm
                groupOptions={data.groupOptions}
                allServices={data.allServices}
                action={requestHelpAction}
              />
            </CollapsibleSection>

            <CollapsibleSection id="offer" title="Offer Support" eyebrow="Set your own boundaries" storageKey="dashboard:offer" className="bg-[var(--surface)] p-5 sm:p-6">
              <form action={offerHelpAction} className="space-y-5">
                <p className="text-sm leading-6 text-[var(--soft-text)]">
                  Offering as <strong className="font-medium text-[var(--text)]">{data.account.displayName}</strong>. Choose only what feels realistic right now.
                </p>
                <fieldset>
                  <legend className="field-label">What can you offer support with?</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {data.allServices.map((serviceType) => (
                      <label key={serviceType} className="flex min-h-11 items-center gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                        <input name="services" type="checkbox" value={serviceType} className="h-4 w-4 accent-[#0d9488]" />
                        <span>{capitalize(serviceType)}</span>
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

          {/* Groups + Notifications + My Requests */}
          <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

            {/* My Groups */}
            <CollapsibleSection id="groups" title="My Groups" eyebrow="Your coordination spaces" storageKey="dashboard:groups" className="bg-[var(--surface)] p-5 sm:p-6">
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
                      <details className="mt-2">
                        <summary className="cursor-pointer list-none text-xs text-amber-700 hover:text-amber-600 transition select-none">
                          Leave group
                        </summary>
                        <div className="mt-2 border border-[var(--border)] bg-[var(--subtle)] p-3">
                          <p className="text-xs leading-5 text-[var(--soft-text)]">
                            Leaving will end your membership in {g.groupName}. You will need to reapply if you want to rejoin.
                          </p>
                          <form action={leaveGroupAction} className="mt-3">
                            <input type="hidden" name="groupId" value={g.groupId} />
                            <button type="submit" className="text-xs font-medium text-amber-700 hover:text-amber-600 transition">
                              Confirm — leave {g.groupName}
                            </button>
                          </form>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="You are not yet a member of any group." />
              )}
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <Link href="/groups" className="text-xs font-medium text-[var(--accent)] hover:underline">
                  Find Groups →
                </Link>
              </div>
            </CollapsibleSection>

            {/* Notifications */}
            <CollapsibleSection id="routes" title="Notifications" eyebrow="Requests and updates" storageKey="dashboard:routes" className="bg-[var(--surface)] p-5 sm:p-6">
              <NotificationFilters groups={data.myGroups.map((g) => ({ id: g.groupId, name: g.groupName }))} />
              <form action={routeOpenRequestsAction} className="mb-4">
                <SubmitButton variant="secondary">Check for matching requests</SubmitButton>
              </form>
              {data.notifications.length > 0 ? (
                <div className="space-y-4">
                  {data.notifications.map((notif) =>
                    notif.kind === "route"
                      ? <RouteCard key={notif.id} route={notif} />
                      : <PetitionNotifCard key={notif.id} petition={notif} />
                  )}
                </div>
              ) : (
                <EmptyState text="No notifications." />
              )}
            </CollapsibleSection>

            {/* My Requests */}
            {data.myGroups.length > 0 && (
              <CollapsibleSection id="my-requests" title="My Requests" eyebrow="Requests you submitted" storageKey="dashboard:my-requests" className="bg-[var(--surface)] p-5 sm:p-6">
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
                                  <button type="submit" className="text-xs font-medium text-[var(--accent)] hover:underline">Mark support received</button>
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

          </div>
        </div>
      </div>
    </main>
  );
}

// ── Notification types ────────────────────────────────────────────────────────

type RouteNotif = {
  kind: "route";
  id: string;
  groupId: string;
  groupName: string;
  serviceType: string;
  status: string;
  urgencyLabel: string;
  createdAtLabel: string;
  isUnread: boolean;
  createdAt: Date;
};

type PetitionNotif = {
  kind: "petition";
  id: string;
  groupId: string;
  groupName: string;
  membershipId: string;
  supportCount: number;
  closesAt: Date;
  isUnread: boolean;
  createdAt: Date;
};

type NotifItem = RouteNotif | PetitionNotif;

// ── Data Loading ──────────────────────────────────────────────────────────────

async function getDashboardData(
  accountId: string,
  groupId: string | null,
  notifFilters: { unreadOnly: boolean; type: string; groupId: string | null },
) {
  const prisma = createPrismaClient();
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    // Memberships first — needed for petition + per-group queries
    const myGroupMemberships = await prisma.groupMembership.findMany({
      where: { accountId, status: "active" },
      orderBy: { joinedAt: "asc" },
      select: { id: true, groupId: true, group: { select: { name: true, description: true } } },
    });
    const memberGroupIds = myGroupMemberships.map((m) => m.groupId);
    const membershipIdByGroup = Object.fromEntries(myGroupMemberships.map((m) => [m.groupId, m.id]));

    // Parallel: services (from contribution categories), routes, petitions, per-group data, my requests
    const [groupCategories, routes, petitions, trustedProviderGroups, myRequests] = await Promise.all([
      memberGroupIds.length > 0
        ? prisma.contributionCategory.findMany({
            where: { status: "active", groupId: { in: memberGroupIds } },
            select: { groupId: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      prisma.requestRoute.findMany({
        where: { contributorAccountId: accountId },
        include: {
          contributor: true,
          supportRequest: { include: { group: { select: { id: true, name: true } } } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 40,
      }),
      memberGroupIds.length > 0
        ? prisma.petition.findMany({
            where: { groupId: { in: memberGroupIds }, status: "open" },
            include: {
              group: { select: { id: true, name: true } },
              support: {
                where: { membership: { accountId } },
                select: { id: true },
                take: 1,
              },
              _count: { select: { support: true } },
            },
            orderBy: { opensAt: "desc" },
            take: 40,
          })
        : Promise.resolve([]),
      memberGroupIds.length > 0
        ? prisma.trustedProviderStatus.findMany({
            where: { groupId: { in: memberGroupIds }, status: "active" },
            select: { groupId: true },
            distinct: ["groupId"],
          })
        : Promise.resolve([]),
      groupId
        ? prisma.supportRequest.findMany({
            where: { submittedByAccountId: accountId, groupId, status: { notIn: ["deleted"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, requestType: true, status: true, createdAt: true, expiresAt: true, accountabilityEndsAt: true },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    // Build unified notification list
    const routeNotifs: RouteNotif[] = routes.map((r) => ({
      kind: "route",
      id: r.id,
      groupId: r.supportRequest.groupId,
      groupName: r.supportRequest.group.name,
      serviceType: r.serviceType,
      status: r.status,
      urgencyLabel: urgencyLabel(r.supportRequest.urgency),
      createdAtLabel: formatRelativeDate(r.createdAt),
      isUnread: r.status === "notified",
      createdAt: r.createdAt,
    }));

    const petitionNotifs: PetitionNotif[] = petitions.map((p) => {
      const effectiveGroupId = p.groupId ?? p.scopeId;
      return {
        kind: "petition",
        id: p.id,
        groupId: effectiveGroupId,
        groupName: p.group?.name ?? effectiveGroupId,
        membershipId: membershipIdByGroup[effectiveGroupId] ?? "",
        supportCount: p._count.support,
        closesAt: p.closesAt,
        isUnread: p.support.length === 0,
        createdAt: p.opensAt,
      };
    });

    const combined: NotifItem[] = [
      ...(notifFilters.type === "all" || notifFilters.type === "route" ? routeNotifs : []),
      ...(notifFilters.type === "all" || notifFilters.type === "petition" ? petitionNotifs : []),
    ];

    const notifications = combined
      .filter((n) => {
        if (notifFilters.unreadOnly && !n.isUnread) return false;
        if (notifFilters.groupId && n.groupId !== notifFilters.groupId) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.isUnread && !b.isUnread) return -1;
        if (!a.isUnread && b.isUnread) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    const trustedGroupIds = new Set(trustedProviderGroups.map((t) => t.groupId));
    const groupOptions: GroupOption[] = myGroupMemberships.map((m) => ({
      groupId: m.groupId,
      groupName: m.group.name,
      services: groupCategories.filter((c) => c.groupId === m.groupId).map((c) => c.name),
      hasTrustedProviders: trustedGroupIds.has(m.groupId),
    }));

    // Distinct category names across all member groups — for the Offer Support checkboxes
    const allServices = [...new Set(groupCategories.map((c) => c.name))].sort();

    return {
      account,
      myGroups: myGroupMemberships.map((m) => ({
        groupId: m.groupId,
        groupName: m.group.name,
        description: m.group.description,
      })),
      allServices,
      groupOptions,
      notifications,
      myRequests,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────


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
  const groupId = optionalString(formData, "groupId") ?? session.activeGroupId;
  if (!groupId) redirect("/dashboard?notice=Please+select+a+group");
  const prisma = createPrismaClient();
  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    const request = await createSupportRequest(prisma, {
      submittedByAccountId: session.accountId,
      groupId,
      projectId: null,
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
  if (services.length === 0) redirect("/dashboard?notice=Choose%20at%20least%20one%20kind%20of%20support%20before%20saving%20an%20offer.");
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

async function supportPetitionFromNotifAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const membershipId = requiredString(formData, "membershipId");
  const prisma = createPrismaClient();
  try {
    await addPetitionSupport(prisma, { petitionId, membershipId });
    await evaluatePetition(prisma, petitionId);
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

function RouteCard({ route }: { route: RouteNotif }) {
  const accepted = route.status === "accepted";
  const declined = route.status === "declined";
  return (
    <article className={`border p-4 ${route.isUnread ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted)]">{route.groupName}</span>
            {route.isUnread && <span className="text-xs font-semibold text-[var(--accent)]">New</span>}
          </div>
          <h3 className="mt-0.5 font-semibold capitalize">{route.serviceType} requested</h3>
          <p className="mt-1 text-sm text-[var(--soft-text)]">Routed to you. {route.urgencyLabel}</p>
        </div>
        <span className="border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">
          {route.status.replace("_", " ")}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[var(--soft-text)]">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          <span>Personal details stay private unless support is accepted.</span>
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
              <span className="inline-flex items-center gap-2"><HeartHandshake className="h-4 w-4" />Mark as supported</span>
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {accepted && <p className="mt-3 text-sm leading-6 text-[var(--accent)]">Accepted. Coordinate privately, then mark support given when finished.</p>}
      {declined && <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Declined. That is okay; no contribution or judgment is recorded.</p>}
    </article>
  );
}

function PetitionNotifCard({ petition }: { petition: PetitionNotif }) {
  const closesLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(petition.closesAt);
  return (
    <article className={`border p-4 ${petition.isUnread ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted)]">{petition.groupName}</span>
            {petition.isUnread && <span className="text-xs font-semibold text-[var(--accent)]">New</span>}
          </div>
          <h3 className="mt-0.5 font-semibold">Open petition</h3>
          <p className="mt-1 text-sm text-[var(--soft-text)]">
            {petition.supportCount} {petition.supportCount === 1 ? "supporter" : "supporters"} · closes {closesLabel}
          </p>
        </div>
        <span className="border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs font-medium text-[var(--soft-text)]">
          Petition
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {petition.isUnread && petition.membershipId && (
          <form action={supportPetitionFromNotifAction}>
            <input type="hidden" name="petitionId" value={petition.id} />
            <input type="hidden" name="membershipId" value={petition.membershipId} />
            <SubmitButton variant="secondary">
              <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" />Support</span>
            </SubmitButton>
          </form>
        )}
        <a
          href={`/groups/${petition.groupId}#petitions`}
          className="inline-flex min-h-11 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
        >
          View in group →
        </a>
      </div>
      {!petition.isUnread && <p className="mt-3 text-sm text-[var(--muted)]">You have already supported this petition.</p>}
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
