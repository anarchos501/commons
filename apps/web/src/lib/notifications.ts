import type { PrismaClient } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { getViewerSpaces, type ViewerSpaces } from "./events";

// ── Categories ────────────────────────────────────────────────────────────────
// Two existing "action needed" categories (requests, petitions) are built inline in the
// dashboard and self-clear when you act. The four below are derived here; three are muteable
// broadcasts, "aboutYou" is the non-muteable person-targeting class.
export type NotifCategory = "requests" | "petitions" | "outcomes" | "safety" | "updates" | "aboutYou";

// Categories that don't self-clear and so use a per-account "last seen" watermark.
export const WATERMARK_CATEGORIES = ["outcomes", "safety", "updates", "aboutYou"] as const;
export type WatermarkCategory = (typeof WATERMARK_CATEGORIES)[number];

const NOTIF_FLOOR_MS = 30 * 24 * 60 * 60 * 1000; // don't surface events older than 30 days

export type DerivedNotif = {
  id: string;
  category: WatermarkCategory;
  title: string;
  detail: string | null;
  href: string | null;
  groupId: string | null; // for the ephemeral group filter (null = not group-scoped / node)
  createdAt: Date;
  createdAtIso: string;
  isUnread: boolean;
};

// ── Preferences ─────────────────────────────────────────────────────────────--
export type MutedSpaces = { group?: string[]; project?: string[]; responsibility?: string[]; coalition?: string[] };

export type NotificationPrefs = {
  enableRequests: boolean;
  enablePetitions: boolean;
  enableOutcomes: boolean;
  enableSafety: boolean;
  enableUpdates: boolean;
  rollUpUpdates: boolean;
  mutedSpaces: MutedSpaces;
  outcomesSeenAt: Date | null;
  safetySeenAt: Date | null;
  updatesSeenAt: Date | null;
  aboutYouSeenAt: Date | null;
};

const SPACE_KEYS = ["group", "project", "responsibility", "coalition"] as const;

function sanitizeMutedSpaces(raw: unknown): MutedSpaces {
  const out: MutedSpaces = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of SPACE_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      const ids = val.filter((v): v is string => typeof v === "string");
      if (ids.length) out[key] = ids;
    }
  }
  return out;
}

/**
 * Loads the account's notification preferences, creating the row on first access with all
 * watermarks set to "now" — the clean-slate behavior: a brand-new account is not blasted with
 * 30 days of history; only events after first view count as new.
 */
export async function getNotificationPreferences(prisma: PrismaClient, accountId: string): Promise<NotificationPrefs> {
  const existing = await prisma.notificationPreference.findUnique({ where: { accountId } });
  const row =
    existing ??
    (await prisma.notificationPreference.create({
      data: {
        accountId,
        outcomesSeenAt: new Date(),
        safetySeenAt: new Date(),
        updatesSeenAt: new Date(),
        aboutYouSeenAt: new Date(),
      },
    }));
  return {
    enableRequests: row.enableRequests,
    enablePetitions: row.enablePetitions,
    enableOutcomes: row.enableOutcomes,
    enableSafety: row.enableSafety,
    enableUpdates: row.enableUpdates,
    rollUpUpdates: row.rollUpUpdates,
    mutedSpaces: sanitizeMutedSpaces(row.mutedSpaces),
    outcomesSeenAt: row.outcomesSeenAt,
    safetySeenAt: row.safetySeenAt,
    updatesSeenAt: row.updatesSeenAt,
    aboutYouSeenAt: row.aboutYouSeenAt,
  };
}

export type NotificationPrefsInput = {
  enableRequests?: boolean;
  enablePetitions?: boolean;
  enableOutcomes?: boolean;
  enableSafety?: boolean;
  enableUpdates?: boolean;
  rollUpUpdates?: boolean;
  mutedSpaces?: unknown;
};

