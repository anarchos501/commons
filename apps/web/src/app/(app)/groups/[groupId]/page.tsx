import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { applyParticipationTransitions, getActiveParticipantCount, recordGroupPresence } from "../../../../lib/participation";
import { expireStaleAssignments, hasActiveEligibleAssignment, resignAssignment, volunteerForResponsibility } from "../../../../lib/responsibilities";
import { getCoverageStatus } from "../../../../lib/concerns";
import { createBulletin, openBulletinArchivalPetition } from "../../../../lib/bulletins";
import { createPublication, openPublicationArchivalPetition } from "../../../../lib/publications";
import {
  createLivingDocument,
  draftLivingDocumentRevision,
  openRevisionPetition,
} from "../../../../lib/living-documents";
import {
  createDiscussionThread,
  ensureGeneralDiscussion,
  listDiscussionMessages,
  listDiscussionThreads,
  openThreadClosurePetition,
  postDiscussionMessage,
} from "../../../../lib/discussions";
import { addPetitionSupport, withdrawPetitionSupport } from "../../../../lib/petitions";
import { sponsorMembershipApplication, dismissMembershipApplication } from "../../../../lib/group-membership";
import { proposeProject } from "../../../../lib/projects";
import {
  CATEGORY_REGISTRY,
  GOVERNANCE_CATEGORIES,
  resolveParameter,
  type GovernanceCategory,
} from "../../../../lib/governance-categories";
import { openEmergencyPetition } from "../../../../lib/emergency";
import { proposeGroupVisibility } from "../../../../lib/group-settings";
import {
  generateGroupInviteToken,
  getActiveGroupInvitePreview,
  revokeAllGroupInviteTokens,
} from "../../../../lib/group-invites";
import { computeAllParameterTemperatures, upsertGovernanceSignal } from "../../../../lib/governance-temperature";
import {
  evaluateAndApplyPetition,
  describePetitionSubject,
  proposalFamilyLabel,
  governanceCategoryLabel,
} from "../../../../lib/petition-evaluation";
import {
  proposeContributionCategory,
  proposeContributionCategoryArchival,
  getAvailableCategoriesForScope,
} from "../../../../lib/contribution-categories";
import {
  proposeTrustedProviderStatus,
  proposeTrustedProviderRevocation,
  getTrustedProvidersForCategory,
  formatTrustedByLabel,
} from "../../../../lib/trusted-providers";
import { requiredString } from "../../../../lib/support-form";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../../components/shared/Notice";
import { GroupContextSync } from "../../../../components/shared/GroupContextSync";
import { CopyInviteLinkButton } from "../../../../components/shared/CopyInviteLinkButton";
import { ClearPendingInviteToken } from "../../../../components/shared/ClearPendingInviteToken";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ groupId: string }>; searchParams: Promise<Record<string, string | string[]>> };

