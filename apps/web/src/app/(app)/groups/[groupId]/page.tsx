import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BookOpen,
  FileText,
  Megaphone,
  MessageCircle,
  Shield,
} from "lucide-react";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { requireGroupMembership } from "../../../../lib/group-membership";
import { applyParticipationTransitions, getActiveParticipantCount, recordGroupPresence } from "../../../../lib/participation";
import { expireStaleAssignments, hasActiveEligibleAssignment, volunteerForResponsibility } from "../../../../lib/responsibilities";
import { getCoverageStatus } from "../../../../lib/concerns";
import { createBulletin } from "../../../../lib/bulletins";
import { createPublication } from "../../../../lib/publications";
import {
  createLivingDocument,
  draftLivingDocumentRevision,
  onLivingDocumentArchivalPetitionApproved,
  onRevisionPetitionApproved,
  openRevisionPetition,
} from "../../../../lib/living-documents";
import {
  createDiscussionThread,
  ensureGeneralDiscussion,
  listDiscussionMessages,
  listDiscussionThreads,
  onThreadClosurePetitionApproved,
  openThreadClosurePetition,
  postDiscussionMessage,
} from "../../../../lib/discussions";
import { addPetitionSupport, evaluatePetition, withdrawPetitionSupport } from "../../../../lib/petitions";
import { GOVERNANCE_CATEGORIES, type GovernanceCategory } from "../../../../lib/governance-categories";
import { resolveGovernanceParams } from "../../../../lib/governance-resolver";
import { upsertGovernanceSignal } from "../../../../lib/governance-temperature";
import { confirmResponsibilityAssignment } from "../../../../lib/responsibilities";
import {
  evaluateAndApplyPetition,
  describePetitionSubject,
  proposalFamilyLabel,
  governanceCategoryLabel,
} from "../../../../lib/petition-evaluation";
import { requiredString } from "../../../../lib/support-form";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { Section } from "../../../../components/shared/Section";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../../components/shared/Notice";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ groupId: string }>; searchParams: Promise<Record<string, string | string[]>> };

