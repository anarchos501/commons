import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { ProjectsModule } from "./_modules/projects";
import { CoalitionsModule } from "./_modules/coalitions";
import { NodeStewardshipModule } from "./_modules/node-stewardship";
import { ContributionCategoriesModule } from "./_modules/contribution-categories";
import { TrustedProvidersModule } from "./_modules/trusted-providers";
import { LibraryModule } from "./_modules/library";
import { DiscussionModule } from "./_modules/discussion";
import { ResponsibilitiesModule } from "./_modules/responsibilities";
import { ConcernsModule } from "./_modules/concerns";
import { PetitionsModule } from "./_modules/petitions";
import { MembersModule } from "./_modules/members";
import { GovernanceModule } from "./_modules/governance";
import { OverviewModule } from "./_modules/overview";
import { applyParticipationTransitions, getActiveParticipantCount, recordGroupPresence } from "../../../../lib/participation";
import { expireStaleAssignments, hasActiveEligibleAssignment } from "../../../../lib/responsibilities";
import { getCoverageStatus, autoCloseStaleWithdrawnConcerns } from "../../../../lib/concerns";
import { expireStaleContentDrafts } from "../../../../lib/content-creation-drafts";
import {
  ensureGeneralDiscussion,
  listDiscussionMessages,
  listDiscussionThreads,
} from "../../../../lib/discussions";
import {
  archiveStalePetitions,
  petitionFilterWhere,
  PETITION_FILTER_VALUES,
  type PetitionFilterValue,
} from "../../../../lib/petitions";
import { visibleGroupRosterAffiliations } from "../../../../lib/federation-legibility";
import { listNodeGroupLabelsForAccount } from "../../../../lib/node-privacy";
import {
  CATEGORY_REGISTRY,
  GOVERNANCE_CATEGORIES,
  resolveParameter,
} from "../../../../lib/governance-categories";
import { getActiveGroupInvitePreview } from "../../../../lib/group-invites";
import { computeAllParameterTemperatures } from "../../../../lib/governance-temperature";
import {
  resolveDuePetitionsForGroup,
  getPetitionDetail,
} from "../../../../lib/petition-evaluation";
import {
  getAvailableCategoriesForScope,
} from "../../../../lib/contribution-categories";
import {
  getTrustedProvidersForCategory,
} from "../../../../lib/trusted-providers";
import { Notice, AlphaNotice } from "../../../../components/shared/Notice";
import { GroupContextSync } from "../../../../components/shared/GroupContextSync";
import { type FormState } from "../../../../components/shared/form-state";
import { SpaceCalendar } from "../../../../components/shared/SpaceCalendar";
import { loadSpaceCalendarData } from "../../../../lib/calendar-data";
import { submitEvent, setInterest, cancelEvent } from "../../../../lib/events";
import { parseEventSubmission, submitEventFailureMessage } from "../../../../lib/event-form";
import type { EventInterestLevel } from "../../../../generated/prisma/enums";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ groupId: string }>; searchParams: Promise<Record<string, string | string[]>> };

