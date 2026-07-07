import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type {
  EventCategory,
  EventHostType,
  EventInterestLevel,
  EventVisibility,
} from "../generated/prisma/enums";
import { logAction } from "./action-log";
import { assertProjectWritable } from "./project-membership";
import { requireCoalitionParticipant } from "./coalition-authorization";
import { requireResponsibilityHolderMembership } from "./responsibilities";
import { evaluatePetition, openPetition, openSystemGroupPetition } from "./petitions";

// RFC-008: Coordination Events & Shared Calendars
//
// Two event categories — Meeting (always authorized) and Workshop (authorized only
// when it reaches beyond its host). Authorization is triggered by whether the host
// space acts as a body, modeled via cross-space audience scope. See
// eventRequiresAuthorization below. Petitioned events (Meetings + cross-space
// Workshops) mirror the coalition multi-petition flow: one child petition per
// governing group, applied only when all approve. Interest is count-only — the
// responder identity is never surfaced.

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type AudienceInput = { audienceType: EventHostType; audienceId: string };

export type SubmitEventInput = {
  accountId: string;
  category: EventCategory;
  hostType: EventHostType;
  hostId: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location?: string | null;
  visibility: EventVisibility;
  audiences?: AudienceInput[];
};

export type SubmitEventResult =
  | { ok: true; kind: "created"; eventId: string }
  | { ok: true; kind: "proposed"; proposalId: string; petitionIds: string[] }
  | { ok: false; reason: string };

export type EventInterestCounts = { planning_to_attend: number; interested: number };

export type CalendarEventView = {
  id: string;
  category: EventCategory;
  hostType: EventHostType;
  hostId: string;
  hostLabel: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location: string | null;
  visibility: EventVisibility;
  audiences: AudienceInput[];
  interestCounts: EventInterestCounts;
  authorizingPetitionId: string | null;
  createdByAccountId: string;
  canceledAt: Date | null;
};

/** Serializable form of CalendarEventView for passing to client components (Dates → ISO strings). */
export type CalendarEventClientView = Omit<CalendarEventView, "startTime" | "endTime" | "canceledAt"> & {
  startTime: string;
  endTime: string;
  canceledAt: string | null;
};

export function serializeEvents(views: CalendarEventView[]): CalendarEventClientView[] {
  return views.map((v) => ({
    ...v,
    startTime: v.startTime.toISOString(),
    endTime: v.endTime.toISOString(),
    canceledAt: v.canceledAt ? v.canceledAt.toISOString() : null,
  }));
}

export type ResolvedCalendarFilters = {
  showGroupEvents: boolean;
  showProjectEvents: boolean;
  showResponsibilityEvents: boolean;
  showCoalitionEvents: boolean;
  showPersonalEvents: boolean;
  spaceFilters: Partial<Record<EventHostType, string[]>> | null;
};

export type EvaluateEventProposalResult =
  | { outcome: "succeeded"; eventId: string }
  | { outcome: "failed-rejected" | "failed-withdrawn" | "failed-timeout" }
  | { outcome: "pending" };

const HOST_TYPES: EventHostType[] = ["group", "project", "responsibility", "coalition", "account"];

// ── Authorization predicate (single source of truth) ──────────────────────────

/**
 * A petition in the host space is required when the host acts as a collective body:
 * always for Meetings, and for Workshops whose audience reaches beyond the host.
 * Personal (account-hosted) events never need consent. `externalAudienceCount` is the
 * number of audience spaces other than the host itself.
 */