export async function setNotificationPreferences(prisma: PrismaClient, accountId: string, input: NotificationPrefsInput): Promise<void> {
  const muted = input.mutedSpaces !== undefined ? sanitizeMutedSpaces(input.mutedSpaces) : undefined;
  const mutedValue = muted === undefined ? undefined : (Object.keys(muted).length ? (muted as Prisma.InputJsonValue) : Prisma.JsonNull);
  await prisma.notificationPreference.upsert({
    where: { accountId },
    create: {
      accountId,
      enableRequests: input.enableRequests ?? true,
      enablePetitions: input.enablePetitions ?? true,
      enableOutcomes: input.enableOutcomes ?? true,
      enableSafety: input.enableSafety ?? true,
      enableUpdates: input.enableUpdates ?? true,
      rollUpUpdates: input.rollUpUpdates ?? true,
      mutedSpaces: muted && Object.keys(muted).length ? (muted as Prisma.InputJsonValue) : Prisma.JsonNull,
      // creating via settings save also establishes the clean-slate baseline
      outcomesSeenAt: new Date(),
      safetySeenAt: new Date(),
      updatesSeenAt: new Date(),
      aboutYouSeenAt: new Date(),
    },
    update: {
      ...(input.enableRequests !== undefined ? { enableRequests: input.enableRequests } : {}),
      ...(input.enablePetitions !== undefined ? { enablePetitions: input.enablePetitions } : {}),
      ...(input.enableOutcomes !== undefined ? { enableOutcomes: input.enableOutcomes } : {}),
      ...(input.enableSafety !== undefined ? { enableSafety: input.enableSafety } : {}),
      ...(input.enableUpdates !== undefined ? { enableUpdates: input.enableUpdates } : {}),
      ...(input.rollUpUpdates !== undefined ? { rollUpUpdates: input.rollUpUpdates } : {}),
      ...(mutedValue !== undefined ? { mutedSpaces: mutedValue } : {}),
    },
  });
}

const SEEN_COLUMN: Record<WatermarkCategory, "outcomesSeenAt" | "safetySeenAt" | "updatesSeenAt" | "aboutYouSeenAt"> = {
  outcomes: "outcomesSeenAt",
  safety: "safetySeenAt",
  updates: "updatesSeenAt",
  aboutYou: "aboutYouSeenAt",
};

/** Sets the watermark for a category to now — "mark all read" for that category. */
export async function markCategoryRead(prisma: PrismaClient, accountId: string, category: WatermarkCategory): Promise<void> {
  const col = SEEN_COLUMN[category];
  await prisma.notificationPreference.upsert({
    where: { accountId },
    create: { accountId, [col]: new Date() },
    update: { [col]: new Date() },
  });
}

// ── Orchestration ─────────────────────────────────────────────────────────────
export type DerivedResult = { items: DerivedNotif[]; counts: Record<WatermarkCategory, number> };

/**
 * Builds the derived (non-self-clearing) notifications for an account. Enable-gated: a disabled
 * broadcast category's queries are skipped entirely (not just filtered). "About you" always runs
 * (non-muteable). Each source is audience-scoped via the viewer's own memberships and time-floored.
 */
export async function getDerivedNotifications(
  prisma: PrismaClient,
  accountId: string,
  prefs: NotificationPrefs,
  viewer?: ViewerSpaces,
): Promise<DerivedResult> {
  const now = new Date();
  const floor = new Date(now.getTime() - NOTIF_FLOOR_MS);
  const v = viewer ?? (await getViewerSpaces(prisma, accountId));
  const since = (cat: WatermarkCategory) => {
    const wm = prefs[SEEN_COLUMN[cat]] as Date | null;
    return wm && wm > floor ? wm : floor;
  };

  const tasks: Promise<DerivedNotif[]>[] = [];
  if (prefs.enableOutcomes) tasks.push(outcomeNotifs(prisma, accountId, v, since("outcomes")));
  if (prefs.enableSafety) tasks.push(safetyNotifs(prisma, v, since("safety")));
  if (prefs.enableUpdates) tasks.push(updateNotifs(prisma, v, prefs, since("updates")));
  tasks.push(aboutYouNotifs(prisma, accountId, v, since("aboutYou"))); // non-muteable — always runs

  const groups = (await Promise.all(tasks)).flat();
  // Apply watermark → isUnread per item.
  const items = groups.map((n) => ({ ...n, isUnread: n.createdAt > (prefs[SEEN_COLUMN[n.category]] ?? floor) }));
  const counts: Record<WatermarkCategory, number> = { outcomes: 0, safety: 0, updates: 0, aboutYou: 0 };
  for (const it of items) if (it.isUnread) counts[it.category]++;
  return { items, counts };
}