export default async function GroupSpacePage({ params, searchParams }: PageProps) {
  const { groupId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;
  const VALID_ACTIVITY_FILTERS = ["week", "month", "3month", "6month", "all"];
  const activityFilter =
    typeof sp.activityFilter === "string" && VALID_ACTIVITY_FILTERS.includes(sp.activityFilter)
      ? sp.activityFilter
      : "month";
  const petitionFilter: PetitionFilterValue =
    typeof sp.petitionFilter === "string" && (PETITION_FILTER_VALUES as readonly string[]).includes(sp.petitionFilter)
      ? (sp.petitionFilter as PetitionFilterValue)
      : "all";

  const session = await getSession();
  if (!session.accountId) redirect("/login");


  const data = await getGroupSpaceData(session.accountId, groupId, selectedThreadId, activityFilter, petitionFilter);

  // Server action: update session.activeGroupId after confirmed membership.
  // Must be a server action (not inline code) because cookies can only be written
  // in Server Actions or Route Handlers, not in Server Component render functions.
  async function syncGroupContext() {
    "use server";
    const s = await getSession();
    if (s.accountId && s.activeGroupId !== groupId) {
      s.activeGroupId = groupId;
      await s.save();
    }
  }

  const { group, currentMembership } = data;
  const isActive = currentMembership?.participationStatus === "active";

  const calendar = await loadSpaceCalendarData(session.accountId, "group", groupId);

  async function submitGroupEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const input = parseEventSubmission(formData, { accountId: s.accountId, hostType: "group", hostId: groupId });
    const prisma = createPrismaClient();
    try {
      const result = await submitEvent(prisma, input);
      if (!result.ok) return { kind: "error", message: submitEventFailureMessage(result.reason) };
      revalidatePath(`/groups/${groupId}`);
      return { kind: "success", message: result.kind === "created" ? "Workshop scheduled." : "Event proposed — check Petitions." };
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
    revalidatePath(`/groups/${groupId}`);
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
    revalidatePath(`/groups/${groupId}`);
  }

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
      <GroupContextSync syncAction={syncGroupContext} />
      <AlphaNotice />
      {notice && <div className="mt-4"><Notice message={notice} /></div>}

      {/* ── Overview + Discussion (connected) ─────────────────────── */}
      <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
        <OverviewModule
          group={group}
          activeParticipantCount={data.activeParticipantCount}
          currentParticipationStatus={currentMembership?.participationStatus ?? null}
          groupContributions={data.groupContributions}
          activityFilter={activityFilter}
        />


        <DiscussionModule data={data} isActive={isActive} groupId={groupId} />
        {/* ══ Calendar ══════════════════════════════════════════════════ */}
        <SpaceCalendar
          sectionId="calendar"
          storageKey={`group:${groupId}:section:calendar`}
          events={calendar.events}
          myInterests={calendar.myInterests}
          audiences={calendar.audiences}
          canCreate={isActive}
          allowMeeting
          currentAccountId={session.accountId}
          submitAction={submitGroupEventAction}
          interestAction={eventInterestAction}
          cancelAction={eventCancelAction}
        />
        {/* ══ Library ═══════════════════════════════════════════════════ */}
        <LibraryModule data={data} isActive={isActive} groupId={groupId} />
      </div>{/* end top container */}

      <div className="mt-4 flex flex-col gap-6">

        {/* ══ Participation ═════════════════════════════════════════════ */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

        {/* ── Responsibilities ──────────────────────────────────────── */}
        <ResponsibilitiesModule
          responsibilityTypes={data.responsibilityTypes}
          myResponsibilityTypes={data.myResponsibilityTypes}
          currentMembershipId={currentMembership?.id}
          isActive={isActive}
          groupId={groupId}
        />

        {/* ── Projects ──────────────────────────────────────────────── */}
        <ProjectsModule projects={data.projects} isActive={isActive} groupId={groupId} />

        <CoalitionsModule data={data} isActive={isActive} groupId={groupId} />

        <NodeStewardshipModule nodeState={data.nodeState} nodeGroupOptions={data.nodeGroupOptions} nodeId={group.nodeId} isActive={isActive} groupId={groupId} />

        {/* ── Members ───────────────────────────────────────────────── */}
        <MembersModule
          data={data}
          currentParticipationStatus={currentMembership?.participationStatus ?? null}
          isActive={isActive}
          groupId={groupId}
        />

        </div>{/* end Participation */}

        {/* ══ Governance ════════════════════════════════════════════════ */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

        {/* ── Petitions ─────────────────────────────────────────────── */}
        <PetitionsModule
          petitions={data.petitions}
          petitionFilter={petitionFilter}
          isActive={isActive}
          currentMembershipId={currentMembership?.id ?? null}
          groupId={groupId}
        />

        {/* ── Concerns ──────────────────────────────────────────────── */}
        <ConcernsModule data={data} groupId={groupId} />

        {/* ── Contribution Categories ───────────────────────────────── */}
        <ContributionCategoriesModule data={data} isActive={isActive} groupId={groupId} />

        {/* ── Trusted Providers ─────────────────────────────────────── */}
        <TrustedProvidersModule contributionCategories={data.contributionCategories} isActive={isActive} groupId={groupId} />

        {/* ── Governance Settings ───────────────────────────────────── */}
        <GovernanceModule
          group={data.group}
          activeEmergency={data.activeEmergency}
          governanceSettings={data.governanceSettings}
          isActive={isActive}
          groupId={groupId}
        />

        </div>{/* end Governance + Accountability */}

      </div>
      </div>
    </main>
  );
}

// ── Data Loading ─────────────────────────────────────────────────────────────

function activityFilterCutoff(filter: string): Date | null {
  const days: Record<string, number> = { week: 7, month: 30, "3month": 90, "6month": 180 };
  const d = days[filter];
  if (!d) return null;
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date;
}

async function getGroupSpaceData(accountId: string, groupId: string, selectedThreadId: string | null, activityFilter = "month", petitionFilter: PetitionFilterValue = "all") {
  const prisma = createPrismaClient();
  try {
    await recordGroupPresence(prisma, accountId, groupId);
    await applyParticipationTransitions(prisma, groupId);
    await expireStaleAssignments(prisma, groupId);
    await resolveDuePetitionsForGroup(prisma, groupId);
    await archiveStalePetitions(prisma, groupId);
    await autoCloseStaleWithdrawnConcerns(prisma, groupId);
    await expireStaleContentDrafts(prisma, groupId);

    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

    const currentMembership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!currentMembership || currentMembership.status !== "active") {
      redirect("/dashboard");
    }

    const [nodeState, nodeGroupOptions] = await Promise.all([
      prisma.node.findUniqueOrThrow({
        where: { id: group.nodeId },
        select: { stewardGroupId: true },
      }),
      listNodeGroupLabelsForAccount(prisma, group.nodeId, accountId),
    ]);

    const [
      projects,
      coalitions,
      bulletins,
      publications,
      livingDocuments,
      myReports,
      openConcernCount,
      groupContributions,
      activeParticipantCount,
      pendingApplications,
    ] = await Promise.all([
      prisma.project.findMany({
        where: {
          hostings: { some: { groupId, endedAt: null } },
          status: { not: "closed" },
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          _count: { select: { hostings: { where: { endedAt: null } } } },
        },
      }),
      prisma.coalition.findMany({
        where: {
          status: "active",
          memberships: { some: { groupId, endedAt: null } },
        },
        select: {
          id: true,
          name: true,
          description: true,
          _count: { select: { memberships: { where: { endedAt: null } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.bulletin.findMany({
        where: { spaceType: "group", spaceId: groupId, archivedAt: null },
        include: { author: { select: { displayName: true } } },
        orderBy: { publishedAt: "desc" },
      }),
      prisma.publication.findMany({
        where: { spaceType: "group", spaceId: groupId, archivedAt: null },
        include: {
          creator: { select: { displayName: true } },
          _count: { select: { entries: { where: { archivedAt: null } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.livingDocument.findMany({
        where: { spaceType: "group", spaceId: groupId, archivedAt: null },
        orderBy: { lastRevisedAt: "desc" },
      }),
      prisma.report.findMany({
        where: { reportedByAccountId: accountId, groupId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, subject: true, context: true, description: true, status: true, closureReason: true, createdAt: true, kind: true,
          // Safe linked-request summary for request flags — NEVER the description (contact note).
          supportRequest: { select: { requestType: true, customNeed: true, status: true } },
        },
      }),
      prisma.report.count({
        where: { groupId, status: { in: ["open", "under_review", "findings_issued", "action_proposed"] } },
      }),
      prisma.contribution.groupBy({
        by: ["contributionType"],
        where: {
          groupId,
          visibility: "group",
          ...(activityFilterCutoff(activityFilter) ? { createdAt: { gte: activityFilterCutoff(activityFilter)! } } : {}),
        },
        _count: { contributionType: true },
        orderBy: { _count: { contributionType: "desc" } },
      }),
      getActiveParticipantCount(prisma, groupId),
      prisma.groupMembership.findMany({
        where: { groupId, status: "pending" },
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          joinedAt: true,
          applicationNote: true,
          account: { select: { displayName: true } },
        },
      }),
    ]);

    // Flag applicants that already have an open sponsorship petition so the UI can show
    // "Sponsorship petition open" instead of re-offering the Sponsor button (the DB unique
    // index Petition_membership_request_open_unique is the hard guarantee against duplicates).
    const openSponsorshipSubjectIds = new Set(
      pendingApplications.length > 0
        ? (
            await prisma.petition.findMany({
              where: {
                groupId,
                subjectType: "membership_request",
                status: "open",
                subjectId: { in: pendingApplications.map((a) => a.id) },
              },
              select: { subjectId: true },
            })
          ).map((p) => p.subjectId)
        : [],
    );
    const pendingApplicationsWithStatus = pendingApplications.map((a) => ({
      ...a,
      hasOpenSponsorship: openSponsorshipSubjectIds.has(a.id),
    }));

    // The acting member initiates for this group; every selected partner receives
    // an independent system-opened petition for its own electorate.
    // Offer only groups the acting member can already legitimately see (public, or private
    // groups they belong to). Private groups are never shown to non-members, so the coalition
    // form is not a discovery directory; a shared member bridges private–private coalitions by
    // initiating from within a group they belong to. (isPrivate = !(public || actor-is-member).)
    const eligibleCoalitionPartners =
      currentMembership.participationStatus === "active"
        ? nodeGroupOptions.filter((candidate) => candidate.id !== groupId && !candidate.isPrivate)
        : [];
    const joinableCoalitions =
      currentMembership.participationStatus === "active"
        ? await prisma.coalition.findMany({
            where: {
              nodeId: group.nodeId,
              status: "active",
              memberships: { none: { groupId, endedAt: null } },
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : [];

    // Petitions
    const petitionRows = await prisma.petition.findMany({
      where: { groupId, ...petitionFilterWhere(petitionFilter) },
      orderBy: [{ status: "asc" }, { closesAt: "asc" }],
      include: {
        _count: { select: { support: true } },
        support: { where: { membershipId: currentMembership.id }, select: { id: true }, take: 1 },
      },
      take: 12,
    });
    const petitions = await Promise.all(
      petitionRows.map(async (p) => {
        const snapshot = p.governanceSnapshot as { threshold?: number };
        const threshold = typeof snapshot.threshold === "number" ? snapshot.threshold : 1;
        const detail = await getPetitionDetail(prisma, {
          subjectType: p.subjectType,
          subjectId: p.subjectId,
          status: p.status,
          createdByMembershipId: p.createdByMembershipId,
          createdByAccountId: p.createdByAccountId,
        });
        return {
          id: p.id,
          subjectType: p.subjectType,
          subjectLabel: detail.summary,
          proposer: detail.proposer,
          outcome: detail.outcome,
          detailFields: detail.fields,
          status: p.status,
          closesAt: p.closesAt,
          resolvedAt: p.resolvedAt,
          supportCount: p._count.support,
          requiredSupport: Math.ceil(activeParticipantCount * threshold),
          supportedByCurrentMember: p.support.length > 0,
          createdByMembershipId: p.createdByMembershipId,
        };
      }),
    );

    // Governance — all 16 categories
    const currentSignals = await prisma.memberGovernanceSignal.findMany({
      where: { membershipId: currentMembership.id },
      select: { category: true, parameter: true, signal: true },
    });
    const signalMap = new Map(currentSignals.map((s) => [`${s.category}:${s.parameter}`, s.signal]));
    const governanceSettings = await Promise.all(
      GOVERNANCE_CATEGORIES.map(async (category) => {
        const temperatures = await computeAllParameterTemperatures(prisma, groupId, category);
        return {
          category,
          categorySignal: signalMap.get(`${category}:_`) ?? 0,
          temperature: temperatures.get("_") ?? 0,
          parameters: Object.keys(CATEGORY_REGISTRY[category]).map((parameter) => {
            const temperature = temperatures.get(parameter) ?? temperatures.get("_") ?? 0;
            return {
              name: parameter,
              value: resolveParameter(category, parameter, temperature),
              temperature,
              signal: signalMap.get(`${category}:${parameter}`) ?? signalMap.get(`${category}:_`) ?? 0,
              hasOwnSignal: signalMap.has(`${category}:${parameter}`),
            };
          }),
        };
      }),
    );

    // Emergency period
    const activeEmergency = await prisma.emergencyPeriod.findFirst({
      where: { groupId, endedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, startedAt: true, expiresAt: true },
    });

    // Discussion
    let discussionThreads = await listDiscussionThreads(prisma, { spaceType: "group", spaceId: groupId, groupId });
    if (discussionThreads.length === 0 && currentMembership.participationStatus === "active") {
      await ensureGeneralDiscussion(prisma, {
        spaceType: "group",
        spaceId: groupId,
        groupId,
        createdByMembershipId: currentMembership.id,
      });
      discussionThreads = await listDiscussionThreads(prisma, { spaceType: "group", spaceId: groupId, groupId });
    }
    const selectedThread =
      discussionThreads.find((t) => t.id === selectedThreadId) ?? discussionThreads[0] ?? null;
    const discussionMessages = selectedThread
      ? await listDiscussionMessages(prisma, selectedThread.id)
      : [];

    // Contribution categories
    const contributionCategories = await getAvailableCategoriesForScope(prisma, { groupId });
    const categoriesWithProviders = await Promise.all(
      contributionCategories.map(async (cat) => ({
        ...cat,
        trustedProviders: await getTrustedProvidersForCategory(prisma, { categoryId: cat.id, groupId }),
      })),
    );

    // Whether this group has any active contribution categories (used for auto-publicize warning)
    const activeCategoryCount = await prisma.contributionCategory.count({
      where: { groupId, status: "active" },
    });

    // Active invite preview (preview chars + expiry only — never the full token)
    const invitePreview = await getActiveGroupInvitePreview(prisma, groupId);

    // Projects for entity selector in category proposal form
    const allProjects = await prisma.project.findMany({
      where: { hostings: { some: { groupId, endedAt: null } }, status: "active", archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    // Members for trusted provider petition form and member roster
    const rawGroupMembers = await prisma.groupMembership.findMany({
      where: { groupId, status: "active" },
      select: {
        id: true,
        participationStatus: true,
        account: {
          select: {
            displayName: true,
            groupMemberships: {
              where: { status: "active", groupId: { not: groupId } },
              select: {
                group: { select: { id: true, name: true, privacyPreferences: true } },
              },
            },
          },
        },
      },
      orderBy: { account: { displayName: "asc" } },
    });
    const groupMembers = rawGroupMembers.map((membership) => ({
      id: membership.id,
      participationStatus: membership.participationStatus,
      account: { displayName: membership.account.displayName },
      affiliations: visibleGroupRosterAffiliations(
        membership.account.groupMemberships.map(({ group }) => group),
      ),
    }));

    // All responsibility types for the group
    const responsibilityTypes = await prisma.responsibility.findMany({
      where: { groupId },
      orderBy: { type: "asc" },
      select: {
        id: true,
        type: true,
        termDays: true,
        assignments: {
          where: { endedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, membershipId: true, expiresAt: true, membership: { select: { account: { select: { displayName: true } } } } },
        },
      },
    });
    const myResponsibilityTypes = new Set(
      responsibilityTypes
        .filter((r) => r.assignments.some((a) => a.membershipId === currentMembership.id))
        .map((r) => r.type),
    );

    // Reviewer queue
    const hasReviewerRole = await hasActiveEligibleAssignment(prisma, currentMembership.id, "reviewer");
    const reviewerQueue = hasReviewerRole
      ? await prisma.report.findMany({
          where: {
            groupId,
            status: { in: ["open", "under_review", "findings_issued", "action_proposed"] },
            reportedByAccountId: { not: accountId },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            subject: true,
            status: true,
            createdAt: true,
            kind: true,
            // Safe linked-request summary for request flags — NEVER the description (contact note).
            supportRequest: { select: { requestType: true, customNeed: true, status: true } },
            findings: { select: { outcome: true } },
            actionProposals: { select: { status: true } },
          },
        })
      : [];

    return {
      group,
      currentMembership,
      projects,
      coalitions,
      eligibleCoalitionPartners,
      joinableCoalitions,
      bulletins,
      publications,
      livingDocuments,
      myReports,
      openConcernCount,
      groupContributions: groupContributions.map((c) => ({ type: c.contributionType, count: c._count.contributionType })),
      petitions,
      governanceSettings,
      discussionThreads,
      selectedThread,
      discussionMessages,
      coverageStatus: await getCoverageStatus(prisma, groupId),
      reviewerQueue,
      activeParticipantCount,
      contributionCategories: categoriesWithProviders,
      allProjects,
      groupMembers,
      pendingApplications: pendingApplicationsWithStatus,
      activeEmergency,
      responsibilityTypes,
      myResponsibilityTypes,
      hasNoActiveCategories: activeCategoryCount === 0,
      invitePreview,
      nodeState,
      nodeGroupOptions,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

