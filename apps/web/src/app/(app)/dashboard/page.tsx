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
  completeAcceptedRoute,
  createSupportRequest,
  decideRequestRoute,
  declareServiceCapability,
  markRouteUnreachable,
  routeSupportRequest,
} from "../../../lib/capability-routing";
import { leaveGroup, requireGroupMembership, withdrawGroupApplication } from "../../../lib/group-membership";
import { withdrawProjectJoinRequest } from "../../../lib/project-membership";
import { buildRequestDescription, capitalize, optionalString, requiredString, serviceTypeLabel } from "../../../lib/support-form";
import { deleteSupportRequest, fulfillSupportRequest, reopenSupportRequest, REQUEST_STATUS_LABELS } from "../../../lib/request-lifecycle";
import { addNodePetitionSupport, addPetitionSupport } from "../../../lib/petitions";
import { evaluateAndApplyPetition, getPetitionDetail } from "../../../lib/petition-evaluation";
import { resolveCurrentNode } from "../../../lib/node-context";
import { getNodeParticipationStatus } from "../../../lib/node-governance";
import { CollapsibleSection } from "../../../components/shared/CollapsibleSection";
import { LocalTime } from "../../../components/shared/LocalTime";
import { SubmitButton } from "../../../components/shared/SubmitButton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../components/shared/Notice";
import { RequestHelpForm, CUSTOM_REQUEST_LABEL } from "../../../components/shared/RequestHelpForm";
import type { GroupOption } from "../../../components/shared/RequestHelpForm";
import { getGroupsAvailableSupport } from "../../../lib/contribution-categories";
import { CONTACT_VIEWED_ACTION } from "../../../lib/request-access";
import {
  getNotificationPreferences,
  getDerivedNotifications,
  markCategoryRead,
  setNotificationPreferences,
  type DerivedNotif,
  type WatermarkCategory,
} from "../../../lib/notifications";
import { NotificationPreferencesForm } from "../../../components/shared/NotificationPreferencesForm";
import { NotificationFilters } from "../../../components/shared/NotificationFilters";
import { DashboardCalendar } from "../../../components/shared/DashboardCalendar";
import { loadDashboardCalendarData } from "../../../lib/calendar-data";
import { submitEvent, setInterest, cancelEvent, setCalendarFilterPreferences, getViewerSpaces } from "../../../lib/events";
import { parseEventSubmission, submitEventFailureMessage } from "../../../lib/event-form";
import type { FormState } from "../../../components/shared/form-state";
import type { EventInterestLevel } from "../../../generated/prisma/enums";
import { getUiDisclosurePreference, resolveEffectiveVisibility } from "../../../lib/ui-disclosure";
import { resolveHomeView } from "../../../lib/home-view";
import { isHomeModuleId, HOME_MODULE_IDS } from "../../../lib/home-modules";
import { hasCatchUpSince, getCatchUpDigest } from "../../../lib/catch-up";
import { CapabilityMap } from "../../../components/shared/CapabilityMap";
import { DisclosureBookmarkFallback } from "../../../components/shared/DisclosureBookmarkFallback";
import { ActiveThreads } from "./_modules/ActiveThreads";
import { CatchUp } from "./_modules/CatchUp";
import { MyProjects } from "./_modules/MyProjects";
import { MyPetitions } from "./_modules/MyPetitions";
import { MyConcerns } from "./_modules/MyConcerns";
import { MySeats } from "./_modules/MySeats";

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
  const myReqView: "made" | "accepted" = params.myReqView === "accepted" ? "accepted" : "made";
  const section = typeof params.section === "string" && isHomeModuleId(params.section) ? params.section : null;
  const data = await getDashboardData(session.accountId, session.activeGroupId ?? null, notifFilters, section);
  const present = data.present;
  const calendar = await loadDashboardCalendarData(session.accountId);
  const accountId = session.accountId;

  async function submitDashboardEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const input = parseEventSubmission(formData, { accountId: s.accountId, hostType: "account", hostId: s.accountId });
    const prisma = createPrismaClient();
    try {
      const result = await submitEvent(prisma, input);
      if (!result.ok) return { kind: "error", message: submitEventFailureMessage(result.reason) };
      revalidatePath("/dashboard");
      return { kind: "success", message: "Personal event added." };
    } finally {
      await prisma.$disconnect();
    }
  }

  async function eventInterestAction(formData: FormData) {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const raw = formData.get("level");
    const level: EventInterestLevel | null = raw === "planning_to_attend" || raw === "interested" ? raw : null;
    const eventId = typeof formData.get("eventId") === "string" ? (formData.get("eventId") as string) : "";
    const prisma = createPrismaClient();
    try {
      await setInterest(prisma, { accountId: s.accountId, eventId, level });
    } finally {
      await prisma.$disconnect();
    }
    revalidatePath("/dashboard");
  }

  async function eventCancelAction(formData: FormData) {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const eventId = typeof formData.get("eventId") === "string" ? (formData.get("eventId") as string) : "";
    const prisma = createPrismaClient();
    try {
      await cancelEvent(prisma, { accountId: s.accountId, eventId });
    } finally {
      await prisma.$disconnect();
    }
    revalidatePath("/dashboard");
  }

  async function setCalendarFilterAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const prisma = createPrismaClient();
    try {
      await setCalendarFilterPreferences(prisma, s.accountId, {
        showGroupEvents: formData.get("showGroupEvents") === "on",
        showProjectEvents: formData.get("showProjectEvents") === "on",
        showResponsibilityEvents: formData.get("showResponsibilityEvents") === "on",
        showCoalitionEvents: formData.get("showCoalitionEvents") === "on",
        showPersonalEvents: formData.get("showPersonalEvents") === "on",
      });
    } finally {
      await prisma.$disconnect();
    }
    revalidatePath("/dashboard");
    return { kind: "success", message: "Calendar filters updated." };
  }

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

        <DisclosureBookmarkFallback present={[...present]} validIds={[...HOME_MODULE_IDS]} />

        {/* ── Home map: everything you're part of, present or one switch away ── */}
        <CapabilityMap
          cards={data.disclosureCards}
          revealAll={data.revealAll}
          scope="home"
          scopeId="home"
          eyebrow="Your home"
          heading="Choose what features are visible"
          intro="Every part of your life across spaces is one switch away. Showing a section adds its card to your home; hiding tucks it back here. Your choices only change your own view."
        />

        {present.has("active-threads") && <ActiveThreads items={data.activeThreads} />}
        {present.has("catch-up") && <CatchUp digests={data.catchUp} />}

        {present.has("calendar") && (
          <DashboardCalendar
            events={calendar.events}
            myInterests={calendar.myInterests}
            filters={calendar.filters}
            currentAccountId={accountId}
            submitAction={submitDashboardEventAction}
            interestAction={eventInterestAction}
            cancelAction={eventCancelAction}
            filterAction={setCalendarFilterAction}
          />
        )}

        <div className="flex flex-col gap-6">

          {/* Request + Offer */}
          <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

            {present.has("request") && (
            <CollapsibleSection id="request" title="Request Support" eyebrow="Ask only what is needed" storageKey="dashboard:request" className="bg-[var(--surface)] p-5 sm:p-6">
              <RequestHelpForm
                groupOptions={data.groupOptions}
                allServices={data.requestServices}
                action={requestHelpAction}
              />
            </CollapsibleSection>
            )}

            {present.has("offer") && (
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

                {data.customOfferOptions.length > 0 && (
                  <fieldset>
                    <legend className="field-label">Custom requests</legend>
                    <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">
                      Opt in, per collective, to receive free-text custom requests. You only become reachable in the collectives you choose.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {data.customOfferOptions.map((opt) => (
                        <label key={opt.membershipId} className="flex min-h-11 items-center gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                          <input name="customMemberships" type="checkbox" value={opt.membershipId} defaultChecked={opt.customAvailable} className="h-4 w-4 accent-[#0d9488]" />
                          <span>Custom requests — {opt.groupName}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
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
            )}

          </div>

          {/* Groups + Notifications + My Requests */}
          <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

            {/* My Collectives — full card for members; a slim Find/Create on-ramp at zero
                collectives. `collectives` stays baseline (the way back home is always present),
                but an empty membership becomes a useful on-ramp rather than an empty shell. */}
            {present.has("collectives") && (
              data.myGroups.length > 0 ? (
                <CollapsibleSection id="collectives" title="My Collectives" eyebrow="Your coordination spaces" storageKey="dashboard:collectives" className="bg-[var(--surface)] p-5 sm:p-6">
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
                            Leave collective
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
                  <div className="mt-4 border-t border-[var(--border)] pt-4 flex items-center gap-4">
                    <Link href="/groups" className="text-xs font-medium text-[var(--accent)] hover:underline">
                      Find Collectives →
                    </Link>
                    <Link href="/groups/new" className="text-xs font-medium text-[var(--accent)] hover:underline">
                      Create Collective →
                    </Link>
                  </div>
                </CollapsibleSection>
              ) : (
                <div id="collectives" className="bg-[var(--surface)] p-5 sm:p-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm text-[var(--soft-text)]">Not part of a collective yet?</span>
                  <Link href="/groups" className="text-xs font-medium text-[var(--accent)] hover:underline">
                    Find Collectives →
                  </Link>
                  <Link href="/groups/new" className="text-xs font-medium text-[var(--accent)] hover:underline">
                    Create Collective →
                  </Link>
                </div>
              )
            )}

            {/* Notifications */}
            {present.has("notifications") && (
            <CollapsibleSection id="notifications" title="Notifications" eyebrow="Requests and updates" storageKey="dashboard:notifications" className="bg-[var(--surface)] p-5 sm:p-6">
              <NotificationFilters groups={data.myGroups.map((g) => ({ id: g.groupId, name: g.groupName }))} />

              {/* Per-category "N new · Mark read" for the read-state categories */}
              {(["aboutYou", "outcomes", "safety", "updates"] as const).some((c) => data.notifCounts[c] > 0) && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {(["aboutYou", "outcomes", "safety", "updates"] as const)
                    .filter((c) => data.notifCounts[c] > 0)
                    .map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--subtle)] px-2 py-0.5 text-xs text-[var(--soft-text)]">
                        {WATERMARK_CATEGORY_LABELS[c]} ({data.notifCounts[c]})
                        <form action={markCategoryReadAction}>
                          <input type="hidden" name="category" value={c} />
                          <button type="submit" className="text-[var(--accent)] hover:underline">Mark read</button>
                        </form>
                      </span>
                    ))}
                </div>
              )}

              <form action={routeOpenRequestsAction} className="mb-4">
                <SubmitButton variant="secondary">Check for matching requests</SubmitButton>
              </form>
              {data.notifications.length > 0 ? (
                // Cap the feed height so an active member's activity can't stretch the card
                // indefinitely; it scrolls internally. Filters above stay fixed and visible.
                <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
                  {data.notifications.map((notif) =>
                    notif.kind === "route" ? (
                      <RouteCard key={notif.id} route={notif} />
                    ) : notif.kind === "petition" ? (
                      <PetitionNotifCard key={notif.id} petition={notif} />
                    ) : (
                      <DerivedCard key={notif.id} notif={notif} />
                    ),
                  )}
                </div>
              ) : (
                <EmptyState text="No notifications." />
              )}

              {/* Durable settings — what you receive */}
              <details className="mt-5 border-t border-[var(--border)] pt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] select-none">Notification settings</summary>
                <div className="mt-3">
                  <NotificationPreferencesForm
                    prefs={{
                      enableRequests: data.notifPrefs.enableRequests,
                      enablePetitions: data.notifPrefs.enablePetitions,
                      enableOutcomes: data.notifPrefs.enableOutcomes,
                      enableSafety: data.notifPrefs.enableSafety,
                      enableUpdates: data.notifPrefs.enableUpdates,
                      rollUpUpdates: data.notifPrefs.rollUpUpdates,
                      mutedGroupIds: data.notifPrefs.mutedSpaces.group ?? [],
                    }}
                    groups={data.myGroups.map((g) => ({ id: g.groupId, name: g.groupName }))}
                    action={setNotificationPreferencesAction}
                  />
                </div>
              </details>
            </CollapsibleSection>
            )}

            {/* My projects */}
            {present.has("my-projects") && <MyProjects projects={data.myProjects} />}

            {/* My Requests */}
            {present.has("my-requests") && (
              <CollapsibleSection id="my-requests" title="My Requests" eyebrow="Requests you made and accepted" storageKey="dashboard:my-requests" className="bg-[var(--surface)] p-5 sm:p-6">
                {/* Toggle: requests you made vs. requests you've accepted from others */}
                <div className="mb-4 inline-flex border border-[var(--border)] text-xs font-medium">
                  <Link
                    href="/dashboard?myReqView=made#my-requests"
                    className={`px-3 py-1.5 ${myReqView === "made" ? "bg-[var(--accent)] text-[var(--accent-text)]" : "bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"}`}
                  >
                    You made
                  </Link>
                  <Link
                    href="/dashboard?myReqView=accepted#my-requests"
                    className={`border-l border-[var(--border)] px-3 py-1.5 ${myReqView === "accepted" ? "bg-[var(--accent)] text-[var(--accent-text)]" : "bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"}`}
                  >
                    You accepted
                  </Link>
                </div>

                {myReqView === "made" ? (
                  <>
                    {data.myRequests.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">No active requests.</p>
                    ) : (
                      <ul className="space-y-3">
                        {data.myRequests.map((request) => {
                          const statusLabel = REQUEST_STATUS_LABELS[request.status] ?? request.status;
                          const isActive = ["open", "routed", "matched"].includes(request.status);
                          const accessLog = data.contactAccessByRequest[request.id] ?? [];
                          // Reopen is offered only when the match broke: the contributor reported
                          // "unreachable" and no other route is still accepted (feedback #5).
                          const canReopen =
                            request.status === "matched" &&
                            !request.routes.some((r) => r.status === "accepted") &&
                            request.routes.some((r) => r.status === "unreachable");

                          async function fulfillMyRequest() {
                            "use server";
                            const s = await getSession();
                            if (!s.accountId) redirect("/login");
                            const p = createPrismaClient();
                            try { await fulfillSupportRequest(p, { supportRequestId: request.id, actorAccountId: s.accountId }); }
                            finally { await p.$disconnect(); }
                            revalidatePath("/dashboard");
                          }

                          async function reopenMyRequest() {
                            "use server";
                            const s = await getSession();
                            if (!s.accountId) redirect("/login");
                            const p = createPrismaClient();
                            try {
                              await reopenSupportRequest(p, { supportRequestId: request.id, actorAccountId: s.accountId });
                              await routeSupportRequest(p, { supportRequestId: request.id });
                            } finally { await p.$disconnect(); }
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
                                <p className="text-sm font-medium">
                                  {serviceTypeLabel(request.requestType, request.services[0]?.category?.name)}
                                </p>
                                <span className="shrink-0 text-xs text-[var(--muted)]">{statusLabel}</span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                Submitted <LocalTime value={request.createdAt.toISOString()} options={{ month: "short", day: "numeric" }} />
                              </p>
                              {canReopen && (
                                <p className="mt-2 border border-[var(--notice-border)] bg-[var(--notice)] px-2 py-1.5 text-xs text-[var(--notice-text)]">
                                  The member who accepted couldn&rsquo;t reach you. You can reopen this request to look for support again.
                                </p>
                              )}
                              {(isActive || request.status !== "deleted") && (
                                <div className="mt-2 flex gap-2">
                                  {canReopen && (
                                    <form action={reopenMyRequest}>
                                      <button type="submit" className="text-xs font-medium text-[var(--accent)] hover:underline">Reopen request</button>
                                    </form>
                                  )}
                                  {request.status === "matched" && !canReopen && (
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
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--text)] select-none">
                                  Who viewed your contact through Commons{accessLog.length > 0 ? ` (${accessLog.length})` : ""}
                                </summary>
                                <div className="mt-1 border-l border-[var(--border)] pl-3 text-xs text-[var(--soft-text)]">
                                  {accessLog.length === 0 ? (
                                    <p>No one has viewed your contact through Commons yet.</p>
                                  ) : (
                                    <ul className="space-y-1">
                                      {accessLog.map((entry, i) => (
                                        <li key={i}>
                                          {entry.accessorName} — <LocalTime value={entry.viewedAtIso} />
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <p className="mt-1 text-[var(--muted)]">
                                    This shows access through Commons. It cannot show someone reading the underlying database directly.
                                  </p>
                                </div>
                              </details>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      Deleting a request removes it from active views. Contact details are removed after any accountability period.
                    </p>
                  </>
                ) : (
                  <>
                    {data.acceptedRequests.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">You have not accepted any requests yet.</p>
                    ) : (
                      <ul className="space-y-3">
                        {data.acceptedRequests.map((r) => (
                          <li key={r.routeId} className="border border-[var(--border)] bg-[var(--surface)]">
                            <Link
                              href={`/requests/accepted/${r.routeId}`}
                              className="block px-4 py-3 hover:bg-[var(--hover)]"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-medium">
                                  {r.serviceType === "custom"
                                    ? `Custom Request${r.customNeed ? `: ${r.customNeed}` : ""}`
                                    : serviceTypeLabel(r.serviceType, r.categoryName)}
                                </p>
                                <span className="shrink-0 text-xs text-[var(--muted)]">{r.requestStatusLabel}</span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                {r.groupName}
                                {r.acceptedAtIso ? <> · accepted <LocalTime value={r.acceptedAtIso} /></> : null}
                              </p>
                              <p className="mt-1 text-xs text-[var(--accent)]">View contact &amp; coordinate →</p>
                            </Link>
                            <div className="flex gap-3 border-t border-[var(--border)] px-4 py-2">
                              <form action={recordContributionAction}>
                                <input type="hidden" name="routeId" value={r.routeId} />
                                <button type="submit" className="text-xs font-medium text-[var(--accent)] hover:underline">
                                  Mark support provided
                                </button>
                              </form>
                              <form action={markRouteUnreachableAction}>
                                <input type="hidden" name="routeId" value={r.routeId} />
                                <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline">
                                  Couldn&rsquo;t reach requester
                                </button>
                              </form>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-xs text-[var(--muted)]">Accepted requests are shown across all your collectives.</p>
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* My petitions / concerns / seats */}
            {present.has("my-petitions") && <MyPetitions petitions={data.myPetitions} />}
            {present.has("my-concerns") && <MyConcerns concerns={data.myConcerns} />}
            {present.has("my-seats") && <MySeats seats={data.mySeats} />}

            {/* My Pending Applications */}
            {present.has("applications") && (
              <CollapsibleSection id="applications" title="My Pending Applications" eyebrow="Membership requests you submitted" storageKey="dashboard:applications" className="bg-[var(--surface)] p-5 sm:p-6">
                <ul className="space-y-3">
                  {data.pendingApplications.map((app) => (
                    <li key={`${app.kind}:${app.id}`} className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={app.kind === "group" ? `/groups/${app.id}` : `/projects/${app.id}`}
                          className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]"
                        >
                          {app.name}
                        </a>
                        <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{app.kind === "group" ? "Collective" : "Project"}</span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Applied <LocalTime value={app.appliedIso} options={{ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} /> · pending review
                      </p>
                      <form action={withdrawApplicationAction} className="mt-2">
                        <input type="hidden" name="kind" value={app.kind} />
                        <input type="hidden" name="id" value={app.id} />
                        <button type="submit" className="text-xs text-amber-700 hover:text-amber-600 transition">Withdraw application</button>
                      </form>
                    </li>
                  ))}
                </ul>
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
  // For category requests: the resolved ContributionCategory name (serviceType is the
  // literal sentinel "category", never a display string).
  categoryName: string | null;
  // For custom requests: the requester's free-text need (shown as a secondary contribution type).
  // The contact note is NOT included here — it stays in the request description until acceptance.
  customNeed: string | null;
  status: string;
  urgencyLabel: string;
  createdAtIso: string;
  isUnread: boolean;
  createdAt: Date;
};

type PetitionNotif = {
  kind: "petition";
  id: string;
  groupId: string;
  groupName: string;
  membershipId: string;
  isNode: boolean;
  href: string;
  supportCount: number;
  closesAt: Date;
  isUnread: boolean;
  createdAt: Date;
};

type NotifItem = RouteNotif | PetitionNotif;

// Unified render item across the existing self-clearing categories (route/petition) and the
// derived watermark categories (outcomes/safety/updates/aboutYou).
type RenderNotif =
  | ({ category: "requests" } & RouteNotif)
  | ({ category: "petitions" } & PetitionNotif)
  | ({ kind: "derived" } & DerivedNotif);

// ── Data Loading ──────────────────────────────────────────────────────────────

async function getDashboardData(
  accountId: string,
  groupId: string | null,
  notifFilters: { unreadOnly: boolean; type: string; groupId: string | null },
  section: string | null,
) {
  const prisma = createPrismaClient();
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    // Memberships first — needed for petition + per-group queries
    const myGroupMemberships = await prisma.groupMembership.findMany({
      where: { accountId, status: "active" },
      orderBy: { joinedAt: "asc" },
      select: {
        id: true,
        groupId: true,
        customAvailable: true,
        group: { select: { name: true, description: true, visibility: true, acceptsCustomRequests: true } },
      },
    });
    const memberGroupIds = myGroupMemberships.map((m) => m.groupId);
    const membershipIdByGroup = Object.fromEntries(myGroupMemberships.map((m) => [m.groupId, m.id]));
    const currentNode = await resolveCurrentNode(prisma);
    const nodeParticipation = currentNode
      ? await getNodeParticipationStatus(prisma, currentNode.id, accountId)
      : null;

    // Parallel: services (from contribution categories), routes, petitions, per-group data, my requests
    const [groupCategories, routes, petitions, nodePetitions, trustedProviderGroups, myRequests] = await Promise.all([
      memberGroupIds.length > 0
        ? prisma.contributionCategory.findMany({
            where: { status: "active", groupId: { in: memberGroupIds } },
            select: { id: true, groupId: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      prisma.requestRoute.findMany({
        where: { contributorAccountId: accountId },
        include: {
          contributor: true,
          supportRequest: {
            include: {
              group: { select: { id: true, name: true } },
              services: { where: { serviceType: "category" }, select: { category: { select: { name: true } } }, take: 1 },
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 40,
      }),
      memberGroupIds.length > 0
        ? prisma.petition.findMany({
            // scopeType:"group" so project petitions (which carry the host collective's groupId
            // for back-compat) don't leak into a member's notifications / active threads.
            where: { groupId: { in: memberGroupIds }, scopeType: "group", status: "open" },
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
      currentNode && nodeParticipation === "active"
        ? prisma.petition.findMany({
            where: { scopeType: "node", scopeId: currentNode.id, status: "open" },
            include: {
              nodeSupport: { where: { accountId }, select: { id: true }, take: 1 },
              _count: { select: { nodeSupport: true } },
            },
            orderBy: { opensAt: "desc" },
            take: 20,
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
            select: {
              id: true,
              requestType: true,
              status: true,
              createdAt: true,
              expiresAt: true,
              accountabilityEndsAt: true,
              services: { where: { serviceType: "category" }, select: { category: { select: { name: true } } }, take: 1 },
              routes: { select: { status: true } },
            },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    // Requests this member has ACCEPTED from others (cross-group) — for the "accepted" tab.
    const acceptedRoutesRaw = await prisma.requestRoute.findMany({
      where: { contributorAccountId: accountId, status: "accepted" },
      orderBy: { decidedAt: "desc" },
      take: 20,
      select: {
        id: true,
        serviceType: true,
        decidedAt: true,
        supportRequest: {
          select: {
            requestType: true,
            status: true,
            customNeed: true,
            group: { select: { name: true } },
            services: { where: { serviceType: "category" }, select: { category: { select: { name: true } } }, take: 1 },
          },
        },
      },
    });
    const acceptedRequests = acceptedRoutesRaw.map((r) => ({
      routeId: r.id,
      serviceType: r.serviceType,
      categoryName: r.supportRequest.services[0]?.category?.name ?? null,
      customNeed: r.serviceType === "custom" ? r.supportRequest.customNeed ?? null : null,
      groupName: r.supportRequest.group.name,
      acceptedAtIso: r.decidedAt ? r.decidedAt.toISOString() : null,
      requestStatus: r.supportRequest.status,
      requestStatusLabel: REQUEST_STATUS_LABELS[r.supportRequest.status] ?? r.supportRequest.status,
    }));

    // Contact-access ledger for requests this member MADE: who viewed their contact through Commons.
    const madeIds = myRequests.map((r) => r.id);
    const accessRows = madeIds.length
      ? await prisma.actionLog.findMany({
          where: { action: CONTACT_VIEWED_ACTION, targetId: { in: madeIds } },
          select: { targetId: true, createdAt: true, actor: { select: { displayName: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const contactAccessByRequest: Record<string, { accessorName: string; viewedAtIso: string }[]> = {};
    for (const id of madeIds) contactAccessByRequest[id] = [];
    for (const row of accessRows) {
      (contactAccessByRequest[row.targetId] ??= []).push({
        accessorName: row.actor?.displayName ?? "A helper",
        viewedAtIso: row.createdAt.toISOString(),
      });
    }

    // Build unified notification list
    const routeNotifs: RouteNotif[] = routes.map((r) => ({
      kind: "route",
      id: r.id,
      groupId: r.supportRequest.groupId,
      groupName: r.supportRequest.group.name,
      serviceType: r.serviceType,
      categoryName: r.supportRequest.services[0]?.category?.name ?? null,
      customNeed: r.serviceType === "custom" ? r.supportRequest.customNeed ?? null : null,
      status: r.status,
      urgencyLabel: urgencyLabel(r.supportRequest.urgency),
      createdAtIso: r.createdAt.toISOString(),
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
        isNode: false,
        href: `/groups/${effectiveGroupId}#petitions`,
        supportCount: p._count.support,
        closesAt: p.closesAt,
        isUnread: p.support.length === 0,
        createdAt: p.opensAt,
      };
    });
    const nodePetitionNotifs: PetitionNotif[] = nodePetitions.map((p) => ({
      kind: "petition",
      id: p.id,
      groupId: currentNode?.id ?? p.scopeId,
      groupName: currentNode?.name ?? "Node",
      membershipId: "",
      isNode: true,
      href: "/node#petitions",
      supportCount: p._count.nodeSupport,
      closesAt: p.closesAt,
      isUnread: p.nodeSupport.length === 0,
      createdAt: p.opensAt,
    }));

    // Notification preferences + derived (non-self-clearing) notifications.
    const notifPrefs = await getNotificationPreferences(prisma, accountId);
    const derived = await getDerivedNotifications(prisma, accountId, notifPrefs);

    const merged: RenderNotif[] = [
      ...(notifPrefs.enableRequests ? routeNotifs.map((n) => ({ ...n, category: "requests" as const })) : []),
      ...(notifPrefs.enablePetitions ? [...petitionNotifs, ...nodePetitionNotifs].map((n) => ({ ...n, category: "petitions" as const })) : []),
      ...derived.items.map((n) => ({ kind: "derived" as const, ...n })),
    ];

    const cat = notifFilters.type;
    const notifications = merged
      .filter((n) => {
        if (cat !== "all" && n.category !== cat) return false;
        if (notifFilters.unreadOnly && !n.isUnread) return false;
        if (notifFilters.groupId && n.groupId !== notifFilters.groupId) return false;
        return true;
      })
      .sort((a, b) => {
        // Person-targeting "About you" pinned above broadcasts; then unread-first, then recent.
        const aAbout = a.category === "aboutYou" ? 1 : 0;
        const bAbout = b.category === "aboutYou" ? 1 : 0;
        if (aAbout !== bAbout) return bAbout - aAbout;
        if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    const trustedGroupIds = new Set(trustedProviderGroups.map((t) => t.groupId));
    // Support requests target PUBLIC groups only — private groups (even ones the user belongs to)
    // must not appear as request targets. "My Collectives" below still lists all member groups.
    const publicMemberGroupIds = myGroupMemberships
      .filter((m) => m.group.visibility === "public")
      .map((m) => m.groupId);
    const availableSupport = await getGroupsAvailableSupport(prisma, publicMemberGroupIds);

    const groupOptions: GroupOption[] = myGroupMemberships
      .filter((m) => m.group.visibility === "public")
      .map((m) => {
        const support = availableSupport.get(m.groupId) ?? { availableCategoryNames: [], custom: false };
        // Request form: only categories someone can fulfill, plus "Custom Request" when available.
        const services = [...support.availableCategoryNames, ...(support.custom ? [CUSTOM_REQUEST_LABEL] : [])];
        return {
          groupId: m.groupId,
          groupName: m.group.name,
          services,
          hasTrustedProviders: trustedGroupIds.has(m.groupId),
          acceptsCustom: support.custom,
        };
      });

    // Offer Support checkboxes: every category the member's groups define (members create the
    // availability, so the offer list must not be gated by it).
    const allServices = [...new Set(groupCategories.map((c) => c.name))].sort();
    // Request form: only fulfillable categories + custom where available (report 4/5 gating).
    const requestServices = [...new Set(groupOptions.flatMap((g) => g.services))].sort();

    // Per-collective custom-request opt-in options: collectives that accept custom requests.
    // Includes private collectives — their custom requests flow only through the token-gated
    // share-link path, never through public enumeration (feedback report #12).
    // Each option carries the member's own membershipId and current opt-in state (revocable consent).
    const customOfferOptions = myGroupMemberships
      .filter((m) => m.group.acceptsCustomRequests)
      .map((m) => ({ membershipId: m.id, groupName: m.group.name, customAvailable: m.customAvailable }));

    // Pending applications the user submitted (group + project) — so they can track and withdraw them.
    const [pendingGroupApps, pendingProjectApps] = await Promise.all([
      prisma.groupMembership.findMany({
        where: { accountId, status: "pending" },
        orderBy: { joinedAt: "desc" },
        select: { groupId: true, joinedAt: true, group: { select: { name: true } } },
      }),
      prisma.projectMembership.findMany({
        where: { accountId, status: "pending" },
        orderBy: { joinedAt: "desc" },
        select: { projectId: true, joinedAt: true, project: { select: { name: true } } },
      }),
    ]);
    const pendingApplications = [
      ...pendingGroupApps.map((m) => ({ kind: "group" as const, id: m.groupId, name: m.group.name, appliedIso: m.joinedAt.toISOString() })),
      ...pendingProjectApps.map((m) => ({ kind: "project" as const, id: m.projectId, name: m.project.name, appliedIso: m.joinedAt.toISOString() })),
    ];

    // ── Progressive disclosure: cheap cross-space facts → resolve which home cards are PRESENT, so
    // the heavy person-centric thread slices below load only when their card is shown. Reads
    // relational facts + the ?section signal + the user's switches — never participation.
    const viewerSpaces = await getViewerSpaces(prisma, accountId);
    const [filedConcernCount, partyPetitionCount, hasCatchUp, prefs] = await Promise.all([
      prisma.report.count({ where: { reportedByAccountId: accountId } }),
      prisma.petition.count({ where: { support: { some: { membership: { accountId } } }, scopeType: "group" } }),
      hasCatchUpSince(prisma, accountId),
      getUiDisclosurePreference(prisma, accountId),
    ]);
    const view = resolveHomeView(
      {
        viewer: viewerSpaces,
        hasMadeRequests: myRequests.length > 0 || acceptedRequests.length > 0,
        partyToPetition: partyPetitionCount > 0,
        filedConcern: filedConcernCount > 0,
        hasPendingApplications: pendingApplications.length > 0,
        hasCatchUp,
      },
      { section },
      prefs,
    );
    const present = view.present;
    const disclosureCards = view.cards.map((card) => ({
      ...card,
      transient: card.present && resolveEffectiveVisibility(card.id, "home", view.foreground, prefs) === "hide",
    }));

    // Active strip: YOUR OWN live commitments with a next step — drawn only from already-loaded
    // data (about-you items, requests you accepted, petitions you're party to). No counts/urgency.
    // Petition rows carry expandable details (feedback #2), resolved via getPetitionDetail.
    const petitionThreads = await Promise.all(
      petitions
        .filter((p) => p.support.length > 0)
        .map(async (p) => {
          const d = await getPetitionDetail(prisma, {
            subjectType: p.subjectType,
            subjectId: p.subjectId,
            status: p.status,
            createdByMembershipId: p.createdByMembershipId,
            createdByAccountId: p.createdByAccountId,
          });
          return {
            key: `pet:${p.id}`,
            kind: "petition" as const,
            label: `${capitalize(p.category)} petition`,
            detail: p.group?.name ?? null,
            href: `/groups/${p.groupId ?? p.scopeId}#petitions`,
            details: { outcome: d.outcome, proposer: d.proposer, fields: d.fields },
          };
        }),
    );
    const activeThreads = [
      ...derived.items
        .filter((n) => n.category === "aboutYou")
        .map((n) => ({ key: `about:${n.id}`, kind: "about" as const, label: n.title, detail: n.detail, href: n.href ?? "#routes" })),
      ...acceptedRequests
        // Compare raw status, not the display label (the fulfilled label is "Support
        // completed", so a label comparison would never match).
        .filter((r) => r.requestStatus !== "fulfilled")
        .map((r) => ({ key: `req:${r.routeId}`, kind: "request" as const, label: r.serviceType === "custom" ? `Custom request${r.customNeed ? `: ${r.customNeed}` : ""}` : capitalize(r.serviceType), detail: r.groupName, href: `/requests/accepted/${r.routeId}` })),
      ...petitionThreads,
    ];

    // Heavy person-centric thread slices — loaded only when their card is present.
    const projectIds = [...viewerSpaces.projectIds];
    const myProjects = present.has("my-projects") && projectIds.length
      ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } })
      : [];
    const myPetitions = present.has("my-petitions")
      ? await Promise.all(
          (await prisma.petition.findMany({
            // scopeType:"group" mirrors the group page — your group-petition involvement only.
            where: { support: { some: { membership: { accountId } } }, scopeType: "group", status: "open" },
            select: {
              id: true, category: true, groupId: true, scopeId: true, closesAt: true,
              subjectType: true, subjectId: true, status: true,
              createdByMembershipId: true, createdByAccountId: true,
              group: { select: { name: true } },
              createdBy: { select: { accountId: true } },
              support: { where: { membership: { accountId } }, select: { id: true }, take: 1 },
            },
            orderBy: { closesAt: "asc" },
            take: 25,
          })).map(async (p) => {
            const d = await getPetitionDetail(prisma, {
              subjectType: p.subjectType,
              subjectId: p.subjectId,
              status: p.status,
              createdByMembershipId: p.createdByMembershipId,
              createdByAccountId: p.createdByAccountId,
            });
            // Involvement computed positively (not by elimination): proposer if you created it,
            // supporter if you have a support record, otherwise no badge.
            const isProposer = p.createdBy?.accountId === accountId || p.createdByAccountId === accountId;
            const involvement = isProposer ? "You proposed" : p.support.length > 0 ? "You support" : null;
            return {
              id: p.id,
              label: `${capitalize(p.category)} petition`,
              groupName: p.group?.name ?? null,
              href: `/groups/${p.groupId ?? p.scopeId}#petitions`,
              closesAtIso: p.closesAt.toISOString(),
              involvement,
              outcome: d.outcome,
              proposer: d.proposer,
              detailFields: d.fields,
            };
          }),
        )
      : [];
    const myConcerns = present.has("my-concerns")
      ? (await prisma.report.findMany({
          where: { reportedByAccountId: accountId },
          select: { id: true, subject: true, status: true, groupId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 25,
        })).map((r) => ({ id: r.id, subject: r.subject, status: r.status, href: `/groups/${r.groupId}#concerns`, createdAtIso: r.createdAt.toISOString() }))
      : [];
    const mySeats = present.has("my-seats")
      ? (await prisma.responsibilityAssignment.findMany({
          where: { endedAt: null, expiresAt: { gt: new Date() }, membership: { accountId, status: "active" } },
          select: { id: true, expiresAt: true, responsibility: { select: { type: true, groupId: true, group: { select: { name: true } } } } },
          orderBy: { expiresAt: "asc" },
        })).map((a) => ({ id: a.id, type: a.responsibility.type, groupName: a.responsibility.group.name, href: `/groups/${a.responsibility.groupId}#responsibilities`, expiresAtIso: a.expiresAt.toISOString() }))
      : [];
    const catchUp = present.has("catch-up") ? await getCatchUpDigest(prisma, accountId) : [];

    return {
      account,
      myGroups: myGroupMemberships.map((m) => ({
        groupId: m.groupId,
        groupName: m.group.name,
        description: m.group.description,
      })),
      allServices,
      requestServices,
      groupOptions,
      customOfferOptions,
      acceptedRequests,
      contactAccessByRequest,
      notifications,
      notifCounts: derived.counts,
      notifPrefs,
      myRequests,
      pendingApplications,
      // progressive disclosure
      view,
      present,
      revealAll: prefs.revealAll,
      disclosureCards,
      activeThreads,
      myProjects,
      myPetitions,
      myConcerns,
      mySeats,
      catchUp,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────


async function withdrawApplicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const kind = formData.get("kind");
  const id = requiredString(formData, "id");
  const prisma = createPrismaClient();
  try {
    if (kind === "group") await withdrawGroupApplication(prisma, session.accountId, id);
    else if (kind === "project") await withdrawProjectJoinRequest(prisma, session.accountId, id);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
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
  const groupId = optionalString(formData, "groupId") ?? session.activeGroupId;
  if (!groupId) redirect("/dashboard?notice=Please+select+a+group");
  const isCustom = serviceType === "custom";
  const customNeed = (optionalString(formData, "customNeed") ?? "").trim();
  if (isCustom && !customNeed) redirect("/dashboard?notice=Please+describe+what+you+need");
  const prisma = createPrismaClient();
  try {
    await requireGroupMembership(prisma, session.accountId, groupId);
    // Resolve a chosen category name to its categoryId so category-based routing (gated on member
    // availability) applies; fall back to legacy string routing if no matching category.
    let categoryId: string | undefined;
    let resolvedServiceType = serviceType;
    if (!isCustom) {
      const category = await prisma.contributionCategory.findFirst({
        where: { groupId, name: serviceType, status: "active" },
        select: { id: true },
      });
      if (category) {
        categoryId = category.id;
        resolvedServiceType = "category";
      }
    }
    const request = await createSupportRequest(prisma, {
      submittedByAccountId: session.accountId,
      groupId,
      projectId: null,
      requestType: isCustom ? "custom" : resolvedServiceType,
      requestedServices: [{ serviceType: isCustom ? "custom" : resolvedServiceType, categoryId, trustRequirement: trustPreference }],
      description: buildRequestDescription({ contact, location, language }),
      customNeed: isCustom ? customNeed : null,
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
  const accountId = session.accountId;
  const services = formData.getAll("services").map(String).filter(Boolean);
  const checkedCustom = new Set(formData.getAll("customMemberships").map(String).filter(Boolean));
  const availabilityPreference = requiredString(formData, "availabilityPreference") as "unavailable" | "available" | "limited" | "time-sensitive-capable";
  const availableNow = availabilityPreference !== "unavailable";
  const prisma = createPrismaClient();
  let nothingToOffer = false;
  try {
    // The member's active memberships in collectives that accept custom requests — the set
    // the custom checkboxes were rendered from. Drives per-collective set/unset (revocable consent).
    // Private collectives are included: their custom availability is only ever consumed by the
    // token-gated share-link flow, so opting in leaks nothing publicly (feedback report #12).
    const customEligible = await prisma.groupMembership.findMany({
      where: { accountId, status: "active", group: { acceptsCustomRequests: true } },
      select: { id: true },
    });

    if (services.length === 0 && customEligible.length === 0) {
      nothingToOffer = true;
    } else {
      // Resolve each chosen category name to a categoryId within the member's groups, so the offer
      // links to the community-governed category and category-based routing can find it.
      if (services.length > 0) {
        const memberGroups = await prisma.groupMembership.findMany({
          where: { accountId, status: "active" },
          select: { groupId: true },
        });
        const memberGroupIds = memberGroups.map((m) => m.groupId);
        const categories = memberGroupIds.length
          ? await prisma.contributionCategory.findMany({
              where: { status: "active", groupId: { in: memberGroupIds }, name: { in: services } },
              select: { id: true, name: true },
            })
          : [];
        const categoryIdByName = new Map<string, string>();
        for (const c of categories) if (!categoryIdByName.has(c.name)) categoryIdByName.set(c.name, c.id);

        for (const serviceType of services) {
          await declareServiceCapability(prisma, {
            accountId,
            serviceType,
            trustRequirement: "lightweight",
            availability: { availableNow, preference: availabilityPreference },
            visibility: "group",
            categoryId: categoryIdByName.get(serviceType),
          });
        }
      }

      // Per-collective custom opt-in: enable for checked memberships, disable the rest.
      for (const m of customEligible) {
        const optIn = checkedCustom.has(m.id);
        await prisma.groupMembership.update({
          where: { id: m.id },
          data: optIn
            ? { customAvailable: true, customAvailability: { availableNow, preference: availabilityPreference } }
            : { customAvailable: false },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  if (nothingToOffer) redirect("/dashboard?notice=Choose%20at%20least%20one%20kind%20of%20support%20before%20saving%20an%20offer.");
  revalidatePath("/dashboard");
}

async function supportPetitionFromNotifAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const membershipId = (formData.get("membershipId") as string | null) ?? "";
  const scopeType = (formData.get("scopeType") as string | null) ?? "group";
  const prisma = createPrismaClient();
  try {
    if (scopeType === "node") {
      await addNodePetitionSupport(prisma, { petitionId, accountId: session.accountId });
    } else {
      await addPetitionSupport(prisma, { petitionId, actorAccountId: session.accountId, membershipId });
    }
    await evaluateAndApplyPetition(prisma, petitionId);
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

async function markCategoryReadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const category = requiredString(formData, "category");
  if (!["outcomes", "safety", "updates", "aboutYou"].includes(category)) return;
  const prisma = createPrismaClient();
  try {
    await markCategoryRead(prisma, session.accountId, category as WatermarkCategory);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
}

async function setNotificationPreferencesAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const flag = (name: string) => formData.get(name) === "on";
  const mutedGroupIds = formData.getAll("mutedGroup").map(String).filter(Boolean);
  const prisma = createPrismaClient();
  try {
    await setNotificationPreferences(prisma, session.accountId, {
      enableRequests: flag("enableRequests"),
      enablePetitions: flag("enablePetitions"),
      enableOutcomes: flag("enableOutcomes"),
      enableSafety: flag("enableSafety"),
      enableUpdates: flag("enableUpdates"),
      rollUpUpdates: flag("rollUpUpdates"),
      mutedSpaces: mutedGroupIds.length ? { group: mutedGroupIds } : {},
    });
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
    // Records the contribution (once) AND moves the route to `completed`, so the request
    // leaves the contributor's inbox (feedback #5).
    await completeAcceptedRoute(prisma, { routeId, contributorAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/dashboard");
}

async function markRouteUnreachableAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const routeId = requiredString(formData, "routeId");
  const prisma = createPrismaClient();
  try {
    const route = await prisma.requestRoute.findUniqueOrThrow({ where: { id: routeId }, select: { supportRequest: { select: { groupId: true } } } });
    await requireGroupMembership(prisma, session.accountId, route.supportRequest.groupId);
    await markRouteUnreachable(prisma, { routeId, contributorAccountId: session.accountId });
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
          {route.serviceType === "custom" ? (
            <h3 className="mt-0.5 font-semibold">Custom Request{route.customNeed ? `: ${route.customNeed}` : ""}</h3>
          ) : (
            <h3 className="mt-0.5 font-semibold">{serviceTypeLabel(route.serviceType, route.categoryName)} requested</h3>
          )}
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
          <span>Created <LocalTime value={route.createdAtIso} options={{ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} /></span>
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
          <>
            <Link
              href={`/requests/accepted/${route.id}`}
              className="btn-secondary inline-flex min-h-11 items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
            >
              <Shield className="h-4 w-4" aria-hidden="true" />
              View contact &amp; coordinate
            </Link>
            <form action={recordContributionAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <SubmitButton>
                <span className="inline-flex items-center gap-2"><HeartHandshake className="h-4 w-4" />Mark as supported</span>
              </SubmitButton>
            </form>
            <form action={markRouteUnreachableAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <SubmitButton variant="secondary">Couldn&rsquo;t reach requester</SubmitButton>
            </form>
          </>
        ) : null}
      </div>
      {accepted && <p className="mt-3 text-sm leading-6 text-[var(--accent)]">Accepted. Open “View contact &amp; coordinate” to reach the requester, then mark support given when finished — or let them know you couldn&rsquo;t reach them.</p>}
      {declined && <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Declined. That is okay; no contribution or judgment is recorded.</p>}
    </article>
  );
}

function PetitionNotifCard({ petition }: { petition: PetitionNotif }) {
  const closesLabel = <LocalTime value={petition.closesAt.toISOString()} options={{ month: "short", day: "numeric" }} />;
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
        {petition.isUnread && (petition.membershipId || petition.isNode) && (
          <form action={supportPetitionFromNotifAction}>
            <input type="hidden" name="petitionId" value={petition.id} />
            <input type="hidden" name="membershipId" value={petition.membershipId} />
            <input type="hidden" name="scopeType" value={petition.isNode ? "node" : "group"} />
            <SubmitButton variant="secondary">
              <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" />Support</span>
            </SubmitButton>
          </form>
        )}
        <a
          href={petition.href}
          className="inline-flex min-h-11 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
        >
          {petition.isNode ? "View node governance" : "View in group"} <span aria-hidden="true">-&gt;</span>
        </a>
      </div>
      {!petition.isUnread && <p className="mt-3 text-sm text-[var(--muted)]">You have already supported this petition.</p>}
    </article>
  );
}

const WATERMARK_CATEGORY_LABELS: Record<WatermarkCategory, string> = {
  aboutYou: "About you",
  outcomes: "Outcomes",
  safety: "Safety",
  updates: "Updates",
};

function DerivedCard({ notif }: { notif: DerivedNotif }) {
  const isAbout = notif.category === "aboutYou";
  return (
    <article className={`border p-4 ${isAbout ? "border-amber-400" : notif.isUnread ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {notif.isUnread && <span className="mr-2 text-xs font-semibold text-[var(--accent)]">New</span>}
          <h3 className="inline font-semibold">{notif.title}</h3>
          {notif.detail && <p className="mt-1 text-sm text-[var(--soft-text)]">{notif.detail}</p>}
        </div>
        <span className={`shrink-0 border px-2 py-1 text-xs font-medium ${isAbout ? "border-amber-400 text-amber-800" : "border-[var(--border)] bg-[var(--subtle)] text-[var(--soft-text)]"}`}>
          {WATERMARK_CATEGORY_LABELS[notif.category]}
        </span>
      </div>
      {notif.href && (
        <div className="mt-3">
          <a
            href={notif.href}
            className="inline-flex min-h-11 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
          >
            View <span aria-hidden="true">-&gt;</span>
          </a>
        </div>
      )}
    </article>
  );
}

// ── Utilities ────────────────────────────────────────────────────────────────

function urgencyLabel(urgency: string) {
  if (urgency === "urgent") return "Time-sensitive, but not broadcast publicly.";
  if (urgency === "high") return "Today if possible.";
  return "Shared without pressure.";
}