export default async function GroupSpacePage({ params, searchParams }: PageProps) {
  const { groupId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;
  const activityFilter = typeof sp.activityFilter === "string" ? sp.activityFilter : "month";

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  // One-time invite URL: read raw token from session on ?invite=new.
  // Clearing happens via route handler after render; Server Components cannot write cookies.
  let oneTimeInviteUrl: string | null = null;
  if (sp.invite === "new") {
    const pending = session.pendingInviteToken;
    if (pending && pending.groupId === groupId) {
      const hdrList = await headers();
      const host = hdrList.get("host") ?? "localhost:3000";
      const proto =
        process.env.NODE_ENV === "production"
          ? (hdrList.get("x-forwarded-proto") ?? "https")
          : "http";
      oneTimeInviteUrl = `${proto}://${host}/invite/${pending.rawToken}`;
    }
  }

  const data = await getGroupSpaceData(session.accountId, groupId, selectedThreadId, activityFilter);

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

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <GroupContextSync syncAction={syncGroupContext} />
      <AlphaNotice />
      {notice && <div className="mt-4"><Notice message={notice} /></div>}

      {/* ── Overview + Discussion (connected) ─────────────────────── */}
      <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
        <div id="overview" className="bg-[var(--surface)] p-5 sm:p-6">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Group coordination space</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)]">{group.name}</h1>
          {group.description && <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{group.description}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <span>{data.activeParticipantCount} active {data.activeParticipantCount === 1 ? "member" : "members"}</span>
            {currentMembership && (
              <span className="capitalize">You: {currentMembership.participationStatus}</span>
            )}
          </div>

          {/* ── Activity (inline collapsible) ─────────────────────────── */}
          <details className="group/activity mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--soft-text)] hover:text-[var(--text)] select-none">
              <span>Activity</span>
              <span className="text-[var(--muted)] group-open/activity:hidden">▸</span>
              <span className="hidden text-[var(--muted)] group-open/activity:inline">▾</span>
            </summary>
            <div className="mt-3">
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  { value: "week", label: "1 week" },
                  { value: "month", label: "1 month" },
                  { value: "3month", label: "3 months" },
                  { value: "6month", label: "6 months" },
                  { value: "all", label: "All time" },
                ].map((opt) => (
                  <a
                    key={opt.value}
                    href={`/groups/${groupId}?activityFilter=${opt.value}#overview`}
                    className={`border px-2 py-0.5 text-xs font-medium transition focus:outline-none focus:ring-1 focus:ring-[var(--accent)] ${
                      activityFilter === opt.value
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                        : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
                    }`}
                  >
                    {opt.label}
                  </a>
                ))}
              </div>
              {data.groupContributions.length > 0 ? (
                <div className="space-y-1.5">
                  {data.groupContributions.map((c) => (
                    <div key={c.type} className="flex items-center justify-between bg-[var(--subtle)] px-3 py-2 text-sm">
                      <span className="capitalize text-[var(--soft-text)]">{c.type}</span>
                      <span className="text-[var(--muted)]">{c.count} {c.count === 1 ? "time" : "times"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">No activity recorded for this period.</p>
              )}
            </div>
          </details>
        </div>


        <CollapsibleSection id="discussion" title="Discussion" eyebrow="Temporary coordination" storageKey={`group:${groupId}:section:discussion`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.discussionThreads.length > 0 ? (
            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                {data.discussionThreads.map((thread) => (
                  <a
                    key={thread.id}
                    href={`/groups/${groupId}?discussionThread=${thread.id}#discussion`}
                    className={`block border p-3 text-sm transition hover:bg-[var(--hover)] ${
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
              <div className="border border-[var(--border)] p-3">
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
                          <div key={msg.id} className="bg-[var(--subtle)] px-3 py-2">
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
        {/* ══ Library ═══════════════════════════════════════════════════ */}
        <CollapsibleSection id="library" title="Library" eyebrow="Group resources" storageKey={`group:${groupId}:section:library`} className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="divide-y divide-[var(--border)] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-3">

            {/* Bulletins nested */}
            <details id="bulletins" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Group updates</span>
                  <span className="mt-1 block text-xl font-bold tracking-tight">Bulletins</span>
                </span>
                <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
                <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
              </summary>
              <div className="px-5 sm:px-6 pb-5 space-y-3">
          {data.bulletins.length > 0 ? (
            <div className="mb-4 space-y-3">
              {data.bulletins.map((b) => (
                <div key={b.id} className="border border-[var(--border)] p-3">
                  <p className="text-sm font-medium text-[var(--text)]">{b.title}</p>
                  <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-3">{b.body}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--muted)]">
                      {b.author.displayName} &middot; {formatRelativeDate(b.publishedAt)}
                    </p>
                    {isActive && (
                      <form action={archiveBulletinAction}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="bulletinId" value={b.id} />
                        <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                          Archive
                        </button>
                      </form>
                    )}
                  </div>
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
              </div>
            </details>

            {/* Publications nested */}
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
            <div className="mb-4 space-y-3">
              {data.publications.map((p) => (
                <div key={p.id} className="border border-[var(--border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                    {isActive && (
                      <form action={archivePublicationAction}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="publicationId" value={p.id} />
                        <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                          Archive
                        </button>
                      </form>
                    )}
                  </div>
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
              </div>
            </details>

            {/* Living Documents nested */}
            <details id="documents" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Current reference texts</span>
                  <span className="mt-1 block text-xl font-bold tracking-tight">Living Documents</span>
                </span>
                <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
                <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
              </summary>
              <div className="px-5 sm:px-6 pb-5 space-y-4">
          {data.livingDocuments.length > 0 ? (
            <div className="mb-4 space-y-4">
              {data.livingDocuments.map((doc) => (
                <div key={doc.id} className="border border-[var(--border)] p-3 space-y-2">
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
              </div>
            </details>

          </div>
        </CollapsibleSection>
      </div>{/* end top container */}

      <div className="mt-4 flex flex-col gap-6">

        {/* ══ Participation ═════════════════════════════════════════════ */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

        {/* ── Responsibilities ──────────────────────────────────────── */}
        <CollapsibleSection id="responsibilities" title="Responsibilities" eyebrow="Community coverage" storageKey={`group:${groupId}:section:responsibilities`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-3">
            {data.responsibilityTypes.length === 0 && (
              <EmptyState text="No responsibility types defined yet." />
            )}
            {data.responsibilityTypes.map((r) => {
              const isHolder = data.myResponsibilityTypes.has(r.type);
              const hasHolders = r.assignments.length > 0;
              return (
                <div key={r.id} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={`/responsibilities/${r.id}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] capitalize">
                        {r.type}
                      </a>
                      {r.assignments.length > 0 && (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {r.assignments.map((a) => a.membership.account.displayName).join(", ")}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 text-xs font-medium ${hasHolders ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                      {hasHolders ? "Covered" : "Needed"}
                    </span>
                  </div>
                  {isActive && !isHolder && (
                    <form action={volunteerForResponsibilityAction} className="mt-2">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="type" value={r.type} />
                      <SubmitButton variant="secondary">Volunteer</SubmitButton>
                    </form>
                  )}
                  {isHolder && (
                    <form action={resignResponsibilityAction} className="mt-2">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="type" value={r.type} />
                      <button type="submit" className="text-xs text-amber-700 hover:text-amber-600 transition">Resign</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* ── Projects ──────────────────────────────────────────────── */}
        <CollapsibleSection id="projects" title="Projects" eyebrow="Active coordination spaces" storageKey={`group:${groupId}:section:projects`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.projects.length > 0 ? (
            <div className="space-y-3">
              {data.projects.map((project) => (
                <a key={project.id} href={`/projects/${project.id}`} className="block border border-[var(--border)] bg-[var(--subtle)] p-3 hover:bg-[var(--hover)] transition">
                  <p className="text-sm font-medium text-[var(--text)]">{project.name}</p>
                  {project.description && <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-2">{project.description}</p>}
                  <p className="mt-1 text-xs text-[var(--muted)] capitalize">{project.status}</p>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text="No active projects." />
          )}
          {isActive && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new project</summary>
              <form action={proposeProjectAction} className="mt-3 space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Project name</span>
                  <input name="name" type="text" required className="field-input" placeholder="e.g. Community Garden" />
                </label>
                <label className="block">
                  <span className="field-label">Description</span>
                  <textarea name="description" rows={2} className="field-input resize-none" placeholder="What will this project do?" />
                </label>
                <SubmitButton variant="secondary">Open proposal petition</SubmitButton>
              </form>
            </details>
          )}
        </CollapsibleSection>

        {/* ── Members ───────────────────────────────────────────────── */}
        <CollapsibleSection id="members" title="Members" eyebrow="Participation" storageKey={`group:${groupId}:section:members`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-2 text-sm text-[var(--soft-text)]">
            <p>{data.activeParticipantCount} fully active {data.activeParticipantCount === 1 ? "member" : "members"}</p>
            {currentMembership && (
              <p className="text-xs text-[var(--muted)]">Your status: <span className="capitalize">{currentMembership.participationStatus}</span></p>
            )}
          </div>

          {/* Pending membership applications — visible to active members */}
          {isActive && data.pendingApplications.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
              <p className="text-xs font-medium text-[var(--muted)]">Pending applications ({data.pendingApplications.length})</p>
              {data.pendingApplications.map((app) => (
                <div key={app.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                  <p className="text-sm font-medium text-[var(--text)]">{app.account.displayName}</p>
                  {app.applicationNote && (
                    <p className="mt-1 text-xs text-[var(--soft-text)]">{app.applicationNote}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--muted)]">Applied {formatRelativeDate(app.joinedAt)}</p>
                  <div className="mt-3 flex gap-2">
                    <form action={sponsorApplicationAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="pendingMembershipId" value={app.id} />
                      <SubmitButton variant="secondary">Sponsor</SubmitButton>
                    </form>
                    <form action={dismissApplicationAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="pendingMembershipId" value={app.id} />
                      <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                        Dismiss
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Invite link — visible to active members only */}
          {isActive && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-medium text-[var(--muted)] mb-3">Invite link</p>
              {oneTimeInviteUrl ? (
                <div className="space-y-2">
                  <ClearPendingInviteToken groupId={groupId} />
                  <p className="text-xs text-[var(--soft-text)]">Copy this link now — it will not be shown again.</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={oneTimeInviteUrl}
                      className="flex-1 field-input text-xs font-mono"
                    />
                    <CopyInviteLinkButton url={oneTimeInviteUrl} />
                  </div>
                  <form action={generateInviteLinkAction}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <SubmitButton variant="secondary">Regenerate</SubmitButton>
                  </form>
                </div>
              ) : data.invitePreview ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--soft-text)]">
                    Active invite: <span className="font-mono">{data.invitePreview.tokenPreview}…</span>
                    {" "}· Expires {formatRelativeDate(data.invitePreview.expiresAt)}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <form action={generateInviteLinkAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <SubmitButton variant="secondary">Regenerate</SubmitButton>
                    </form>
                    <form action={revokeInviteLinkAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                        Revoke
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <form action={generateInviteLinkAction}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <SubmitButton variant="secondary">Generate Invite Link</SubmitButton>
                </form>
              )}
            </div>
          )}
        </CollapsibleSection>

        </div>{/* end Participation */}

        {/* ══ Governance ════════════════════════════════════════════════ */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

        {/* ── Petitions ─────────────────────────────────────────────── */}
        <CollapsibleSection id="petitions" title="Petitions" eyebrow="Community decisions" storageKey={`group:${groupId}:section:petitions`} className="bg-[var(--surface)] p-5 sm:p-6">
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

        {/* ── Concerns ──────────────────────────────────────────────── */}
        <CollapsibleSection id="concerns" title="Concerns" eyebrow="Shared accountability" storageKey={`group:${groupId}:section:concerns`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${data.coverageStatus === "available" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
              Review Coverage: {data.coverageStatus === "available" ? "Available" : "Unavailable"}
            </span>
            {data.openConcernCount > 0 && (
              <span className="text-xs text-[var(--muted)]">
                {data.openConcernCount} active {data.openConcernCount === 1 ? "concern" : "concerns"}
              </span>
            )}
          </div>
          {data.coverageStatus === "unavailable" && (
            <p className="mb-4 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-xs text-[var(--muted)]">
              No active concern reviewers are currently available.
            </p>
          )}
          {data.reviewerQueue.length > 0 && (
            <div className="mb-5 space-y-3">
              <p className="text-xs font-medium text-[var(--muted)]">Reviewer queue</p>
              {data.reviewerQueue.map((concern) => (
                <div key={concern.id} className="space-y-1 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
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
                <div key={report.id} className="space-y-1 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
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

        {/* ── Contribution Categories ───────────────────────────────── */}
        <CollapsibleSection id="contribution-categories" title="Contribution Categories" eyebrow="What this community offers" storageKey={`group:${groupId}:section:categories`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-4">
            {data.contributionCategories.length > 0 ? (
              <div className="space-y-3">
                {data.contributionCategories.map((cat) => (
                  <div key={cat.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text)]">{cat.name}</p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          {cat.offeringEntityType === "group" && cat.offeringEntityName}
                          {cat.offeringEntityType === "project" && `Project: ${cat.offeringEntityName}`}
                          {cat.offeringEntityType === "responsibility" && `Responsibility: ${cat.offeringEntityName}`}
                        </p>
                        {cat.description && <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{cat.description}</p>}
                      </div>
                      {isActive && (
                        <form action={proposeCategoryArchivalAction} className="shrink-0">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <SubmitButton variant="secondary">Archive</SubmitButton>
                        </form>
                      )}
                    </div>
                    {cat.trustedProviders.length > 0 && (
                      <div className="mt-3 border-t border-[var(--border)] pt-2">
                        <p className="text-xs font-medium text-[var(--soft-text)] mb-1">Trusted providers</p>
                        <div className="space-y-1">
                          {cat.trustedProviders.map((tp) => (
                            <div key={tp.id} className="flex items-center justify-between">
                              <span className="text-xs text-[var(--soft-text)]">
                                {tp.memberDisplayName} — {cat.offeringEntityName ? formatTrustedByLabel(tp.offeringEntityType, cat.offeringEntityName) : ""}
                              </span>
                              {isActive && (
                                <form action={proposeTrustedProviderRevocationAction}>
                                  <input type="hidden" name="groupId" value={groupId} />
                                  <input type="hidden" name="targetMembershipId" value={tp.membershipId} />
                                  <input type="hidden" name="statusIds" value={tp.id} />
                                  <SubmitButton variant="secondary">Revoke</SubmitButton>
                                </form>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {isActive && data.groupMembers.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose trusted provider</summary>
                        <form action={proposeTrustedProviderStatusAction} className="mt-2 space-y-2">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <select name="targetMembershipId" required className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
                            <option value="">Select member…</option>
                            {data.groupMembers.map((m) => (
                              <option key={m.id} value={m.id}>{m.account.displayName}</option>
                            ))}
                          </select>
                          <SubmitButton variant="secondary">Open petition</SubmitButton>
                        </form>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No contribution categories defined yet." />
            )}
            {isActive && (
              <details>
                <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new category</summary>
                <form action={proposeCategoryAction} className="mt-3 space-y-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <div>
                    <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Name</label>
                    <input name="name" required placeholder="Transportation" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Description</label>
                    <textarea name="description" required rows={2} placeholder="What kind of assistance does this cover?" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Offered by</label>
                    <select name="offeringEntityType" required className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
                      <option value="group">This group</option>
                      {data.allProjects.map((p) => (
                        <option key={p.id} value={`project:${p.id}`}>Project: {p.name}</option>
                      ))}
                    </select>
                  </div>
                  {data.group.visibility === "private" && data.hasNoActiveCategories && (
                    <p className="text-xs border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                      Approving this contribution category will make this group publicly visible on the Find Groups page.
                    </p>
                  )}
                  <SubmitButton>Open petition</SubmitButton>
                </form>
              </details>
            )}
          </div>
        </CollapsibleSection>

        {/* ── Trusted Providers ─────────────────────────────────────── */}
        <CollapsibleSection id="trusted-providers" title="Trusted Providers" eyebrow="Recognized contributors" storageKey={`group:${groupId}:section:trusted-providers`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.contributionCategories.some((cat) => cat.trustedProviders.length > 0) ? (
            <div className="space-y-2">
              {data.contributionCategories.flatMap((cat) =>
                cat.trustedProviders.map((tp) => ({
                  ...tp,
                  categoryName: cat.name,
                  offeringEntityName: cat.offeringEntityName,
                }))
              ).map((tp) => (
                <div key={tp.id} className="flex items-center justify-between border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{tp.memberDisplayName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {tp.categoryName}
                      {tp.offeringEntityName ? ` — ${formatTrustedByLabel(tp.offeringEntityType, tp.offeringEntityName)}` : ""}
                    </p>
                  </div>
                  {isActive && (
                    <form action={proposeTrustedProviderRevocationAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="targetMembershipId" value={tp.membershipId} />
                      <input type="hidden" name="statusIds" value={tp.id} />
                      <SubmitButton variant="secondary">Revoke</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No trusted providers recognized yet. Propose one from the Contribution Categories section." />
          )}
        </CollapsibleSection>

        {/* ── Governance Settings ───────────────────────────────────── */}
        <CollapsibleSection id="governance" title="Governance Settings" eyebrow="Decision friction" storageKey={`group:${groupId}:section:governance`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-4">

            {/* Group visibility */}
            {data.group.visibility === "private" ? (
              <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                <p className="text-sm font-medium text-[var(--text)]">Group Visibility</p>
                <p className="mt-1 text-xs text-[var(--soft-text)]">
                  This group is private and will not appear on the Find Groups page.
                  {isActive && " Active members can petition to make it publicly discoverable."}
                </p>
                {isActive && (
                  <form action={proposeGroupVisibilityAction} className="mt-3">
                    <input type="hidden" name="groupId" value={groupId} />
                    <SubmitButton variant="secondary">Propose Public Visibility</SubmitButton>
                  </form>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)]">This group is publicly visible on the Find Groups page.</p>
            )}

            {/* Emergency period status + declaration */}
            {data.activeEmergency ? (
              <div className="border border-amber-400 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Emergency period active</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Expires {formatRelativeDate(data.activeEmergency.expiresAt)}
                </p>
              </div>
            ) : isActive && (
              <form action={declareEmergencyAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <SubmitButton variant="secondary">Declare Emergency Period</SubmitButton>
              </form>
            )}

            <div className="border border-[var(--border)] divide-y divide-[var(--border)]">
            {data.governanceSettings.map((setting) => (
              <div key={setting.category} className="bg-[var(--subtle)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--text)]">{governanceCategoryLabel(setting.category)}</p>
                  {/* Temperature indicator: -1 (blue/careful) → 0 (neutral) → +1 (green/permissive) */}
                  <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 ${
                    setting.temperature > 0.2 ? "bg-green-100 text-green-800" :
                    setting.temperature < -0.2 ? "bg-blue-100 text-blue-800" :
                    "bg-[var(--subtle)] text-[var(--muted)]"
                  }`}>
                    {setting.temperature > 0.2 ? "Permissive" : setting.temperature < -0.2 ? "Careful" : "Neutral"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {setting.parameters.map((p) => `${PARAM_LABELS[p.name] ?? p.name}: ${formatParamValue(p.name, p.value)}`).join(" · ")}
                </p>
                <form action={updateGovernanceSignalAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="category" value={setting.category} />
                  <input type="hidden" name="parameter" value="_" />
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
                        className={`border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                          setting.categorySignal === Number(opt.value)
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                            : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </form>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--text)] select-none">
                    Characteristics
                  </summary>
                  <div className="mt-2 space-y-2">
                    {setting.parameters.map((parameter) => (
                      <div key={parameter.name} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-[var(--soft-text)]">
                          {PARAM_LABELS[parameter.name] ?? parameter.name} · {formatParamValue(parameter.name, parameter.value)}
                          {!parameter.hasOwnSignal && setting.categorySignal !== 0 ? " · using bulk vote" : ""}
                        </span>
                        <form action={updateGovernanceSignalAction} className="flex gap-1.5">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="category" value={setting.category} />
                          <input type="hidden" name="parameter" value={parameter.name} />
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
                              className={`border px-2 py-1 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                                parameter.signal === Number(opt.value)
                                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                                  : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </form>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
            </div>
          </div>
        </CollapsibleSection>

        </div>{/* end Governance + Accountability */}

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

async function getGroupSpaceData(accountId: string, groupId: string, selectedThreadId: string | null, activityFilter = "month") {
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
      pendingApplications,
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

    // Governance — all 12 categories
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
      where: { groupId, status: "active", archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    // Members for trusted provider petition form
    const groupMembers = await prisma.groupMembership.findMany({
      where: { groupId, status: "active" },
      select: { id: true, account: { select: { displayName: true } } },
      orderBy: { account: { displayName: "asc" } },
    });

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
      contributionCategories: categoriesWithProviders,
      allProjects,
      groupMembers,
      pendingApplications,
      activeEmergency,
      responsibilityTypes,
      myResponsibilityTypes,
      hasNoActiveCategories: activeCategoryCount === 0,
      invitePreview,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

async function declareEmergencyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      redirect(`/groups/${groupId}`);
    }
    await openEmergencyPetition(prisma, { groupId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function proposeGroupVisibilityAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      redirect(`/groups/${groupId}`);
    }
    await proposeGroupVisibility(prisma, { groupId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function archiveBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const bulletinId = formData.get("bulletinId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await openBulletinArchivalPetition(prisma, { bulletinId, createdByMembershipId: membership.id, groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function archivePublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const publicationId = formData.get("publicationId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await openPublicationArchivalPetition(prisma, { publicationId, createdByMembershipId: membership.id, groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function proposeProjectAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || "";
  if (!name) return;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await proposeProject(prisma, {
      groupId,
      createdByMembershipId: membership.id,
      accountId: session.accountId,
      name,
      description,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function sponsorApplicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const pendingMembershipId = formData.get("pendingMembershipId") as string;
  const prisma = createPrismaClient();
  try {
    const sponsor = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!sponsor) redirect("/dashboard");
    await sponsorMembershipApplication(prisma, sponsor.id, pendingMembershipId);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function dismissApplicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const pendingMembershipId = formData.get("pendingMembershipId") as string;
  const prisma = createPrismaClient();
  try {
    const dismisser = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!dismisser) redirect("/dashboard");
    await dismissMembershipApplication(prisma, pendingMembershipId, dismisser.id);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function generateInviteLinkAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    if (result.ok) {
      session.pendingInviteToken = { groupId, rawToken: result.rawToken };
      await session.save();
    }
  } finally {
    await prisma.$disconnect();
  }
  redirect(`/groups/${groupId}?invite=new#members`);
}

async function revokeInviteLinkAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await revokeAllGroupInviteTokens(prisma, { groupId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}#members`);
}

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
  await requireMembership(session.accountId, groupId);
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
  await requireMembership(session.accountId, groupId);
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
  await requireMembership(session.accountId, groupId);
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

async function volunteerForResponsibilityAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await volunteerForResponsibility(prisma, { membershipId: membership.id, type });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function resignResponsibilityAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await resignAssignment(prisma, membership.id, type);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function proposeCategoryAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const name = requiredString(formData, "name");
  const description = requiredString(formData, "description");
  const entityRaw = requiredString(formData, "offeringEntityType");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Category proposal opened.";
  try {
    // entityRaw is either "group" or "project:<projectId>"
    const [entityType, entityId] = entityRaw.startsWith("project:")
      ? ["project" as const, entityRaw.slice("project:".length)]
      : ["group" as const, groupId];
    const result = await proposeContributionCategory(prisma, {
      membershipId: membership.id,
      groupId,
      offeringEntityType: entityType,
      offeringEntityId: entityId,
      name,
      description,
    });
    if (!result.ok) notice = `Could not open category petition: ${result.reason}.`;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#contribution-categories`);
}

async function proposeCategoryArchivalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Category archival petition opened.";
  try {
    const result = await proposeContributionCategoryArchival(prisma, { membershipId: membership.id, groupId, categoryId });
    if (!result.ok) notice = `Could not open archival petition: ${result.reason}.`;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#contribution-categories`);
}

async function proposeTrustedProviderStatusAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Trusted provider petition opened.";
  try {
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      categoryIds: [categoryId],
    });
    if (!result.ok) notice = `Could not open trusted provider petition: ${result.reason}.`;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#contribution-categories`);
}

async function proposeTrustedProviderRevocationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const statusIdsRaw = formData.get("statusIds");
  const statusIds = typeof statusIdsRaw === "string" ? statusIdsRaw.split(",").filter(Boolean) : [];
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Trusted provider revocation petition opened.";
  try {
    const result = await proposeTrustedProviderRevocation(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      statusIds,
    });
    if (!result.ok) notice = `Could not open revocation petition: ${result.reason}.`;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#contribution-categories`);
}

async function updateGovernanceSignalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const category = requiredString(formData, "category") as GovernanceCategory;
  const parameterRaw = formData.get("parameter");
  const parameter = typeof parameterRaw === "string" && parameterRaw.length > 0 ? parameterRaw : "_";
  const signalRaw = formData.get("signal");
  const signal = signalRaw === "-1" ? -1 : signalRaw === "1" ? 1 : 0;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice: string | null = null;
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: membership.id, groupId, category, parameter, signal });
    if (!result.ok) {
      notice = governanceSignalFailureNotice(result.reason);
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(notice ? `/groups/${groupId}?notice=${encodeURIComponent(notice)}#governance` : `/groups/${groupId}#governance`);
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
    <article className="border border-[var(--border)] bg-[var(--subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">{proposalFamilyLabel(petition.subjectType)}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{petition.subjectLabel}</p>
        </div>
        <span className="shrink-0 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">
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

const PARAM_LABELS: Record<string, string> = {
  threshold: "Approval Threshold",
  petitionDuration: "Petition Window",
  reconfirmationPeriod: "Reconfirmation Period",
  duration: "Emergency Duration",
  messageRetentionDays: "Message Retention",
  threadInactivityDays: "Thread Inactivity",
};

function formatParamValue(param: string, value: number): string {
  if (param === "threshold") return formatPercent(value);
  return `${Math.round(value * 10) / 10}d`;
}

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function governanceSignalFailureNotice(reason: string) {
  switch (reason) {
    case "cooldown": return "Governance signal changes are limited for a short cooldown window.";
    case "invalid_signal": return "That governance signal value is not valid.";
    case "invalid_category": return "That governance category is not valid.";
    case "invalid_parameter": return "That governance characteristic is not valid.";
    case "membership_group_mismatch": return "That membership does not belong to this group.";
    default: return "That governance signal could not be saved.";
  }
}

function discussionPetitionFailureNotice(reason: string) {
  switch (reason) {
    case "creator_not_eligible": return "Only active members can propose closing a discussion thread.";
    case "petition_already_open": return "A closure petition is already open for this discussion thread.";
    default: return "This discussion closure petition could not be opened.";
  }
}