export default async function GroupSpacePage({ params, searchParams }: PageProps) {
  const { groupId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const data = await getGroupSpaceData(session.accountId, groupId, selectedThreadId);

  // Update active group only after getGroupSpaceData confirms membership — it redirects on failure,
  // so if we reach this line the user is a valid member of this group.
  if (session.activeGroupId !== groupId) {
    session.activeGroupId = groupId;
    await session.save();
  }

  const { group, currentMembership } = data;
  const isActive = currentMembership?.participationStatus === "active";
  const membershipId = currentMembership?.id ?? "";

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <AlphaNotice />
      {notice && <div className="mt-4"><Notice message={notice} /></div>}

      {/* ── Overview (always open) ─────────────────────────────────── */}
      <Section id="overview" title={group.name} eyebrow="Group coordination space">
        {group.description && <p className="text-sm leading-6 text-[var(--soft-text)]">{group.description}</p>}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
          <span>{data.activeParticipantCount} active {data.activeParticipantCount === 1 ? "member" : "members"}</span>
          {currentMembership && (
            <span className="capitalize">You: {currentMembership.participationStatus}</span>
          )}
        </div>
      </Section>

      <div className="mt-4 space-y-4">

        {/* ── Activity ──────────────────────────────────────────────── */}
        <CollapsibleSection id="activity" title="Activity" eyebrow="Help given" storageKey={`group:${groupId}:section:activity`}>
          {data.groupContributions.length > 0 ? (
            <div className="space-y-2">
              {data.groupContributions.map((c) => (
                <div key={c.type} className="flex items-center justify-between rounded bg-[var(--subtle)] px-3 py-2 text-sm">
                  <span className="capitalize text-[var(--soft-text)]">{c.type}</span>
                  <span className="text-[var(--muted)]">{c.count} {c.count === 1 ? "time" : "times"}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No contributions recorded yet." />
          )}
        </CollapsibleSection>

        {/* ── Discussion ────────────────────────────────────────────── */}
        <CollapsibleSection id="discussion" title="Discussion" eyebrow="Temporary coordination" storageKey={`group:${groupId}:section:discussion`}>
          {data.discussionThreads.length > 0 ? (
            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                {data.discussionThreads.map((thread) => (
                  <a
                    key={thread.id}
                    href={`/groups/${groupId}?discussionThread=${thread.id}#discussion`}
                    className={`block rounded border p-3 text-sm transition hover:bg-[var(--hover)] ${
                      data.selectedThread?.id === thread.id
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
                {data.selectedThread ? (
                  <>
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">{data.selectedThread.title}</p>
                        <p className="text-xs text-[var(--muted)]">Messages expire automatically.</p>
                      </div>
                      {isActive && (
                        <form action={openThreadClosurePetitionAction}>
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="threadId" value={data.selectedThread.id} />
                          <SubmitButton variant="secondary">Propose closure</SubmitButton>
                        </form>
                      )}
                    </div>
                    {data.discussionMessages.length > 0 ? (
                      <div className="mb-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                        {data.discussionMessages.map((msg) => (
                          <div key={msg.id} className="rounded bg-[var(--subtle)] px-3 py-2">
                            <p className="text-sm leading-6 text-[var(--soft-text)]">{msg.body}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {msg.author.displayName} &middot; {formatRelativeDate(msg.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="No active messages in this thread." />
                    )}
                    {isActive ? (
                      <form action={postDiscussionMessageAction} className="space-y-2">
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="threadId" value={data.selectedThread.id} />
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
          {isActive && (
            <form action={createDiscussionThreadAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">New thread</span>
                <input name="title" type="text" required className="field-input" placeholder="A focused coordination topic" />
              </label>
              <SubmitButton variant="secondary">Create thread</SubmitButton>
            </form>
          )}
        </CollapsibleSection>

        {/* ── Bulletins ─────────────────────────────────────────────── */}
        <CollapsibleSection id="bulletins" title="Bulletins" eyebrow="Group updates" storageKey={`group:${groupId}:section:bulletins`}>
          {data.bulletins.length > 0 ? (
            <div className="mb-4 space-y-3">
              {data.bulletins.map((b) => (
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
          {isActive && (
            <form action={createBulletinAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Title</span>
                <input name="title" type="text" required className="field-input" placeholder="A short title" />
              </label>
              <label className="block">
                <span className="field-label">Body</span>
                <textarea name="body" required rows={4} className="field-input resize-none" placeholder="Update text" />
              </label>
              <SubmitButton variant="secondary">Post bulletin</SubmitButton>
            </form>
          )}
        </CollapsibleSection>

        {/* ── Publications ──────────────────────────────────────────── */}
        <CollapsibleSection id="publications" title="Publications" eyebrow="Knowledge collections" storageKey={`group:${groupId}:section:publications`}>
          {data.publications.length > 0 ? (
            <div className="mb-4 space-y-3">
              {data.publications.map((p) => (
                <div key={p.id} className="rounded border border-[var(--border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No publications yet." />
          )}
          {isActive && (
            <form action={createPublicationAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Title</span>
                <input name="title" type="text" required className="field-input" placeholder="e.g. Community Resources" />
              </label>
              <SubmitButton variant="secondary">Create publication</SubmitButton>
            </form>
          )}
        </CollapsibleSection>

        {/* ── Living Documents ──────────────────────────────────────── */}
        <CollapsibleSection id="documents" title="Living Documents" eyebrow="Current reference texts" storageKey={`group:${groupId}:section:documents`}>
          {data.livingDocuments.length > 0 ? (
            <div className="mb-4 space-y-4">
              {data.livingDocuments.map((doc) => (
                <div key={doc.id} className="rounded border border-[var(--border)] p-3 space-y-2">
                  <p className="text-sm font-semibold text-[var(--text)]">{doc.title}</p>
                  <p className="text-xs leading-5 text-[var(--soft-text)] line-clamp-3">{doc.currentBody}</p>
                  <p className="text-xs text-[var(--muted)]">Last revised {formatRelativeDate(doc.lastRevisedAt)}</p>
                  {isActive && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a revision</summary>
                      <form action={proposeLivingDocumentRevisionAction} className="mt-2 space-y-2">
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="livingDocumentId" value={doc.id} />
                        <textarea name="body" required rows={4} defaultValue={doc.currentBody} className="field-input resize-none text-sm" />
                        <SubmitButton variant="secondary">Open revision petition</SubmitButton>
                      </form>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No living documents yet." />
          )}
          {isActive && (
            <form action={createLivingDocumentAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
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
          )}
        </CollapsibleSection>

        {/* ── Concerns ──────────────────────────────────────────────── */}
        <CollapsibleSection id="concerns" title="Concerns" eyebrow="Shared accountability" storageKey={`group:${groupId}:section:concerns`}>
          <div className="mb-4 flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${data.coverageStatus === "available" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
              Review Coverage: {data.coverageStatus === "available" ? "Available" : "Unavailable"}
            </span>
            {data.openConcernCount > 0 && (
              <span className="text-xs text-[var(--muted)]">
                {data.openConcernCount} active {data.openConcernCount === 1 ? "concern" : "concerns"}
              </span>
            )}
          </div>
          {data.coverageStatus === "unavailable" && (
            <p className="mb-4 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-xs text-[var(--muted)]">
              No active concern reviewers are currently available.
            </p>
          )}
          {data.reviewerQueue.length > 0 && (
            <div className="mb-5 space-y-3">
              <p className="text-xs font-medium text-[var(--muted)]">Reviewer queue</p>
              {data.reviewerQueue.map((concern) => (
                <div key={concern.id} className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{concern.subject}</p>
                    <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{concern.status.replace(/_/g, " ")}</span>
                  </div>
                  {concern.findings.length > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      {concern.findings.length} finding{concern.findings.length !== 1 ? "s" : ""}: {concern.findings.map((f) => f.outcome.replace(/_/g, " ")).join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.myReports.length > 0 && (
            <div className="mb-5 space-y-3">
              <p className="text-xs font-medium text-[var(--muted)]">Your concerns</p>
              {data.myReports.map((report) => (
                <div key={report.id} className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{report.subject}</p>
                    <span className="shrink-0 text-xs capitalize text-[var(--muted)]">{report.status.replace(/_/g, " ")}</span>
                  </div>
                  {report.closureReason && (
                    <p className="text-xs text-[var(--muted)]">Closed: {report.closureReason.replace(/_/g, " ")}</p>
                  )}
                  <p className="text-xs leading-5 text-[var(--soft-text)]">{report.description}</p>
                </div>
              ))}
            </div>
          )}
          <form action={submitConcernAction} className="space-y-4">
            <input type="hidden" name="groupId" value={groupId} />
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
        </CollapsibleSection>

        {/* ── Petitions ─────────────────────────────────────────────── */}
        <CollapsibleSection id="petitions" title="Petitions" eyebrow="Community decisions" storageKey={`group:${groupId}:section:petitions`}>
          <div className="space-y-4">
            <form action={evaluateClosedPetitionsAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <SubmitButton variant="secondary">Check petition outcomes</SubmitButton>
            </form>
            {data.petitions.length > 0 ? (
              <div className="space-y-3">
                {data.petitions.map((petition) => (
                  <PetitionCard
                    key={petition.id}
                    petition={petition}
                    canSupport={isActive}
                    groupId={groupId}
                  />
                ))}
              </div>
            ) : (
              <EmptyState text="No petitions yet. Proposed document revisions and responsibility volunteers will appear here." />
            )}
          </div>
        </CollapsibleSection>

        {/* ── Members ───────────────────────────────────────────────── */}
        <CollapsibleSection id="members" title="Members" eyebrow="Participation" storageKey={`group:${groupId}:section:members`}>
          <div className="space-y-2 text-sm text-[var(--soft-text)]">
            <p>{data.activeParticipantCount} fully active {data.activeParticipantCount === 1 ? "member" : "members"}</p>
            {currentMembership && (
              <p className="text-xs text-[var(--muted)]">Your status: <span className="capitalize">{currentMembership.participationStatus}</span></p>
            )}
          </div>
        </CollapsibleSection>

        {/* ── Projects ──────────────────────────────────────────────── */}
        <CollapsibleSection id="projects" title="Projects" eyebrow="Active coordination spaces" storageKey={`group:${groupId}:section:projects`}>
          {data.projects.length > 0 ? (
            <div className="space-y-3">
              {data.projects.map((project) => (
                <a key={project.id} href={`/projects/${project.id}`} className="block rounded border border-[var(--border)] bg-[var(--subtle)] p-3 hover:bg-[var(--hover)] transition">
                  <p className="text-sm font-medium text-[var(--text)]">{project.name}</p>
                  {project.description && <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-2">{project.description}</p>}
                  <p className="mt-1 text-xs text-[var(--muted)] capitalize">{project.status}</p>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text="No active projects." />
          )}
        </CollapsibleSection>

        {/* ── Responsibilities ──────────────────────────────────────── */}
        <CollapsibleSection id="responsibilities" title="Responsibilities" eyebrow="Community coverage" storageKey={`group:${groupId}:section:responsibilities`}>
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
              {data.coverageStatus === "unavailable" && isActive && (
                <form action={volunteerForReviewerAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <SubmitButton variant="secondary">Volunteer as reviewer</SubmitButton>
                </form>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Governance ────────────────────────────────────────────── */}
        <CollapsibleSection id="governance" title="Governance Settings" eyebrow="Decision friction" storageKey={`group:${groupId}:section:governance`}>
          <div className="space-y-4">
            {data.governanceSettings.map((setting) => (
              <div key={setting.category} className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3">
                <p className="text-sm font-medium text-[var(--text)]">{governanceCategoryLabel(setting.category)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Temperature: {formatPercent(setting.threshold)} threshold &middot; {Math.round(setting.petitionDuration)}d window
                </p>
                <form action={updateGovernanceSignalAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="category" value={setting.category} />
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { value: "-1", label: "More Careful" },
                      { value: "0", label: "Neutral" },
                      { value: "1", label: "Easier To Act" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="submit"
                        name="signal"
                        value={opt.value}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                          setting.signal === Number(opt.value)
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                            : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </form>
              </div>
            ))}
          </div>
        </CollapsibleSection>

      </div>
    </main>
  );
}

// ── Data Loading ─────────────────────────────────────────────────────────────

async function getGroupSpaceData(accountId: string, groupId: string, selectedThreadId: string | null) {
  const prisma = createPrismaClient();
  try {
    await recordGroupPresence(prisma, accountId, groupId);
    await applyParticipationTransitions(prisma, groupId);
    await expireStaleAssignments(prisma, groupId);

    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

    const currentMembership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!currentMembership || currentMembership.status !== "active") {
      redirect("/dashboard");
    }

    const [
      projects,
      bulletins,
      publications,
      livingDocuments,
      myReports,
      openConcernCount,
      groupContributions,
      activeParticipantCount,
    ] = await Promise.all([
      prisma.project.findMany({
        where: { groupId, status: "active", archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, description: true, status: true },
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
        select: { id: true, subject: true, context: true, description: true, status: true, closureReason: true, createdAt: true },
      }),
      prisma.report.count({
        where: { groupId, status: { in: ["open", "under_review", "findings_issued", "action_proposed"] } },
      }),
      prisma.contribution.groupBy({
        by: ["contributionType"],
        where: { groupId, visibility: "group" },
        _count: { contributionType: true },
        orderBy: { _count: { contributionType: "desc" } },
      }),
      getActiveParticipantCount(prisma, groupId),
    ]);

    // Petitions
    const petitionRows = await prisma.petition.findMany({
      where: { groupId },
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
        return {
          id: p.id,
          subjectType: p.subjectType,
          subjectLabel: await describePetitionSubject(prisma, p.subjectType, p.subjectId),
          status: p.status,
          closesAt: p.closesAt,
          resolvedAt: p.resolvedAt,
          supportCount: p._count.support,
          requiredSupport: Math.ceil(activeParticipantCount * threshold),
          supportedByCurrentMember: p.support.length > 0,
        };
      }),
    );

    // Governance
    const governanceCategories = GOVERNANCE_CATEGORIES.filter(
      (c): c is GovernanceCategory => ["living_document", "responsibility", "discussion"].includes(c),
    );
    const currentSignals = await prisma.memberGovernanceSignal.findMany({
      where: { membershipId: currentMembership.id, category: { in: governanceCategories } },
      select: { category: true, signal: true },
    });
    const signalByCategory = new Map(currentSignals.map((s) => [s.category, s.signal]));
    const governanceSettings = await Promise.all(
      governanceCategories.map(async (category) => {
        const params = await resolveGovernanceParams(prisma, groupId, category);
        return {
          category,
          threshold: params.threshold,
          petitionDuration: params.petitionDuration,
          signal: signalByCategory.get(category) ?? 0,
        };
      }),
    );

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
            findings: { select: { outcome: true } },
            actionProposals: { select: { status: true } },
          },
        })
      : [];

    return {
      group,
      currentMembership,
      projects,
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
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

// Full active participation required — for content creation, petitions, governance signals.
async function requireMembership(accountId: string, groupId: string) {
  const prisma = createPrismaClient();
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true, participationStatus: true },
  });
  await prisma.$disconnect();
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Active group membership required.");
  }
  return membership;
}

// Status-only check — for concern submission, which is available to all active-status members.
async function requireGroupMembershipStatus(accountId: string, groupId: string) {
  const prisma = createPrismaClient();
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true },
  });
  await prisma.$disconnect();
  if (!membership || membership.status !== "active") throw new Error("Group membership required.");
  return membership;
}

async function createDiscussionThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let threadId: string;
  try {
    const thread = await createDiscussionThread(prisma, {
      spaceType: "group",
      spaceId: groupId,
      groupId,
      createdByMembershipId: membership.id,
      title,
    });
    threadId = thread.id;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?discussionThread=${threadId}#discussion`);
}

async function postDiscussionMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await postDiscussionMessage(prisma, { threadId, groupId, authorMembershipId: membership.id, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?discussionThread=${threadId}#discussion`);
}

async function openThreadClosurePetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const threadId = requiredString(formData, "threadId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Thread closure petition opened.";
  try {
    const result = await openThreadClosurePetition(prisma, { threadId, groupId, createdByMembershipId: membership.id });
    if (!result.ok) notice = discussionPetitionFailureNotice(result.reason);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?discussionThread=${threadId}&notice=${encodeURIComponent(notice)}#discussion`);
}

async function createBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await createBulletin(prisma, { spaceType: "group", spaceId: groupId, title, body, authorId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#bulletins`);
}

async function createPublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await createPublication(prisma, { spaceType: "group", spaceId: groupId, title, createdByAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#publications`);
}

async function createLivingDocumentAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await createLivingDocument(prisma, { spaceType: "group", spaceId: groupId, title, body, authorId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#documents`);
}

async function proposeLivingDocumentRevisionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const livingDocumentId = requiredString(formData, "livingDocumentId");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const draft = await draftLivingDocumentRevision(prisma, { livingDocumentId, body, authorId: session.accountId });
    await openRevisionPetition(prisma, { livingDocumentId, revisionId: draft.id, groupId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#documents`);
}

async function submitConcernAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const subject = requiredString(formData, "subject");
  const description = requiredString(formData, "description");
  const context = formData.get("context") as string | null;
  await requireGroupMembershipStatus(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await prisma.report.create({
      data: { groupId, reportedByAccountId: session.accountId, subject, description, context: context || null },
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#concerns`);
}

async function supportPetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await addPetitionSupport(prisma, { petitionId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#petitions`);
}

async function withdrawPetitionSupportAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await withdrawPetitionSupport(prisma, { petitionId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#petitions`);
}

async function evaluatePetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#petitions`);
}

async function evaluateClosedPetitionsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();
  try {
    const closed = await prisma.petition.findMany({
      where: { groupId, status: "open", closesAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const p of closed) {
      await evaluateAndApplyPetition(prisma, p.id);
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#petitions`);
}

async function volunteerForReviewerAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await volunteerForResponsibility(prisma, { membershipId: membership.id, type: "reviewer" });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#responsibilities`);
}

async function updateGovernanceSignalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const category = requiredString(formData, "category") as GovernanceCategory;
  const signalRaw = formData.get("signal");
  const signal = signalRaw === "-1" ? -1 : signalRaw === "1" ? 1 : 0;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await upsertGovernanceSignal(prisma, { membershipId: membership.id, groupId, category, signal });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#governance`);
}

// ── Local Components ──────────────────────────────────────────────────────────

type SpacePetition = {
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

function PetitionCard({ petition, canSupport, groupId }: { petition: SpacePetition; canSupport: boolean; groupId: string }) {
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
      {isOpen && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canSupport ? (
            petition.supportedByCurrentMember ? (
              <form action={withdrawPetitionSupportAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Withdraw support</SubmitButton>
              </form>
            ) : (
              <form action={supportPetitionAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Support</SubmitButton>
              </form>
            )
          ) : (
            <p className="text-xs text-[var(--muted)]">Only active members may support petitions.</p>
          )}
          <form action={evaluatePetitionAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="petitionId" value={petition.id} />
            <SubmitButton variant="secondary">Check outcome</SubmitButton>
          </form>
        </div>
      )}
    </article>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function discussionPetitionFailureNotice(reason: string) {
  switch (reason) {
    case "creator_not_eligible": return "Only active members can propose closing a discussion thread.";
    case "petition_already_open": return "A closure petition is already open for this discussion thread.";
    default: return "This discussion closure petition could not be opened.";
  }
}