export function eventRequiresAuthorization(
  category: EventCategory,
  hostType: EventHostType,
  externalAudienceCount: number,
): boolean {
  if (hostType === "account") return false;
  if (category === "meeting") return true;
  return externalAudienceCount > 0;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validateEventInput(opts: SubmitEventInput): string | null {
  if (!opts.title || !opts.title.trim()) return "missing_title";
  if (!(opts.startTime instanceof Date) || Number.isNaN(opts.startTime.getTime())) return "invalid_start";
  if (!(opts.endTime instanceof Date) || Number.isNaN(opts.endTime.getTime())) return "invalid_end";
  if (opts.endTime <= opts.startTime) return "invalid_time_range";
  if (!opts.timezone || !isValidTimezone(opts.timezone)) return "invalid_timezone";
  return null;
}

/** Drops account-typed audiences, the host itself, and duplicates. */
function normalizeAudiences(
  audiences: AudienceInput[],
  hostType: EventHostType,
  hostId: string,
): AudienceInput[] {
  const seen = new Set<string>();
  const out: AudienceInput[] = [];
  for (const a of audiences) {
    if (a.audienceType === "account") continue; // account is never an audience
    if (a.audienceType === hostType && a.audienceId === hostId) continue; // host self is implicit
    const key = `${a.audienceType}:${a.audienceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ audienceType: a.audienceType, audienceId: a.audienceId });
  }
  return out;
}

function parseAudienceJson(json: unknown): AudienceInput[] {
  if (!Array.isArray(json)) return [];
  const out: AudienceInput[] = [];
  for (const item of json) {
    if (item && typeof item === "object") {
      const at = (item as Record<string, unknown>).audienceType;
      const ai = (item as Record<string, unknown>).audienceId;
      if (typeof at === "string" && typeof ai === "string" && HOST_TYPES.includes(at as EventHostType)) {
        out.push({ audienceType: at as EventHostType, audienceId: ai });
      }
    }
  }
  return out;
}

// ── Host authorization (who may act in the host space) ────────────────────────

type HostAuth = {
  hostType: EventHostType;
  accountId: string;
  groupMembershipId?: string; // group / responsibility hosts
  projectMembershipId?: string; // project host
  projectId?: string; // project host
  governingGroupId?: string; // group: hostId; project: foundingGroupId; responsibility: owning group
};

/**
 * Resolves the caller's right to act in a host space from the authenticated
 * accountId, returning the membership identity needed to open petitions. Throws if
 * the caller is not an active member/holder/participant of the host.
 */
async function assertEventHostAuthorization(
  prisma: PrismaClient,
  accountId: string,
  hostType: EventHostType,
  hostId: string,
): Promise<HostAuth> {
  if (hostType === "group") {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId: hostId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      throw new Error("Active group membership required.");
    }
    return { hostType, accountId, groupMembershipId: membership.id, governingGroupId: hostId };
  }

  if (hostType === "project") {
    await assertProjectWritable(prisma, hostId);
    const project = await prisma.project.findUnique({
      where: { id: hostId },
      select: { foundingGroupId: true },
    });
    if (!project) throw new Error("Project not found.");
    const membership = await prisma.projectMembership.findUnique({
      where: { accountId_projectId: { accountId, projectId: hostId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      throw new Error("Active project membership required.");
    }
    return {
      hostType,
      accountId,
      projectMembershipId: membership.id,
      projectId: hostId,
      governingGroupId: project.foundingGroupId,
    };
  }

  if (hostType === "responsibility") {
    const holder = await requireResponsibilityHolderMembership(prisma, accountId, hostId);
    return {
      hostType,
      accountId,
      groupMembershipId: holder.membership.id,
      governingGroupId: holder.responsibility.groupId,
    };
  }

  if (hostType === "coalition") {
    await requireCoalitionParticipant(prisma, accountId, hostId);
    return { hostType, accountId };
  }

  // account (personal)
  if (hostId !== accountId) {
    throw new Error("You may only host personal events for your own account.");
  }
  return { hostType, accountId };
}

// ── Audience connectivity (a space cannot schedule for unrelated spaces) ───────

/**
 * Whether the audience space is legitimately connected to the host, using the same
 * joins as assertSpaceBelongsToGroup (ProjectHosting, Responsibility.groupId,
 * CoalitionMembership). The host is always a valid audience for itself.
 */
async function assertAudienceConnectivity(
  prisma: PrismaLike,
  hostType: EventHostType,
  hostId: string,
  audienceType: EventHostType,
  audienceId: string,
): Promise<boolean> {
  if (audienceType === "account") return false; // never a valid audience
  if (audienceType === hostType && audienceId === hostId) return true;

  if (hostType === "account") return false; // personal events have no audience

  if (hostType === "group") {
    if (audienceType === "project") {
      const hosting = await prisma.projectHosting.findFirst({
        where: { projectId: audienceId, groupId: hostId, endedAt: null },
        select: { id: true },
      });
      return hosting !== null;
    }
    if (audienceType === "responsibility") {
      const r = await prisma.responsibility.findUnique({ where: { id: audienceId }, select: { groupId: true } });
      return r?.groupId === hostId;
    }
    if (audienceType === "coalition") {
      const m = await prisma.coalitionMembership.findFirst({
        where: { coalitionId: audienceId, groupId: hostId, endedAt: null, coalition: { status: "active" } },
        select: { id: true },
      });
      return m !== null;
    }
    return false; // group → unrelated group
  }

  if (hostType === "project") {
    if (audienceType === "group") {
      const hosting = await prisma.projectHosting.findFirst({
        where: { projectId: hostId, groupId: audienceId, endedAt: null },
        select: { id: true },
      });
      return hosting !== null;
    }
    return false;
  }

  if (hostType === "responsibility") {
    if (audienceType === "group") {
      const r = await prisma.responsibility.findUnique({ where: { id: hostId }, select: { groupId: true } });
      return r?.groupId === audienceId;
    }
    return false;
  }

  if (hostType === "coalition") {
    if (audienceType === "group") {
      const m = await prisma.coalitionMembership.findFirst({
        where: { coalitionId: hostId, groupId: audienceId, endedAt: null, coalition: { status: "active" } },
        select: { id: true },
      });
      return m !== null;
    }
    return false;
  }

  return false;
}

// ── Orchestrator + two paths ──────────────────────────────────────────────────

/** Single entry point: validates, then routes to direct-create or the petition flow. */
export async function submitEvent(prisma: PrismaClient, opts: SubmitEventInput): Promise<SubmitEventResult> {
  const err = validateEventInput(opts);
  if (err) return { ok: false, reason: err };
  if (opts.category === "meeting" && opts.hostType === "account") {
    return { ok: false, reason: "meeting_requires_collective" };
  }
  const external = normalizeAudiences(opts.audiences ?? [], opts.hostType, opts.hostId);
  if (eventRequiresAuthorization(opts.category, opts.hostType, external.length)) {
    const result = await proposeEvent(prisma, { ...opts, audiences: external });
    if (!result.ok) return result;
    return { ok: true, kind: "proposed", proposalId: result.proposalId, petitionIds: result.petitionIds };
  }
  const result = await createWorkshop(prisma, { ...opts, audiences: external });
  if (!result.ok) return result;
  return { ok: true, kind: "created", eventId: result.eventId };
}

/** Direct create — no petition. Rejects anything that requires authorization. */
export async function createWorkshop(
  prisma: PrismaClient,
  opts: SubmitEventInput,
): Promise<{ ok: true; eventId: string } | { ok: false; reason: string }> {
  const err = validateEventInput(opts);
  if (err) return { ok: false, reason: err };
  const external = normalizeAudiences(opts.audiences ?? [], opts.hostType, opts.hostId);
  if (eventRequiresAuthorization(opts.category, opts.hostType, external.length)) {
    return { ok: false, reason: "requires_authorization" };
  }
  // Only reachable here: account host (audiences must be empty) or a space workshop
  // with no external audience. A personal event with audiences is invalid.
  if (external.length > 0) return { ok: false, reason: "audience_not_connected" };

  const auth = await assertEventHostAuthorization(prisma, opts.accountId, opts.hostType, opts.hostId);
  const event = await prisma.calendarEvent.create({
    data: {
      category: "workshop",
      hostType: opts.hostType,
      hostId: opts.hostId,
      title: opts.title.trim(),
      description: opts.description?.trim() || null,
      startTime: opts.startTime,
      endTime: opts.endTime,
      timezone: opts.timezone,
      location: opts.location?.trim() || null,
      visibility: opts.visibility,
      createdByAccountId: opts.accountId,
      authorizingPetitionId: null,
    },
  });
  await logAction(prisma, {
    actorAccountId: opts.accountId,
    groupId: auth.governingGroupId ?? null,
    projectId: opts.hostType === "project" ? opts.hostId : null,
    action: "workshop.created",
    targetType: "calendar_event",
    targetId: event.id,
    metadata: { hostType: opts.hostType, hostId: opts.hostId },
  });
  return { ok: true, eventId: event.id };
}

/** Opens petition(s) for an event needing collective consent (Meeting or cross-space Workshop). */
export async function proposeEvent(
  prisma: PrismaClient,
  opts: SubmitEventInput,
): Promise<{ ok: true; proposalId: string; petitionIds: string[] } | { ok: false; reason: string }> {
  const err = validateEventInput(opts);
  if (err) return { ok: false, reason: err };
  if (opts.hostType === "account") return { ok: false, reason: "meeting_requires_collective" };
  const external = normalizeAudiences(opts.audiences ?? [], opts.hostType, opts.hostId);
  if (!eventRequiresAuthorization(opts.category, opts.hostType, external.length)) {
    return { ok: false, reason: "no_authorization_needed" };
  }
  for (const a of external) {
    const connected = await assertAudienceConnectivity(prisma, opts.hostType, opts.hostId, a.audienceType, a.audienceId);
    if (!connected) return { ok: false, reason: "audience_not_connected" };
  }

  const auth = await assertEventHostAuthorization(prisma, opts.accountId, opts.hostType, opts.hostId);

  // Determine the governing group(s) whose electorate must consent.
  let governingGroupIds: string[];
  let participantSnapshot: Prisma.InputJsonValue | undefined;
  if (opts.hostType === "coalition") {
    const memberships = await prisma.coalitionMembership.findMany({
      where: { coalitionId: opts.hostId, endedAt: null, coalition: { status: "active" } },
      select: { groupId: true },
    });
    governingGroupIds = [...new Set(memberships.map((m) => m.groupId))].sort();
    if (governingGroupIds.length === 0) return { ok: false, reason: "coalition_has_no_members" };
    participantSnapshot = { capturedAt: new Date().toISOString(), groupIds: governingGroupIds };
  } else {
    governingGroupIds = [auth.governingGroupId!];
  }

  const proposal = await prisma.eventProposal.create({
    data: {
      category: opts.category,
      hostType: opts.hostType,
      hostId: opts.hostId,
      title: opts.title.trim(),
      description: opts.description?.trim() || null,
      startTime: opts.startTime,
      endTime: opts.endTime,
      timezone: opts.timezone,
      location: opts.location?.trim() || null,
      visibility: opts.visibility,
      audienceJson: external as unknown as Prisma.InputJsonValue,
      proposedByAccountId: opts.accountId,
      participantSnapshot: participantSnapshot ?? Prisma.JsonNull,
    },
  });

  const petitionIds: string[] = [];
  try {
    for (const groupId of governingGroupIds) {
      let result;
      if (opts.hostType === "project") {
        result = await openPetition(prisma, {
          groupId, // founding group provides governance params
          category: "coordination",
          subjectType: "event_authorization",
          subjectId: proposal.id,
          createdByProjectMembershipId: auth.projectMembershipId,
          scopeType: "project",
          scopeId: opts.hostId,
          voterScope: { type: "project", scopeId: opts.hostId },
        });
      } else if (opts.hostType === "coalition") {
        result = await openSystemGroupPetition(prisma, {
          groupId,
          category: "coordination",
          subjectType: "event_authorization",
          subjectId: proposal.id,
        });
      } else {
        // group or responsibility → group-scoped petition by the acting member
        result = await openPetition(prisma, {
          groupId,
          category: "coordination",
          subjectType: "event_authorization",
          subjectId: proposal.id,
          createdByMembershipId: auth.groupMembershipId,
        });
      }
      if (!result.ok) {
        await rollbackProposal(prisma, proposal.id, petitionIds);
        return { ok: false, reason: result.reason };
      }
      petitionIds.push(result.petitionId);
      await prisma.eventProposalPetition.create({
        data: { proposalId: proposal.id, petitionId: result.petitionId, groupId },
      });
    }
  } catch (e) {
    await rollbackProposal(prisma, proposal.id, petitionIds);
    throw e;
  }

  return { ok: true, proposalId: proposal.id, petitionIds };
}

async function rollbackProposal(prisma: PrismaClient, proposalId: string, petitionIds: string[]): Promise<void> {
  if (petitionIds.length > 0) {
    await prisma.petition.updateMany({
      where: { id: { in: petitionIds }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  }
  await prisma.eventProposal.delete({ where: { id: proposalId } }); // cascades EventProposalPetition
}

// ── Proposal evaluation + apply (mirrors the coalition multi-petition flow) ────

// Runs inside the caller's transaction (evaluateAndApplyPetition's $transaction) — mirrors the
// coalition / project-hosting proposal handlers. Must be passed a Prisma.TransactionClient.
export async function evaluateEventProposalForPetition(
  prisma: Prisma.TransactionClient,
  petitionId: string,
): Promise<EvaluateEventProposalResult | null> {
  const child = await prisma.eventProposalPetition.findUnique({
    where: { petitionId },
    select: { proposalId: true },
  });
  if (!child) return null;
  return evaluateEventProposal(prisma, child.proposalId);
}

type LoadedProposal = {
  id: string;
  category: EventCategory;
  hostType: EventHostType;
  hostId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location: string | null;
  visibility: EventVisibility;
  audienceJson: unknown;
  proposedByAccountId: string;
  status: string;
  appliedAt: Date | null;
  createdEventId: string | null;
  petitions: { petitionId: string; groupId: string }[];
};

async function evaluateEventProposal(prisma: Prisma.TransactionClient, proposalId: string): Promise<EvaluateEventProposalResult> {
  const proposal = (await prisma.eventProposal.findUnique({
    where: { id: proposalId },
    include: { petitions: { select: { petitionId: true, groupId: true } } },
  })) as LoadedProposal | null;
  if (!proposal) return { outcome: "pending" };
  if (proposal.status !== "open") {
    if (proposal.status === "succeeded" && proposal.createdEventId) {
      return { outcome: "succeeded", eventId: proposal.createdEventId };
    }
    return { outcome: proposal.status as "failed-rejected" | "failed-withdrawn" | "failed-timeout" };
  }

  const evaluatedAt = new Date();
  await evaluateDuePetitions(prisma, proposal.petitions.map((p) => p.petitionId), evaluatedAt);
  const petitions = await prisma.petition.findMany({
    where: { id: { in: proposal.petitions.map((p) => p.petitionId) } },
    select: { id: true, status: true, closesAt: true },
  });
  if (petitions.length !== proposal.petitions.length) {
    return failEventProposal(prisma, proposal, "failed-withdrawn");
  }
  if (petitions.some((p) => p.status === "withdrawn" || p.status === "superseded")) {
    return failEventProposal(prisma, proposal, "failed-withdrawn");
  }
  if (petitions.some((p) => p.status === "rejected" || p.status === "blocked")) {
    return failEventProposal(prisma, proposal, "failed-rejected");
  }
  if (petitions.some((p) => p.status === "open" && p.closesAt <= evaluatedAt)) {
    return failEventProposal(prisma, proposal, "failed-timeout");
  }
  if (!petitions.every((p) => p.status === "approved")) return { outcome: "pending" };

  return applyEventProposal(prisma, proposal);
}

async function evaluateDuePetitions(prisma: Prisma.TransactionClient, petitionIds: string[], now: Date): Promise<void> {
  const due = await prisma.petition.findMany({
    where: { id: { in: petitionIds }, status: "open", closesAt: { lte: now } },
    select: { id: true },
  });
  for (const p of due) await evaluatePetition(prisma, p.id);
}

// Runs on the caller-supplied transaction (evaluateAndApplyPetition's $transaction). The
// proposal row-lock + create + status flip + audit log are all part of that single transaction,
// so the whole petition resolution commits or rolls back atomically.
async function applyEventProposal(prisma: Prisma.TransactionClient, proposal: LoadedProposal): Promise<EvaluateEventProposalResult> {
  const audiences = parseAudienceJson(proposal.audienceJson);

  // Row-lock the proposal to prevent concurrent application.
  await prisma.$queryRaw`SELECT id FROM "EventProposal" WHERE id = ${proposal.id} FOR UPDATE`;
  const locked = await prisma.eventProposal.findUniqueOrThrow({ where: { id: proposal.id } });
  if (locked.appliedAt !== null) {
    return { outcome: "succeeded", eventId: locked.createdEventId! };
  }

  // Re-validate audience connectivity at apply time (a host may have lost a connection).
  for (const a of audiences) {
    const connected = await assertAudienceConnectivity(prisma, locked.hostType, locked.hostId, a.audienceType, a.audienceId);
    if (!connected) {
      throw new Error(`Audience ${a.audienceType}:${a.audienceId} is no longer connected to the host.`);
    }
  }

  const now = new Date();
  const event = await prisma.calendarEvent.create({
    data: {
      category: locked.category,
      hostType: locked.hostType,
      hostId: locked.hostId,
      title: locked.title,
      description: locked.description,
      startTime: locked.startTime,
      endTime: locked.endTime,
      timezone: locked.timezone,
      location: locked.location,
      visibility: locked.visibility,
      createdByAccountId: locked.proposedByAccountId,
      authorizingPetitionId: proposal.petitions[0]?.petitionId ?? null,
    },
  });
  if (audiences.length > 0) {
    await prisma.eventAudience.createMany({
      data: audiences.map((a) => ({ eventId: event.id, audienceType: a.audienceType, audienceId: a.audienceId })),
      skipDuplicates: true,
    });
  }
  await prisma.eventProposal.update({
    where: { id: locked.id },
    data: { appliedAt: now, createdEventId: event.id, status: "succeeded", resolvedAt: now },
  });

  await logAction(prisma, {
    actorAccountId: proposal.proposedByAccountId,
    groupId: proposal.petitions[0]?.groupId ?? null,
    projectId: proposal.hostType === "project" ? proposal.hostId : null,
    action: "event.created",
    targetType: "calendar_event",
    targetId: event.id,
    metadata: { proposalId: proposal.id, category: proposal.category, hostType: proposal.hostType, hostId: proposal.hostId },
  });

  return { outcome: "succeeded", eventId: event.id };
}

async function failEventProposal(
  prisma: Prisma.TransactionClient,
  proposal: { id: string; petitions: { petitionId: string }[] },
  status: "failed-rejected" | "failed-withdrawn" | "failed-timeout",
): Promise<EvaluateEventProposalResult> {
  const updated = await prisma.eventProposal.updateMany({
    where: { id: proposal.id, status: "open" },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count > 0) {
    await prisma.petition.updateMany({
      where: { id: { in: proposal.petitions.map((p) => p.petitionId) }, status: "open" },
      data: { status: "superseded", resolvedAt: new Date() },
    });
  }
  return { outcome: status };
}

// ── Viewer space context + visibility ─────────────────────────────────────────

export type ViewerSpaces = {
  accountId: string | null;
  groupIds: Set<string>;
  projectIds: Set<string>;
  coalitionIds: Set<string>;
  responsibilityIds: Set<string>; // responsibilities the viewer actively holds
};

/**
 * Gathers, in one batched pass, every space the account belongs to — the seed for
 * both dashboard aggregation and in-memory visibility checks. Because we only ever
 * read the viewer's OWN memberships, no query can reveal another private group's
 * existence or membership.
 */
export async function getViewerSpaces(prisma: PrismaClient, accountId: string | null): Promise<ViewerSpaces> {
  if (!accountId) {
    return { accountId: null, groupIds: new Set(), projectIds: new Set(), coalitionIds: new Set(), responsibilityIds: new Set() };
  }
  const now = new Date();
  const [groups, projects, coalitions, assignments] = await Promise.all([
    prisma.groupMembership.findMany({ where: { accountId, status: "active" }, select: { groupId: true } }),
    prisma.projectMembership.findMany({ where: { accountId, status: "active" }, select: { projectId: true } }),
    prisma.coalition.findMany({
      where: {
        status: "active",
        memberships: { some: { endedAt: null, group: { memberships: { some: { accountId, status: "active" } } } } },
      },
      select: { id: true },
    }),
    prisma.responsibilityAssignment.findMany({
      where: { membership: { accountId, status: "active" }, endedAt: null, expiresAt: { gt: now } },
      select: { responsibility: { select: { id: true } } },
    }),
  ]);
  return {
    accountId,
    groupIds: new Set(groups.map((g) => g.groupId)),
    projectIds: new Set(projects.map((p) => p.projectId)),
    coalitionIds: new Set(coalitions.map((c) => c.id)),
    responsibilityIds: new Set(assignments.map((a) => a.responsibility.id)),
  };
}

function isInSpace(viewer: ViewerSpaces, type: EventHostType, id: string): boolean {
  switch (type) {
    case "group": return viewer.groupIds.has(id);
    case "project": return viewer.projectIds.has(id);
    case "responsibility": return viewer.responsibilityIds.has(id);
    case "coalition": return viewer.coalitionIds.has(id);
    case "account": return viewer.accountId === id;
  }
}

type ViewableEvent = {
  hostType: EventHostType;
  hostId: string;
  visibility: EventVisibility;
  createdByAccountId: string;
  audiences: { audienceType: EventHostType; audienceId: string }[];
};

function canViewEventInMemory(viewer: ViewerSpaces, event: ViewableEvent): boolean {
  if (viewer.accountId && viewer.accountId === event.createdByAccountId) return true;
  if (event.hostType === "account") return viewer.accountId === event.hostId;
  const inHost = isInSpace(viewer, event.hostType, event.hostId);
  switch (event.visibility) {
    case "public":
      return true;
    case "host_only":
      return inHost;
    case "audience":
      return inHost || event.audiences.some((a) => isInSpace(viewer, a.audienceType, a.audienceId));
  }
}

// ── Read functions ────────────────────────────────────────────────────────────

type EventWithAudiences = {
  id: string;
  category: EventCategory;
  hostType: EventHostType;
  hostId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location: string | null;
  visibility: EventVisibility;
  authorizingPetitionId: string | null;
  createdByAccountId: string;
  canceledAt: Date | null;
  audiences: { audienceType: EventHostType; audienceId: string }[];
};

async function buildViews(prisma: PrismaClient, events: EventWithAudiences[]): Promise<CalendarEventView[]> {
  if (events.length === 0) return [];
  const [interestMap, hostLabels] = await Promise.all([
    getInterestCountsForEvents(prisma, events.map((e) => e.id)),
    resolveHostLabels(prisma, events.map((e) => ({ hostType: e.hostType, hostId: e.hostId }))),
  ]);
  return events.map((e) => ({
    id: e.id,
    category: e.category,
    hostType: e.hostType,
    hostId: e.hostId,
    hostLabel: hostLabels.get(`${e.hostType}:${e.hostId}`) ?? "Unknown",
    title: e.title,
    description: e.description,
    startTime: e.startTime,
    endTime: e.endTime,
    timezone: e.timezone,
    location: e.location,
    visibility: e.visibility,
    audiences: e.audiences.map((a) => ({ audienceType: a.audienceType, audienceId: a.audienceId })),
    interestCounts: interestMap.get(e.id) ?? { planning_to_attend: 0, interested: 0 },
    authorizingPetitionId: e.authorizingPetitionId,
    createdByAccountId: e.createdByAccountId,
    canceledAt: e.canceledAt,
  }));
}

async function resolveHostLabels(
  prisma: PrismaClient,
  hosts: { hostType: EventHostType; hostId: string }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const byType: Record<EventHostType, Set<string>> = {
    group: new Set(), project: new Set(), responsibility: new Set(), coalition: new Set(), account: new Set(),
  };
  for (const h of hosts) byType[h.hostType].add(h.hostId);
  const [groups, projects, responsibilities, coalitions] = await Promise.all([
    byType.group.size ? prisma.group.findMany({ where: { id: { in: [...byType.group] } }, select: { id: true, name: true } }) : [],
    byType.project.size ? prisma.project.findMany({ where: { id: { in: [...byType.project] } }, select: { id: true, name: true } }) : [],
    byType.responsibility.size ? prisma.responsibility.findMany({ where: { id: { in: [...byType.responsibility] } }, select: { id: true, type: true } }) : [],
    byType.coalition.size ? prisma.coalition.findMany({ where: { id: { in: [...byType.coalition] } }, select: { id: true, name: true } }) : [],
  ]);
  for (const g of groups) map.set(`group:${g.id}`, g.name);
  for (const p of projects) map.set(`project:${p.id}`, p.name);
  for (const r of responsibilities) map.set(`responsibility:${r.id}`, r.type.charAt(0).toUpperCase() + r.type.slice(1).replace(/_/g, " "));
  for (const c of coalitions) map.set(`coalition:${c.id}`, c.name);
  for (const id of byType.account) map.set(`account:${id}`, "Personal");
  return map;
}

const EVENT_SELECT = {
  id: true,
  category: true,
  hostType: true,
  hostId: true,
  title: true,
  description: true,
  startTime: true,
  endTime: true,
  timezone: true,
  location: true,
  visibility: true,
  authorizingPetitionId: true,
  createdByAccountId: true,
  canceledAt: true,
  audiences: { select: { audienceType: true, audienceId: true } },
} as const;

export type ListEventsOptions = { includeCanceled?: boolean; from?: Date; to?: Date };

/** A single space's calendar: events it hosts OR events targeted to it via audience scope. */
export async function listEventsForSpace(
  prisma: PrismaClient,
  viewerAccountId: string | null,
  hostType: EventHostType,
  hostId: string,
  opts?: ListEventsOptions,
): Promise<CalendarEventView[]> {
  const where: Prisma.CalendarEventWhereInput = {
    OR: [
      { hostType, hostId },
      { audiences: { some: { audienceType: hostType, audienceId: hostId } } },
    ],
  };
  if (!opts?.includeCanceled) where.canceledAt = null;
  if (opts?.from || opts?.to) {
    where.startTime = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
  }
  const events = (await prisma.calendarEvent.findMany({
    where,
    select: EVENT_SELECT,
    orderBy: { startTime: "asc" },
  })) as EventWithAudiences[];
  const viewer = await getViewerSpaces(prisma, viewerAccountId);
  const visible = events.filter((e) => canViewEventInMemory(viewer, e));
  return buildViews(prisma, visible);
}

/** The personal dashboard calendar: a filtered, aggregated view across the account's spaces. */
export async function listEventsForAccount(
  prisma: PrismaClient,
  accountId: string,
  filters: ResolvedCalendarFilters,
  opts?: ListEventsOptions,
): Promise<CalendarEventView[]> {
  const viewer = await getViewerSpaces(prisma, accountId);

  const applyAllowlist = (ids: string[], allow: string[] | undefined) =>
    allow ? ids.filter((id) => allow.includes(id)) : ids;

  const groupIds = filters.showGroupEvents ? applyAllowlist([...viewer.groupIds], filters.spaceFilters?.group) : [];
  const projectIds = filters.showProjectEvents ? applyAllowlist([...viewer.projectIds], filters.spaceFilters?.project) : [];
  const responsibilityIds = filters.showResponsibilityEvents
    ? applyAllowlist([...viewer.responsibilityIds], filters.spaceFilters?.responsibility)
    : [];
  const coalitionIds = filters.showCoalitionEvents ? applyAllowlist([...viewer.coalitionIds], filters.spaceFilters?.coalition) : [];

  const orClauses: Prisma.CalendarEventWhereInput[] = [];
  if (groupIds.length) orClauses.push({ hostType: "group", hostId: { in: groupIds } });
  if (projectIds.length) orClauses.push({ hostType: "project", hostId: { in: projectIds } });
  if (responsibilityIds.length) orClauses.push({ hostType: "responsibility", hostId: { in: responsibilityIds } });
  if (coalitionIds.length) orClauses.push({ hostType: "coalition", hostId: { in: coalitionIds } });
  if (filters.showPersonalEvents) orClauses.push({ hostType: "account", hostId: accountId });

  const audienceOr: Prisma.EventAudienceWhereInput[] = [];
  if (groupIds.length) audienceOr.push({ audienceType: "group", audienceId: { in: groupIds } });
  if (projectIds.length) audienceOr.push({ audienceType: "project", audienceId: { in: projectIds } });
  if (responsibilityIds.length) audienceOr.push({ audienceType: "responsibility", audienceId: { in: responsibilityIds } });
  if (coalitionIds.length) audienceOr.push({ audienceType: "coalition", audienceId: { in: coalitionIds } });
  if (audienceOr.length) orClauses.push({ audiences: { some: { OR: audienceOr } } });

  if (orClauses.length === 0) return [];

  const where: Prisma.CalendarEventWhereInput = { canceledAt: null, OR: orClauses };
  if (opts?.from || opts?.to) {
    where.startTime = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
  }
  const events = (await prisma.calendarEvent.findMany({
    where,
    select: EVENT_SELECT,
    orderBy: { startTime: "asc" },
  })) as EventWithAudiences[];
  // Respect per-event visibility (e.g. a host_only meeting that lists a space as an
  // audience for calendar appearance must still not be readable by non-host viewers).
  const visible = events.filter((e) => canViewEventInMemory(viewer, e));
  return buildViews(prisma, visible);
}

export async function getEventForViewer(
  prisma: PrismaClient,
  viewerAccountId: string | null,
  eventId: string,
): Promise<CalendarEventView | null> {
  const event = (await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: EVENT_SELECT,
  })) as EventWithAudiences | null;
  if (!event) return null;
  const viewer = await getViewerSpaces(prisma, viewerAccountId);
  if (!canViewEventInMemory(viewer, event)) return null;
  const [view] = await buildViews(prisma, [event]);
  return view ?? null;
}

// ── Interest (count-only — identity is never surfaced) ────────────────────────

export async function getInterestCountsForEvents(
  prisma: PrismaClient,
  eventIds: string[],
): Promise<Map<string, EventInterestCounts>> {
  const map = new Map<string, EventInterestCounts>();
  if (eventIds.length === 0) return map;
  for (const id of eventIds) map.set(id, { planning_to_attend: 0, interested: 0 });
  const grouped = await prisma.eventInterest.groupBy({
    by: ["eventId", "level"],
    where: { eventId: { in: eventIds } },
    _count: { _all: true },
  });
  for (const row of grouped) {
    const counts = map.get(row.eventId) ?? { planning_to_attend: 0, interested: 0 };
    if (row.level === "planning_to_attend") counts.planning_to_attend = row._count._all;
    else counts.interested = row._count._all;
    map.set(row.eventId, counts);
  }
  return map;
}

export async function getInterestCounts(prisma: PrismaClient, eventId: string): Promise<EventInterestCounts> {
  const map = await getInterestCountsForEvents(prisma, [eventId]);
  return map.get(eventId) ?? { planning_to_attend: 0, interested: 0 };
}

/** The caller's OWN interest selections (their own data only — never another account's). */
export async function getMyInterests(
  prisma: PrismaClient,
  accountId: string,
  eventIds: string[],
): Promise<Map<string, EventInterestLevel>> {
  const map = new Map<string, EventInterestLevel>();
  if (eventIds.length === 0) return map;
  const rows = await prisma.eventInterest.findMany({
    where: { accountId, eventId: { in: eventIds } },
    select: { eventId: true, level: true },
  });
  for (const r of rows) map.set(r.eventId, r.level);
  return map;
}

export async function setInterest(
  prisma: PrismaClient,
  opts: { accountId: string; eventId: string; level: EventInterestLevel | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const event = (await prisma.calendarEvent.findUnique({
    where: { id: opts.eventId },
    select: { hostType: true, hostId: true, visibility: true, createdByAccountId: true, canceledAt: true, audiences: { select: { audienceType: true, audienceId: true } } },
  })) as (ViewableEvent & { canceledAt: Date | null }) | null;
  if (!event) return { ok: false, reason: "not_found" };
  if (event.canceledAt) return { ok: false, reason: "event_canceled" };

  const viewer = await getViewerSpaces(prisma, opts.accountId);
  if (!canViewEventInMemory(viewer, event)) return { ok: false, reason: "not_visible" };

  if (opts.level === null) {
    await prisma.eventInterest.deleteMany({ where: { eventId: opts.eventId, accountId: opts.accountId } });
    return { ok: true };
  }
  await prisma.eventInterest.upsert({
    where: { eventId_accountId: { eventId: opts.eventId, accountId: opts.accountId } },
    create: { eventId: opts.eventId, accountId: opts.accountId, level: opts.level },
    update: { level: opts.level },
  });
  return { ok: true };
}

// ── Cancellation ──────────────────────────────────────────────────────────────

export async function cancelEvent(
  prisma: PrismaClient,
  opts: { accountId: string; eventId: string; reason?: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: opts.eventId },
    select: { hostType: true, hostId: true, createdByAccountId: true, canceledAt: true },
  });
  if (!event) return { ok: false, reason: "not_found" };
  if (event.canceledAt) return { ok: true }; // idempotent

  let authorized = event.createdByAccountId === opts.accountId;
  if (!authorized) {
    try {
      await assertEventHostAuthorization(prisma, opts.accountId, event.hostType, event.hostId);
      authorized = true;
    } catch {
      authorized = false;
    }
  }
  if (!authorized) return { ok: false, reason: "not_authorized" };

  await prisma.calendarEvent.update({
    where: { id: opts.eventId },
    data: { canceledAt: new Date(), canceledByAccountId: opts.accountId, cancelReason: opts.reason?.trim() || null },
  });
  await logAction(prisma, {
    actorAccountId: opts.accountId,
    projectId: event.hostType === "project" ? event.hostId : null,
    action: "event.canceled",
    targetType: "calendar_event",
    targetId: opts.eventId,
    metadata: { hostType: event.hostType, hostId: event.hostId },
  });
  return { ok: true };
}

// ── Calendar filter preferences ───────────────────────────────────────────────

const DEFAULT_FILTERS: ResolvedCalendarFilters = {
  showGroupEvents: true,
  showProjectEvents: true,
  showResponsibilityEvents: true,
  showCoalitionEvents: true,
  showPersonalEvents: true,
  spaceFilters: null,
};

function sanitizeSpaceFilters(raw: unknown): Partial<Record<EventHostType, string[]>> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Partial<Record<EventHostType, string[]>> = {};
  for (const key of HOST_TYPES) {
    const val = (raw as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      const ids = val.filter((v): v is string => typeof v === "string");
      if (ids.length) out[key] = ids;
    }
  }
  return Object.keys(out).length ? out : null;
}

export async function getCalendarFilterPreferences(
  prisma: PrismaClient,
  accountId: string,
): Promise<ResolvedCalendarFilters> {
  const pref = await prisma.calendarFilterPreference.findUnique({ where: { accountId } });
  if (!pref) return { ...DEFAULT_FILTERS };
  return {
    showGroupEvents: pref.showGroupEvents,
    showProjectEvents: pref.showProjectEvents,
    showResponsibilityEvents: pref.showResponsibilityEvents,
    showCoalitionEvents: pref.showCoalitionEvents,
    showPersonalEvents: pref.showPersonalEvents,
    spaceFilters: sanitizeSpaceFilters(pref.spaceFilters),
  };
}

export type CalendarFilterInput = {
  showGroupEvents?: boolean;
  showProjectEvents?: boolean;
  showResponsibilityEvents?: boolean;
  showCoalitionEvents?: boolean;
  showPersonalEvents?: boolean;
  spaceFilters?: unknown;
};

export async function setCalendarFilterPreferences(
  prisma: PrismaClient,
  accountId: string,
  prefs: CalendarFilterInput,
): Promise<void> {
  const sanitizedFilters =
    prefs.spaceFilters !== undefined ? sanitizeSpaceFilters(prefs.spaceFilters) : undefined;
  const spaceFiltersValue =
    sanitizedFilters === undefined ? undefined : (sanitizedFilters as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;

  await prisma.calendarFilterPreference.upsert({
    where: { accountId },
    create: {
      accountId,
      showGroupEvents: prefs.showGroupEvents ?? true,
      showProjectEvents: prefs.showProjectEvents ?? true,
      showResponsibilityEvents: prefs.showResponsibilityEvents ?? true,
      showCoalitionEvents: prefs.showCoalitionEvents ?? true,
      showPersonalEvents: prefs.showPersonalEvents ?? true,
      spaceFilters: sanitizedFilters ?? Prisma.JsonNull,
    },
    update: {
      ...(prefs.showGroupEvents !== undefined ? { showGroupEvents: prefs.showGroupEvents } : {}),
      ...(prefs.showProjectEvents !== undefined ? { showProjectEvents: prefs.showProjectEvents } : {}),
      ...(prefs.showResponsibilityEvents !== undefined ? { showResponsibilityEvents: prefs.showResponsibilityEvents } : {}),
      ...(prefs.showCoalitionEvents !== undefined ? { showCoalitionEvents: prefs.showCoalitionEvents } : {}),
      ...(prefs.showPersonalEvents !== undefined ? { showPersonalEvents: prefs.showPersonalEvents } : {}),
      ...(spaceFiltersValue !== undefined ? { spaceFilters: spaceFiltersValue } : {}),
    },
  });
}

// ── Connectivity helper exported for forms (which spaces a host may target) ────

/**
 * Returns the spaces a host may legitimately add as audiences — used to populate
 * the event form's audience checkboxes so a user can only pick valid targets.
 */
export async function listConnectableAudiences(
  prisma: PrismaClient,
  hostType: EventHostType,
  hostId: string,
): Promise<{ audienceType: EventHostType; audienceId: string; label: string }[]> {
  const out: { audienceType: EventHostType; audienceId: string; label: string }[] = [];
  if (hostType === "account") return out;

  if (hostType === "group") {
    const [projects, responsibilities, coalitions] = await Promise.all([
      prisma.projectHosting.findMany({
        where: { groupId: hostId, endedAt: null },
        select: { project: { select: { id: true, name: true } } },
      }),
      prisma.responsibility.findMany({ where: { groupId: hostId }, select: { id: true, type: true } }),
      prisma.coalitionMembership.findMany({
        where: { groupId: hostId, endedAt: null, coalition: { status: "active" } },
        select: { coalition: { select: { id: true, name: true } } },
      }),
    ]);
    for (const p of projects) out.push({ audienceType: "project", audienceId: p.project.id, label: p.project.name });
    for (const r of responsibilities) out.push({ audienceType: "responsibility", audienceId: r.id, label: r.type });
    for (const c of coalitions) out.push({ audienceType: "coalition", audienceId: c.coalition.id, label: c.coalition.name });
    return out;
  }

  if (hostType === "project") {
    const hostings = await prisma.projectHosting.findMany({
      where: { projectId: hostId, endedAt: null },
      select: { group: { select: { id: true, name: true } } },
    });
    for (const h of hostings) out.push({ audienceType: "group", audienceId: h.group.id, label: h.group.name });
    return out;
  }

  if (hostType === "responsibility") {
    const r = await prisma.responsibility.findUnique({
      where: { id: hostId },
      select: { group: { select: { id: true, name: true } } },
    });
    if (r) out.push({ audienceType: "group", audienceId: r.group.id, label: r.group.name });
    return out;
  }

  if (hostType === "coalition") {
    const memberships = await prisma.coalitionMembership.findMany({
      where: { coalitionId: hostId, endedAt: null, coalition: { status: "active" } },
      select: { group: { select: { id: true, name: true } } },
    });
    for (const m of memberships) {
      // Local member groups only: a cross-node member (null group, F3) gets
      // its audience entry via federation delivery, not local fan-out.
      if (m.group) out.push({ audienceType: "group", audienceId: m.group.id, label: m.group.name });
    }
    return out;
  }

  return out;
}
