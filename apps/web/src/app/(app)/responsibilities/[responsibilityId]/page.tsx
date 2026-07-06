import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { proposeBulletinCreation } from "../../../../lib/bulletins";
import { proposePublicationCreation, proposePubEntryCreation } from "../../../../lib/publications";
import { proposeLivingDocumentCreation, draftLivingDocumentRevision, openRevisionPetition } from "../../../../lib/living-documents";
import { createDiscussionThread, listDiscussionMessages, listDiscussionThreads, postDiscussionMessage } from "../../../../lib/discussions";
import { getResponsibilityPurposeDocument, requireResponsibilityHolderMembership, resignAssignment, volunteerForResponsibility } from "../../../../lib/responsibilities";
import { responsibilityTypeLabel } from "../../../../lib/concern-reviewer";
import { requiredString } from "../../../../lib/support-form";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { DiscussionMessage } from "../../../../components/shared/DiscussionMessage";
import { LocalTime } from "../../../../components/shared/LocalTime";
import { AlphaNotice, Notice } from "../../../../components/shared/Notice";
import { type FormState } from "../../../../components/shared/form-state";
import { SpaceCalendar } from "../../../../components/shared/SpaceCalendar";
import { loadSpaceCalendarData } from "../../../../lib/calendar-data";
import { submitEvent, setInterest, cancelEvent } from "../../../../lib/events";
import { parseEventSubmission, submitEventFailureMessage } from "../../../../lib/event-form";
import type { EventInterestLevel } from "../../../../generated/prisma/enums";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ responsibilityId: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
};