// ── Helpers for names ───────────────────────────────────────────────────────--
function iso(d: Date) {
  return { createdAt: d, createdAtIso: d.toISOString() };
}

// ── Source: Outcomes ──────────────────────────────────────────────────────────
async function outcomeNotifs(prisma: PrismaClient, accountId: string, viewer: ViewerSpaces, since: Date): Promise<DerivedNotif[]> {
  const myMemberships = await prisma.groupMembership.findMany({ where: { accountId, status: "active" }, select: { id: true } });
  const myMembershipIds = myMemberships.map((m) => m.id);
  const out: DerivedNotif[] = [];

  // Petition outcomes (created by me OR I supported OR I node-supported).
  const petitions = await prisma.petition.findMany({
    where: {
      status: { in: ["approved", "rejected"] },
      resolvedAt: { gt: since },
      OR: [
        myMembershipIds.length ? { createdByMembershipId: { in: myMembershipIds } } : {},
        { createdByAccountId: accountId },
        { support: { some: { membership: { accountId } } } },
        { nodeSupport: { some: { accountId } } },
      ],
    },
    select: { id: true, status: true, scopeType: true, groupId: true, resolvedAt: true, group: { select: { id: true, name: true } } },
    orderBy: { resolvedAt: "desc" },
    take: 20,
  });
  for (const p of petitions) {
    if (!p.resolvedAt) continue;
    const where = p.group?.name ?? (p.scopeType === "node" ? "your node" : "a collective");
    out.push({
      id: `petition-outcome:${p.id}`,
      category: "outcomes",
      title: `Petition ${p.status === "approved" ? "approved" : "declined"}`,
      detail: `A petition you took part in was ${p.status === "approved" ? "approved" : "declined"} in ${where}.`,
      href: p.scopeType === "node" ? "/node#petitions" : p.groupId ? `/groups/${p.groupId}#petitions` : null,
      groupId: p.groupId ?? null,
      ...iso(p.resolvedAt),
      isUnread: true,
    });
  }

  // Trusted-provider granted.
  const grants = await prisma.trustedProviderStatus.findMany({
    where: { membership: { accountId }, status: "active", grantedAt: { gt: since } },
    select: { id: true, grantedAt: true, groupId: true, category: { select: { name: true } }, group: { select: { name: true } } },
    orderBy: { grantedAt: "desc" },
    take: 20,
  });
  for (const g of grants) {
    out.push({
      id: `tp-grant:${g.id}`,
      category: "outcomes",
      title: "You're now a trusted provider",
      detail: `Recognized for ${g.category?.name ?? "a contribution category"} in ${g.group?.name ?? "a collective"}.`,
      href: `/groups/${g.groupId}`,
      groupId: g.groupId,
      ...iso(g.grantedAt),
      isUnread: true,
    });
  }

  // Responsibility term expiry (natural — neutral wording; recall is in About you).
  const expiries = await prisma.responsibilityAssignment.findMany({
    where: { membership: { accountId }, endReason: "expired", endedAt: { gt: since } },
    select: { id: true, endedAt: true, responsibility: { select: { type: true, groupId: true, group: { select: { name: true } } } } },
    orderBy: { endedAt: "desc" },
    take: 20,
  });
  for (const a of expiries) {
    if (!a.endedAt) continue;
    out.push({
      id: `resp-expiry:${a.id}`,
      category: "outcomes",
      title: `Your term as ${a.responsibility.type} has ended`,
      detail: `Your term reached its limit in ${a.responsibility.group?.name ?? "a collective"}. You can volunteer again.`,
      href: `/groups/${a.responsibility.groupId}`,
      groupId: a.responsibility.groupId,
      ...iso(a.endedAt),
      isUnread: true,
    });
  }

  // Concern outcomes for the reporter (never the subject).
  const reports = await prisma.report.findMany({
    where: { reportedByAccountId: accountId, OR: [{ resolvedAt: { gt: since } }, { closedAt: { gt: since } }] },
    select: { id: true, status: true, resolvedAt: true, closedAt: true, groupId: true, group: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const r of reports) {
    const ts = [r.resolvedAt, r.closedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    if (!ts) continue;
    out.push({
      id: `concern-outcome:${r.id}`,
      category: "outcomes",
      title: "Your concern was reviewed",
      detail: `A concern you raised in ${r.group?.name ?? "a collective"} was ${r.status.replace(/_/g, " ")}.`,
      href: `/groups/${r.groupId}#concerns`,
      groupId: r.groupId,
      ...iso(ts),
      isUnread: true,
    });
  }

  // Application decisions (group + project join). decidedAt is set only on approve/decline of a
  // pending application — so a direct open-group join (no decision) is correctly excluded.
  const groupApps = await prisma.groupMembership.findMany({
    where: { accountId, decidedAt: { gt: since }, status: { in: ["active", "inactive"] } },
    select: { id: true, status: true, decidedAt: true, groupId: true, group: { select: { name: true } } },
    orderBy: { decidedAt: "desc" },
    take: 20,
  });
  for (const m of groupApps) {
    if (!m.decidedAt) continue;
    const approved = m.status === "active";
    out.push({
      id: `group-app:${m.id}`,
      category: "outcomes",
      title: approved ? `You're now a member of ${m.group.name}` : `Your request to join ${m.group.name} wasn't approved`,
      detail: approved ? "Your membership is active." : "You can ask again later, or reach out to a member.",
      href: approved ? `/groups/${m.groupId}` : null,
      groupId: m.groupId,
      ...iso(m.decidedAt),
      isUnread: true,
    });
  }
  const projApps = await prisma.projectMembership.findMany({
    where: { accountId, decidedAt: { gt: since }, status: { in: ["active", "inactive"] } },
    select: { id: true, status: true, decidedAt: true, projectId: true, project: { select: { name: true, foundingGroupId: true } } },
    orderBy: { decidedAt: "desc" },
    take: 20,
  });
  for (const m of projApps) {
    if (!m.decidedAt) continue;
    const approved = m.status === "active";
    out.push({
      id: `proj-app:${m.id}`,
      category: "outcomes",
      title: approved ? `You joined the project ${m.project.name}` : `Your request to join ${m.project.name} wasn't approved`,
      detail: approved ? "Your project membership is active." : null,
      href: approved ? `/projects/${m.projectId}` : null,
      groupId: m.project.foundingGroupId ?? null,
      ...iso(m.decidedAt),
      isUnread: true,
    });
  }

  return out;
}

// ── Source: Safety ────────────────────────────────────────────────────────────
async function safetyNotifs(prisma: PrismaClient, viewer: ViewerSpaces, since: Date): Promise<DerivedNotif[]> {
  const groupIds = [...viewer.groupIds];
  if (!groupIds.length) return [];
  const emergencies = await prisma.emergencyPeriod.findMany({
    where: { groupId: { in: groupIds }, startedAt: { gt: since } },
    select: { id: true, startedAt: true, groupId: true, group: { select: { name: true } } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return emergencies.map((e) => ({
    id: `emergency:${e.id}`,
    category: "safety" as const,
    title: `Emergency declared in ${e.group?.name ?? "a collective"}`,
    detail: "An emergency coordination period is active.",
    href: `/groups/${e.groupId}`,
    groupId: e.groupId,
    ...iso(e.startedAt),
    isUnread: true,
  }));
}

// ── Source: Updates (rolled-up bulletins/publications/living-doc revisions) ─────
const SPACE_HREF: Record<string, (id: string) => string> = {
  group: (id) => `/groups/${id}`,
  project: (id) => `/projects/${id}`,
  responsibility: (id) => `/responsibilities/${id}`,
  coalition: (id) => `/coalitions/${id}`,
};

async function updateNotifs(prisma: PrismaClient, viewer: ViewerSpaces, prefs: NotificationPrefs, since: Date): Promise<DerivedNotif[]> {
  // Build the set of (spaceType, spaceId) the viewer belongs to, minus muted spaces.
  const muted = prefs.mutedSpaces;
  const spaces: Array<{ type: "group" | "project" | "responsibility" | "coalition"; id: string }> = [];
  const add = (type: "group" | "project" | "responsibility" | "coalition", ids: Set<string>) => {
    const mutedSet = new Set(muted[type] ?? []);
    for (const id of ids) if (!mutedSet.has(id)) spaces.push({ type, id });
  };
  add("group", viewer.groupIds);
  add("project", viewer.projectIds);
  add("responsibility", viewer.responsibilityIds);
  add("coalition", viewer.coalitionIds);
  if (!spaces.length) return [];

  const byType = (t: string) => spaces.filter((s) => s.type === t).map((s) => s.id);
  const orClause = SPACE_KEYS
    .map((k) => ({ key: k, ids: byType(k) }))
    .filter((x) => x.ids.length)
    .map((x) => ({ spaceType: x.key, spaceId: { in: x.ids } }));
  if (!orClause.length) return [];

  // Bulletins (the primary Updates source). publishedAt > since, not archived.
  const bulletins = await prisma.bulletin.findMany({
    where: { archivedAt: null, publishedAt: { gt: since }, OR: orClause },
    select: { id: true, spaceType: true, spaceId: true, title: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });
  if (!bulletins.length) return [];

  // Resolve space names.
  const names = await resolveSpaceNames(prisma, bulletins.map((b) => ({ type: b.spaceType, id: b.spaceId })));
  const nameOf = (type: string, id: string) => names.get(`${type}:${id}`) ?? "a space";
  const hrefOf = (type: string, id: string) => SPACE_HREF[type]?.(id) ?? null;
  const groupIdOf = (type: string, id: string) => (type === "group" ? id : null);

  if (!prefs.rollUpUpdates) {
    return bulletins.slice(0, 20).map((b) => ({
      id: `bulletin:${b.id}`,
      category: "updates" as const,
      title: `New bulletin in ${nameOf(b.spaceType, b.spaceId)}`,
      detail: b.title,
      href: hrefOf(b.spaceType, b.spaceId),
      groupId: groupIdOf(b.spaceType, b.spaceId),
      ...iso(b.publishedAt),
      isUnread: true,
    }));
  }

  // Roll up: one card per space with a count + latest publishedAt.
  const grouped = new Map<string, { type: string; id: string; count: number; latest: Date }>();
  for (const b of bulletins) {
    const key = `${b.spaceType}:${b.spaceId}`;
    const g = grouped.get(key);
    if (g) {
      g.count++;
      if (b.publishedAt > g.latest) g.latest = b.publishedAt;
    } else {
      grouped.set(key, { type: b.spaceType, id: b.spaceId, count: 1, latest: b.publishedAt });
    }
  }
  return [...grouped.values()].map((g) => ({
    id: `bulletins:${g.type}:${g.id}`,
    category: "updates" as const,
    title: `${g.count} new bulletin${g.count === 1 ? "" : "s"} in ${nameOf(g.type, g.id)}`,
    detail: null,
    href: hrefOf(g.type, g.id),
    groupId: groupIdOf(g.type, g.id),
    ...iso(g.latest),
    isUnread: true,
  }));
}

async function resolveSpaceNames(prisma: PrismaClient, spaces: Array<{ type: string; id: string }>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = (t: string) => [...new Set(spaces.filter((s) => s.type === t).map((s) => s.id))];
  const [groups, projects, responsibilities, coalitions] = await Promise.all([
    ids("group").length ? prisma.group.findMany({ where: { id: { in: ids("group") } }, select: { id: true, name: true } }) : [],
    ids("project").length ? prisma.project.findMany({ where: { id: { in: ids("project") } }, select: { id: true, name: true } }) : [],
    ids("responsibility").length ? prisma.responsibility.findMany({ where: { id: { in: ids("responsibility") } }, select: { id: true, type: true } }) : [],
    ids("coalition").length ? prisma.coalition.findMany({ where: { id: { in: ids("coalition") } }, select: { id: true, name: true } }) : [],
  ]);
  for (const g of groups) map.set(`group:${g.id}`, g.name);
  for (const p of projects) map.set(`project:${p.id}`, p.name);
  for (const r of responsibilities) map.set(`responsibility:${r.id}`, r.type);
  for (const c of coalitions) map.set(`coalition:${c.id}`, c.name);
  return map;
}

// ── Source: About you (non-muteable, person-targeting) ──────────────────────────
async function aboutYouNotifs(prisma: PrismaClient, accountId: string, viewer: ViewerSpaces, since: Date): Promise<DerivedNotif[]> {
  const out: DerivedNotif[] = [];
  const myMemberships = await prisma.groupMembership.findMany({ where: { accountId, status: "active" }, select: { id: true } });
  const myMembershipIds = myMemberships.map((m) => m.id);

  // Effective recall.
  const recalls = await prisma.responsibilityAssignment.findMany({
    where: { membership: { accountId }, endReason: "recall", endedAt: { gt: since } },
    select: { id: true, endedAt: true, responsibility: { select: { type: true, groupId: true, group: { select: { name: true } } } } },
    orderBy: { endedAt: "desc" },
    take: 20,
  });
  for (const a of recalls) {
    if (!a.endedAt) continue;
    out.push({
      id: `recall:${a.id}`,
      category: "aboutYou",
      title: `Your role as ${a.responsibility.type} ended by recall`,
      detail: `The collective ${a.responsibility.group?.name ?? ""} ended this role through a recall decision. View the decision and any next steps.`,
      href: `/groups/${a.responsibility.groupId}#petitions`,
      groupId: a.responsibility.groupId,
      ...iso(a.endedAt),
      isUnread: true,
    });
  }

  // Effective trusted-provider revocation.
  const revocations = await prisma.trustedProviderStatus.findMany({
    where: { membership: { accountId }, revokedAt: { gt: since } },
    select: { id: true, revokedAt: true, groupId: true, category: { select: { name: true } }, group: { select: { name: true } } },
    orderBy: { revokedAt: "desc" },
    take: 20,
  });
  for (const r of revocations) {
    if (!r.revokedAt) continue;
    out.push({
      id: `tp-revoke:${r.id}`,
      category: "aboutYou",
      title: "Your trusted-provider status was revoked",
      detail: `For ${r.category?.name ?? "a contribution category"} in ${r.group?.name ?? "a collective"}. View the decision.`,
      href: `/groups/${r.groupId}#petitions`,
      groupId: r.groupId,
      ...iso(r.revokedAt),
      isUnread: true,
    });
  }

  // During-window: an OPEN petition to recall you (subjectId = your assignment id).
  const myActiveAssignments = await prisma.responsibilityAssignment.findMany({
    where: { membership: { accountId }, endedAt: null },
    select: { id: true, responsibility: { select: { type: true, groupId: true, group: { select: { name: true } } } } },
  });
  const assignmentById = new Map(myActiveAssignments.map((a) => [a.id, a]));
  if (assignmentById.size) {
    const recallPetitions = await prisma.petition.findMany({
      where: { status: "open", subjectType: "responsibility_recall", subjectId: { in: [...assignmentById.keys()] } },
      select: { id: true, subjectId: true, opensAt: true, closesAt: true, scopeId: true },
      orderBy: { opensAt: "desc" },
      take: 20,
    });
    for (const p of recallPetitions) {
      const a = assignmentById.get(p.subjectId);
      if (!a) continue;
      out.push({
        id: `recall-open:${p.id}`,
        category: "aboutYou",
        title: `A petition to recall you from ${a.responsibility.type} is open`,
        detail: `Open until ${p.closesAt.toLocaleDateString()} in ${a.responsibility.group?.name ?? "a collective"}. You can respond while the window is open.`,
        href: `/groups/${a.responsibility.groupId}#petitions`,
        groupId: a.responsibility.groupId,
        ...iso(p.opensAt),
        isUnread: true,
      });
    }
  }

  // During-window: an OPEN petition to revoke your trusted-provider status.
  if (myMembershipIds.length) {
    const revReqs = await prisma.trustedProviderRevocationRequest.findMany({
      where: { membership: { accountId } },
      select: { id: true, groupId: true, group: { select: { name: true } } },
    });
    const reqById = new Map(revReqs.map((r) => [r.id, r]));
    if (reqById.size) {
      const revPetitions = await prisma.petition.findMany({
        where: { status: "open", subjectType: "trusted_provider_revocation", subjectId: { in: [...reqById.keys()] } },
        select: { id: true, subjectId: true, opensAt: true, closesAt: true },
        orderBy: { opensAt: "desc" },
        take: 20,
      });
      for (const p of revPetitions) {
        const req = reqById.get(p.subjectId);
        if (!req) continue;
        out.push({
          id: `tp-revoke-open:${p.id}`,
          category: "aboutYou",
          title: "A petition to revoke your trusted-provider status is open",
          detail: `Open until ${p.closesAt.toLocaleDateString()} in ${req.group?.name ?? "a collective"}. You can respond while the window is open.`,
          href: `/groups/${req.groupId}#petitions`,
          groupId: req.groupId,
          ...iso(p.opensAt),
          isUnread: true,
        });
      }
    }
  }

  return out;
}