export default async function ResponsibilitySpacePage({ params, searchParams }: PageProps) {
  const { responsibilityId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const data = await getResponsibilitySpaceData(session.accountId, responsibilityId, selectedThreadId);

  const { responsibility, currentMembership } = data;
  const isActive = currentMembership?.participationStatus === "active";
  const isHolder = data.isHolder;

  const calendar = await loadSpaceCalendarData(session.accountId, "responsibility", responsibilityId);

  async function submitResponsibilityEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const input = parseEventSubmission(formData, { accountId: s.accountId, hostType: "responsibility", hostId: responsibilityId });
    const prisma = createPrismaClient();
    try {
      const result = await submitEvent(prisma, input);
      if (!result.ok) return { kind: "error", message: submitEventFailureMessage(result.reason) };
      revalidatePath(`/responsibilities/${responsibilityId}`);
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
    revalidatePath(`/responsibilities/${responsibilityId}`);
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
    revalidatePath(`/responsibilities/${responsibilityId}`);
  }

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
      <AlphaNotice />
      {notice && <div className="mt-4"><Notice message={notice} /></div>}

      {/* ── Overview + Discussion ─────────────────────────────────── */}
      <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
        <div id="overview" className="bg-[var(--surface)] p-5 sm:p-6">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Responsibility</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)] capitalize">{responsibilityTypeLabel(responsibility.type)}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <a href={`/groups/${responsibility.groupId}`} className="text-[var(--accent)] hover:underline">
              ↑ {data.groupName}
            </a>
            <span>{data.holders.length} {data.holders.length === 1 ? "holder" : "holders"}</span>
            <span>Term: {responsibility.termDays} days</span>
          </div>

          {/* Purpose */}
          <div className="mt-4">
            <p className="text-xs font-medium text-[var(--muted)]">Purpose</p>
            {data.purposeDocument ? (
              <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">{data.purposeDocument.currentBody}</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--muted)]">
                No purpose statement yet — propose a &quot;Purpose&quot; living document in the{" "}
                <a href={`/responsibilities/${responsibilityId}#documents`} className="text-[var(--accent)] hover:underline">
                  Living Documents
                </a>{" "}
                section to give this role a social contract.
              </p>
            )}
          </div>

          {/* Holders */}
          {data.holders.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium text-[var(--muted)]">Current holders</p>
              {data.holders.map((h) => (
                <div key={h.membershipId} className="flex items-start justify-between text-sm text-[var(--soft-text)]">
                  <span>{h.displayName}</span>
                  <div className="text-right">
                    <p className="text-xs capitalize text-[var(--muted)]">{h.participationStatus}</p>
                    <p className="text-xs text-[var(--muted)]">
                      expires <LocalTime value={h.expiresAt.toISOString()} options={{ month: "short", day: "numeric", year: "numeric" }} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-3">
            {isActive && !isHolder && (
              <form action={volunteerAction}>
                <input type="hidden" name="responsibilityId" value={responsibilityId} />
                <SubmitButton variant="secondary">Volunteer</SubmitButton>
              </form>
            )}
            {isHolder && (
              <form action={resignAction}>
                <input type="hidden" name="responsibilityId" value={responsibilityId} />
                <button type="submit" className="text-xs text-amber-700 hover:text-amber-600 transition">
                  Resign
                </button>
              </form>
            )}
          </div>
        </div>

        {isHolder && (
        <CollapsibleSection id="discussion" title="Discussion" eyebrow="Coordination" storageKey={`responsibility:${responsibilityId}:section:discussion`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.discussionThreads.length > 0 ? (
            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                {data.discussionThreads.map((thread) => (
                  <a
                    key={thread.id}
                    href={`/responsibilities/${responsibilityId}?discussionThread=${thread.id}#discussion`}
                    className={`block border p-3 text-sm transition hover:bg-[var(--hover)] ${
                      data.selectedThread?.id === thread.id
                        ? "border-[var(--accent)] bg-[var(--subtle)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <span className="font-medium text-[var(--text)]">{thread.title}</span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
                    </span>
                  </a>
                ))}
              </div>
              <div className="border border-[var(--border)] p-3">
                {data.selectedThread ? (
                  <>
                    <p className="text-sm font-semibold text-[var(--text)]">{data.selectedThread.title}</p>
                    {data.discussionMessages.length > 0 ? (
                      <div className="mb-3 mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
                        {data.discussionMessages.map((msg) => (
                          <DiscussionMessage
                            key={msg.id}
                            body={msg.body}
                            authorName={msg.author.displayName}
                            authorId={msg.authorId}
                            viewerAccountId={session.accountId ?? null}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="No messages yet." />
                    )}
                    {isHolder && currentMembership && (
                      <form action={postMessageAction} className="space-y-2 mt-2">
                        <input type="hidden" name="responsibilityId" value={responsibilityId} />
                        <input type="hidden" name="threadId" value={data.selectedThread.id} />
                        <textarea name="body" required rows={3} className="field-input resize-none" placeholder="Add a note." />
                        <SubmitButton variant="secondary">Post message</SubmitButton>
                      </form>
                    )}
                  </>
                ) : (
                  <EmptyState text="Select a thread." />
                )}
              </div>
            </div>
          ) : (
            <EmptyState text="No discussion threads yet." />
          )}
          {isHolder && currentMembership && (
            <form action={createThreadAction} className="space-y-3">
              <input type="hidden" name="responsibilityId" value={responsibilityId} />
              <label className="block">
                <span className="field-label">New thread</span>
                <input name="title" type="text" required className="field-input" placeholder="Coordination topic" />
              </label>
              <SubmitButton variant="secondary">Create thread</SubmitButton>
            </form>
          )}
        </CollapsibleSection>
        )}

        {responsibility.type === "reviewer" && isHolder && data.activeConcerns.length > 0 && (
          <CollapsibleSection id="concerns" title="Concerns" eyebrow="Shared accountability" storageKey={`responsibility:${responsibilityId}:section:concerns`} className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="space-y-3">
              {data.activeConcerns.map((concern) => (
                <a
                  key={concern.id}
                  href={`/groups/${responsibility.groupId}/concerns/${concern.id}`}
                  className="block space-y-1 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 transition hover:border-[var(--border-strong)] hover:bg-[var(--hover)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{concern.subject}</p>
                    <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{concern.status.replace(/_/g, " ")}</span>
                  </div>
                  {concern.findings.length > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      {concern.findings.length} finding{concern.findings.length !== 1 ? "s" : ""}: {concern.findings.map((f) => f.outcome.replace(/_/g, " ")).join(", ")}
                    </p>
                  )}
                  <p className="text-xs font-medium text-[var(--accent)]">View / review →</p>
                </a>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Calendar ─────────────────────────────────────────────── */}
        <SpaceCalendar
          sectionId="calendar"
          storageKey={`responsibility:${responsibilityId}:section:calendar`}
          events={calendar.events}
          myInterests={calendar.myInterests}
          audiences={calendar.audiences}
          canCreate={isHolder}
          allowMeeting
          currentAccountId={session.accountId}
          submitAction={submitResponsibilityEventAction}
          interestAction={eventInterestAction}
          cancelAction={eventCancelAction}
        />

        {/* ── Library ──────────────────────────────────────────────── */}
        {isHolder && (
        <CollapsibleSection id="library" title="Library" eyebrow="Resources" storageKey={`responsibility:${responsibilityId}:section:library`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="divide-y divide-[var(--border)] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-3">
            <details id="bulletins" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Updates</span>
                  <span className="mt-1 block text-xl font-bold tracking-tight">Bulletins</span>
                </span>
                <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
                <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
              </summary>
              <div className="px-5 sm:px-6 pb-5 space-y-3">
                {data.bulletins.length > 0 ? (
                  <div className="space-y-3">
                    {data.bulletins.map((b) => (
                      <div key={b.id} className="border border-[var(--border)] p-3">
                        <p className="text-sm font-medium text-[var(--text)]">{b.title}</p>
                        <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-3">{b.body}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{b.author.displayName}</p>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState text="No bulletins yet." />}
                {isHolder && data.capabilities.canCreateBulletins && (
                  <form action={createBulletinAction} className="space-y-3">
                    <input type="hidden" name="responsibilityId" value={responsibilityId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={3} className="field-input resize-none" /></label>
                    <SubmitButton variant="secondary">Propose bulletin</SubmitButton>
                  </form>
                )}
                {isHolder && !data.capabilities.canCreateBulletins && (
                  <p className="text-xs text-[var(--muted)]">This responsibility was not granted the “create bulletins” ability.</p>
                )}
              </div>
            </details>

            <details id="publications" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Knowledge collections</span>
                  <span className="mt-1 block text-xl font-bold tracking-tight">Publications</span>
                </span>
                <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
                <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
              </summary>
              <div className="px-5 sm:px-6 pb-5 space-y-3">
                {data.publications.length > 0 ? (
                  <div className="space-y-3">
                    {data.publications.map((p) => (
                      <div key={p.id} className="border border-[var(--border)] p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                        </div>
                        <p className="text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                        {isHolder && data.capabilities.canCreatePublicationEntries && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose an entry</summary>
                            <form action={proposePubEntryAction} className="mt-2 space-y-2">
                              <input type="hidden" name="responsibilityId" value={responsibilityId} />
                              <input type="hidden" name="publicationId" value={p.id} />
                              <label className="block"><span className="field-label text-xs">Title (optional)</span><input name="title" type="text" className="field-input text-sm" /></label>
                              <label className="block"><span className="field-label text-xs">Body</span><textarea name="body" required rows={3} className="field-input resize-none text-sm" /></label>
                              <SubmitButton variant="secondary">Propose entry</SubmitButton>
                            </form>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState text="No publications yet." />}
                {isHolder && data.capabilities.canCreatePublications && (
                  <form action={createPublicationAction} className="space-y-3">
                    <input type="hidden" name="responsibilityId" value={responsibilityId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" /></label>
                    <SubmitButton variant="secondary">Propose publication</SubmitButton>
                  </form>
                )}
                {isHolder && !data.capabilities.canCreatePublications && (
                  <p className="text-xs text-[var(--muted)]">This responsibility was not granted the “create publications” ability.</p>
                )}
              </div>
            </details>

            <details id="documents" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Reference texts</span>
                  <span className="mt-1 block text-xl font-bold tracking-tight">Living Documents</span>
                </span>
                <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
                <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
              </summary>
              <div className="px-5 sm:px-6 pb-5 space-y-4">
                {data.livingDocuments.length > 0 ? (
                  <div className="space-y-4">
                    {data.livingDocuments.map((doc) => (
                      <div key={doc.id} className="border border-[var(--border)] p-3 space-y-2">
                        <p className="text-sm font-semibold text-[var(--text)]">{doc.title}</p>
                        <p className="text-xs leading-5 text-[var(--soft-text)] line-clamp-3">{doc.currentBody}</p>
                        {isHolder && currentMembership && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a revision</summary>
                            <form action={proposeRevisionAction} className="mt-2 space-y-2">
                              <input type="hidden" name="responsibilityId" value={responsibilityId} />
                              <input type="hidden" name="livingDocumentId" value={doc.id} />
                              <textarea name="body" required rows={4} defaultValue={doc.currentBody} className="field-input resize-none text-sm" />
                              <SubmitButton variant="secondary">Open revision petition</SubmitButton>
                            </form>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState text="No living documents yet." />}
                {isHolder && (
                  <form action={createDocumentAction} className="space-y-3">
                    <input type="hidden" name="responsibilityId" value={responsibilityId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={4} className="field-input resize-none" /></label>
                    <SubmitButton variant="secondary">Propose document</SubmitButton>
                  </form>
                )}
              </div>
            </details>
          </div>
        </CollapsibleSection>
        )}
      </div>
      </div>
    </main>
  );
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function getResponsibilitySpaceData(accountId: string, responsibilityId: string, selectedThreadId: string | null) {
  const prisma = createPrismaClient();
  try {
    const responsibility = await prisma.responsibility.findUnique({
      where: { id: responsibilityId },
      select: { id: true, type: true, groupId: true, termDays: true, descriptionDocumentId: true, group: { select: { name: true } }, abilities: { select: { ability: true } } },
    });
    if (!responsibility) redirect("/dashboard");

    const currentMembership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId: responsibility.groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!currentMembership || currentMembership.status !== "active") redirect("/dashboard");

    const assignments = await prisma.responsibilityAssignment.findMany({
      where: { responsibility: { id: responsibilityId }, endedAt: null, expiresAt: { gt: new Date() } },
      include: { membership: { select: { accountId: true, status: true, participationStatus: true, account: { select: { displayName: true } } } } },
    });

    const holders = assignments.map((a) => ({
      membershipId: a.membershipId,
      displayName: a.membership.account.displayName,
      participationStatus: a.membership.participationStatus,
      expiresAt: a.expiresAt,
    }));

    // Active holder = unexpired, unended assignment tied to active membership
    // and active participation (mirrors hasActiveEligibleAssignment).
    const isHolder = assignments.some(
      (a) =>
        a.membership.accountId === accountId &&
        a.membership.status === "active" &&
        a.membership.participationStatus === "active",
    );

    // Purpose stays visible to every active group member (prospective
    // volunteers included) — fetched on its own, not via the full Library
    // listing, which is restricted to holders below.
    const purposeDocument = await getResponsibilityPurposeDocument(prisma, responsibilityId, responsibility.descriptionDocumentId);

    // Coordination-space content below is restricted to active holders —
    // other active group members may see the overview and Purpose, but not
    // the responsibility's internal workspace.
    const [bulletins, publications, livingDocuments] = isHolder
      ? await Promise.all([
          prisma.bulletin.findMany({
            where: { spaceType: "responsibility", spaceId: responsibilityId, archivedAt: null },
            include: { author: { select: { displayName: true } } },
            orderBy: { publishedAt: "desc" },
          }),
          prisma.publication.findMany({
            where: { spaceType: "responsibility", spaceId: responsibilityId, archivedAt: null },
            include: {
              creator: { select: { displayName: true } },
              _count: { select: { entries: { where: { archivedAt: null } } } },
            },
            orderBy: { createdAt: "desc" },
          }),
          prisma.livingDocument.findMany({
            where: { spaceType: "responsibility", spaceId: responsibilityId, archivedAt: null },
            orderBy: { lastRevisedAt: "desc" },
          }),
        ])
      : [[], [], []] as const;

    const discussionThreads = isHolder
      ? await listDiscussionThreads(prisma, {
          spaceType: "responsibility",
          spaceId: responsibilityId,
          groupId: responsibility.groupId,
        })
      : [];
    const selectedThread = discussionThreads.find((t) => t.id === selectedThreadId) ?? discussionThreads[0] ?? null;
    const discussionMessages = selectedThread ? await listDiscussionMessages(prisma, selectedThread.id) : [];

    // Active concerns: read-only view for active reviewer holders, mirroring
    // the group page's reviewer-queue pattern.
    const activeConcernsRaw =
      responsibility.type === "reviewer" && isHolder
        ? await prisma.report.findMany({
            where: {
              groupId: responsibility.groupId,
              status: { in: ["open", "under_review", "findings_issued", "action_proposed"] },
              reportedByAccountId: { not: accountId },
            },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              subject: true,
              status: true,
              subjectAccountId: true,
              findings: { select: { outcome: true } },
            },
          })
        : [];
    // A reviewer who is the SUBJECT of a concern may not see it (RFC-002 / feedback #7).
    // Filter in memory so null-subject concerns stay visible; strip subjectAccountId after.
    const activeConcerns = activeConcernsRaw
      .filter((r) => r.subjectAccountId !== accountId)
      // Rebuild without subjectAccountId so it never reaches the client.
      .map((r) => ({ id: r.id, subject: r.subject, status: r.status, findings: r.findings }));

    // Publishing in a responsibility's own space is the responsibility acting (F1): the compose
    // forms appear only when the role carries the matching create_* ability (granted at proposal
    // time). Emergency-only abilities still gate on an active emergency at submit.
    const grantedAbilities = new Set(responsibility.abilities.map((a) => a.ability));
    const capabilities = {
      canCreateBulletins: grantedAbilities.has("create_bulletins"),
      canCreatePublications: grantedAbilities.has("create_publications"),
      canCreatePublicationEntries: grantedAbilities.has("create_publication_entries"),
    };

    return {
      responsibility: { ...responsibility, termDays: responsibility.termDays },
      groupName: responsibility.group.name,
      currentMembership,
      holders,
      isHolder,
      capabilities,
      purposeDocument,
      bulletins,
      publications,
      livingDocuments,
      discussionThreads,
      selectedThread,
      discussionMessages,
      activeConcerns,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

async function volunteerAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const prisma = createPrismaClient();
  try {
    const responsibility = await prisma.responsibility.findUniqueOrThrow({ where: { id: responsibilityId }, select: { type: true, groupId: true } });
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId: responsibility.groupId } },
      select: { id: true },
    });
    if (membership) await volunteerForResponsibility(prisma, { membershipId: membership.id, type: responsibility.type });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function resignAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const prisma = createPrismaClient();
  try {
    const responsibility = await prisma.responsibility.findUniqueOrThrow({ where: { id: responsibilityId }, select: { type: true, groupId: true } });
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId: responsibility.groupId } },
      select: { id: true },
    });
    if (membership) await resignAssignment(prisma, membership.id, responsibility.type);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function createThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    await createDiscussionThread(prisma, { spaceType: "responsibility", spaceId: responsibilityId, groupId: responsibility.groupId, title, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function postMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    await postDiscussionMessage(prisma, { threadId, groupId: responsibility.groupId, authorMembershipId: membership.id, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function createBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    // Content posted in a responsibility's own space is the responsibility acting (F1): gated on
    // its create_bulletins ability, so the granted ability is real, term-bound, and emergency-aware.
    await proposeBulletinCreation(prisma, { spaceType: "responsibility", spaceId: responsibilityId, groupId: responsibility.groupId, title, body, createdByMembershipId: membership.id, actingResponsibilityId: responsibilityId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function createPublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    await proposePublicationCreation(prisma, { spaceType: "responsibility", spaceId: responsibilityId, groupId: responsibility.groupId, title, createdByMembershipId: membership.id, actingResponsibilityId: responsibilityId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function proposePubEntryAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const publicationId = requiredString(formData, "publicationId");
  const body = requiredString(formData, "body");
  const title = formData.get("title") as string | null;
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    await proposePubEntryCreation(prisma, { spaceType: "responsibility", spaceId: responsibilityId, publicationId, groupId: responsibility.groupId, body, title: title || undefined, createdByMembershipId: membership.id, actingResponsibilityId: responsibilityId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function createDocumentAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    await proposeLivingDocumentCreation(prisma, { spaceType: "responsibility", spaceId: responsibilityId, groupId: responsibility.groupId, title, body, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

async function proposeRevisionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const responsibilityId = formData.get("responsibilityId") as string;
  const livingDocumentId = requiredString(formData, "livingDocumentId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    const { membership, responsibility } = await requireResponsibilityHolderMembership(prisma, session.accountId, responsibilityId);
    const document = await prisma.livingDocument.findUniqueOrThrow({
      where: { id: livingDocumentId },
      select: { spaceType: true, spaceId: true },
    });
    if (document.spaceType !== "responsibility" || document.spaceId !== responsibilityId) {
      throw new Error("This document does not belong to this responsibility's coordination space.");
    }
    const draft = await draftLivingDocumentRevision(prisma, { livingDocumentId, body, authorId: session.accountId });
    await openRevisionPetition(prisma, { livingDocumentId, revisionId: draft.id, createdByMembershipId: membership.id, groupId: responsibility.groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/responsibilities/${responsibilityId}`);
}

