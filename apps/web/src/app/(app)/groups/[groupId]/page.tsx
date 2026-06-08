import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { applyParticipationTransitions, getActiveParticipantCount, recordGroupPresence } from "../../../../lib/participation";
import { expireStaleAssignments, hasActiveEligibleAssignment, resignAssignment, volunteerForResponsibility } from "../../../../lib/responsibilities";
import { getCoverageStatus } from "../../../../lib/concerns";
import { proposeBulletinCreation, openBulletinArchivalPetition } from "../../../../lib/bulletins";
import { proposePublicationCreation, proposePubEntryCreation, openPublicationArchivalPetition } from "../../../../lib/publications";
import {
  proposeLivingDocumentCreation,
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
import {
  addPetitionSupport,
  withdrawPetitionSupport,
  withdrawPetition,
  archiveStalePetitions,
  petitionFilterWhere,
  PETITION_FILTER_VALUES,
  type PetitionFilterValue,
} from "../../../../lib/petitions";
import { sponsorMembershipApplication, dismissMembershipApplication } from "../../../../lib/group-membership";
import { proposeProject } from "../../../../lib/projects";
import { openProjectHostingWithdrawalPetition } from "../../../../lib/project-hosting";
import { openCoalitionFormationProposal, openCoalitionJoinProposal } from "../../../../lib/coalitions";
import { visibleGroupRosterAffiliations } from "../../../../lib/federation-legibility";
import { listNodeGroupLabelsForAccount } from "../../../../lib/node-privacy";
import {
  openGroupNoConfidence,
  openGroupStewardNomination,
  openStewardResignation,
} from "../../../../lib/node-stewardship";
import { proposeResponsibility, PROPOSABLE_RESPONSIBILITY_ABILITIES } from "../../../../lib/responsibility-proposals";
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
import { ActivityFilter } from "../../../../components/shared/ActivityFilter";
import { PetitionFilter } from "../../../../components/shared/PetitionFilter";
import { GovernanceSignalForm } from "../../../../components/shared/GovernanceSignalForm";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import { CreateThreadForm } from "../../../../components/shared/CreateThreadForm";
import { InviteLinkSection } from "../../../../components/shared/InviteLinkSection";
import { ThreadList } from "../../../../components/shared/ThreadList";
import { type FormState, type ThreadFormState, type InviteFormState } from "../../../../components/shared/form-state";

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

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
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
              <div className="mb-3">
                <ActivityFilter currentFilter={activityFilter} />
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
              <ThreadList
                threads={data.discussionThreads.map((thread) => ({
                  id: thread.id,
                  title: thread.title,
                  messageCount: thread.messageCount,
                  lastActivityLabel: formatRelativeDate(thread.lastActivityAt),
                }))}
                selectedThreadId={data.selectedThread?.id ?? null}
              />
              <div className="border border-[var(--border)] p-3">
                {data.selectedThread ? (
                  <>
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">{data.selectedThread.title}</p>
                        <p className="text-xs text-[var(--muted)]">Messages expire automatically.</p>
                      </div>
                      {isActive && (
                        <FormWithNotice action={openThreadClosurePetitionAction}>
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="threadId" value={data.selectedThread.id} />
                          <SubmitButton variant="secondary">Propose closure</SubmitButton>
                        </FormWithNotice>
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
            <CreateThreadForm action={createDiscussionThreadAction} groupId={groupId} />
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
            <FormWithNotice action={proposeBulletinCreationAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Title</span>
                <input name="title" type="text" required className="field-input" placeholder="A short title" />
              </label>
              <label className="block">
                <span className="field-label">Body</span>
                <textarea name="body" required rows={4} className="field-input resize-none" placeholder="Update text" />
              </label>
              <SubmitButton variant="secondary">Propose bulletin</SubmitButton>
            </FormWithNotice>
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
                <div key={p.id} className="border border-[var(--border)] p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
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
                  {isActive && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose an entry</summary>
                      <FormWithNotice action={proposePubEntryCreationAction} className="mt-2 space-y-2">
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="publicationId" value={p.id} />
                        <label className="block">
                          <span className="field-label text-xs">Title (optional)</span>
                          <input name="title" type="text" className="field-input text-sm" placeholder="Entry title" />
                        </label>
                        <label className="block">
                          <span className="field-label text-xs">Body</span>
                          <textarea name="body" required rows={3} className="field-input resize-none text-sm" placeholder="Entry content" />
                        </label>
                        <SubmitButton variant="secondary">Propose entry</SubmitButton>
                      </FormWithNotice>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No publications yet." />
          )}
          {isActive && (
            <FormWithNotice action={proposePublicationCreationAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Title</span>
                <input name="title" type="text" required className="field-input" placeholder="e.g. Community Resources" />
              </label>
              <SubmitButton variant="secondary">Propose publication</SubmitButton>
            </FormWithNotice>
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
            <FormWithNotice action={proposeLivingDocumentCreationAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Title</span>
                <input name="title" type="text" required className="field-input" placeholder="e.g. Mission, Charter, Code of Conduct" />
              </label>
              <label className="block">
                <span className="field-label">Body</span>
                <textarea name="body" required rows={4} className="field-input resize-none" placeholder="The current text of this document." />
              </label>
              <SubmitButton variant="secondary">Propose document</SubmitButton>
            </FormWithNotice>
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
          {isActive && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new responsibility</summary>
              <FormWithNotice action={proposeResponsibilityAction} className="mt-3 space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Type</span>
                  <input name="type" type="text" required maxLength={64} className="field-input" placeholder="e.g. Communications" />
                </label>
                <label className="block">
                  <span className="field-label">Purpose</span>
                  <textarea name="description" required maxLength={500} rows={3} className="field-input resize-none" placeholder="What does this role coordinate, and who does it serve?" />
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    On approval, this seeds an editable &quot;Purpose&quot; living document for the role — the group can revise it later through the normal living-document petition flow.
                  </span>
                </label>
                <fieldset className="space-y-1.5">
                  <legend className="field-label">Abilities</legend>
                  {PROPOSABLE_RESPONSIBILITY_ABILITIES.map(({ ability, label }) => (
                    <div key={ability} className="flex items-center gap-3 text-sm text-[var(--text)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name={`ability_${ability}`} value="on" />
                        {label}
                      </label>
                      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                        <input type="radio" name={`availability_${ability}`} value="always_available" defaultChecked />
                        Always
                      </label>
                      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                        <input type="radio" name={`availability_${ability}`} value="available_during_emergency" />
                        Emergency only
                      </label>
                    </div>
                  ))}
                </fieldset>
                <SubmitButton variant="secondary">Open proposal petition</SubmitButton>
              </FormWithNotice>
            </details>
          )}
        </CollapsibleSection>

        {/* ── Projects ──────────────────────────────────────────────── */}
        <CollapsibleSection id="projects" title="Hosted Projects" eyebrow="Federated coordination" storageKey={`group:${groupId}:section:projects`} className="bg-[var(--surface)] p-5 sm:p-6">
          <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
            Hosting is this group&apos;s endorsement and support. It does not give the group ownership of a project.
          </p>
          {data.projects.length > 0 ? (
            <div className="space-y-3">
              {data.projects.map((project) => (
                <div key={project.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                  <a href={`/projects/${project.id}`} className="block hover:bg-[var(--hover)] transition">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--text)]">{project.name}</p>
                      <span className="shrink-0 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)]">
                        Hosted here
                      </span>
                    </div>
                    {project.description && <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-2">{project.description}</p>}
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      <span className="capitalize">{project.status}</span>
                      <span aria-hidden="true"> &middot; </span>
                      {project._count.hostings} {project._count.hostings === 1 ? "host group" : "host groups"}
                    </p>
                  </a>
                  {isActive && (
                    <form action={openProjectHostingWithdrawalAction} className="mt-3">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="projectId" value={project.id} />
                      <SubmitButton variant="secondary">Open host-withdrawal petition</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="This group does not currently host any projects." />
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

        <CollapsibleSection id="coalitions" title="Coalitions" eyebrow="Group-to-group coordination" storageKey={`group:${groupId}:section:coalitions`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.coalitions.length > 0 ? (
            <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
              {data.coalitions.map((coalition) => (
                <a
                  key={coalition.id}
                  href={`/coalitions/${coalition.id}`}
                  className="block px-3 py-3 transition hover:bg-[var(--hover)]"
                >
                  <p className="text-sm font-medium text-[var(--text)]">{coalition.name}</p>
                  {coalition.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--soft-text)]">{coalition.description}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {coalition._count.memberships} member {coalition._count.memberships === 1 ? "group" : "groups"}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text="This group does not currently belong to a coalition." />
          )}
          {isActive && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose forming a new coalition</summary>
              {data.eligibleCoalitionPartners.length > 0 ? (
                <FormWithNotice action={proposeCoalitionFormationAction} className="mt-3 space-y-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <label className="block">
                    <span className="field-label">Coalition name</span>
                    <input name="name" type="text" required className="field-input" placeholder="e.g. Riverside Mutual Aid Network" />
                  </label>
                  <label className="block">
                    <span className="field-label">Description</span>
                    <textarea name="description" rows={2} className="field-input resize-none" placeholder="What is this coalition for?" />
                  </label>
                  <label className="block">
                    <span className="field-label">Rationale</span>
                    <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should these groups federate?" />
                  </label>
                  <fieldset className="space-y-1.5">
                    <legend className="field-label">Partner groups (select at least one)</legend>
                    <p className="text-xs leading-5 text-[var(--muted)]">
                      Each selected group receives its own internal petition, decided independently by its members.
                    </p>
                    {data.eligibleCoalitionPartners.map((partner) => (
                      <label key={partner.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                        <input type="checkbox" name="partnerGroupId" value={partner.id} />
                        {partner.label}
                      </label>
                    ))}
                  </fieldset>
                  <SubmitButton variant="secondary">Open formation proposal</SubmitButton>
                </FormWithNotice>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  There are no other groups on this node to invite into a coalition.
                </p>
              )}
            </details>
          )}
          {isActive && data.joinableCoalitions.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Apply to join a coalition</summary>
              <FormWithNotice action={proposeCoalitionJoinAction} className="mt-3 space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Coalition</span>
                  <select name="coalitionId" required className="field-input">
                    <option value="">Select a coalition&hellip;</option>
                    {data.joinableCoalitions.map((coalition) => (
                      <option key={coalition.id} value={coalition.id}>{coalition.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Rationale</span>
                  <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this group join?" />
                </label>
                <SubmitButton variant="secondary">Open join proposal</SubmitButton>
              </FormWithNotice>
            </details>
          )}
        </CollapsibleSection>

        <CollapsibleSection id="node-stewardship" title="Node Stewardship" eyebrow="Group consent" storageKey={`group:${groupId}:section:node-stewardship`} className="bg-[var(--surface)] p-5 sm:p-6">
          <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
            This group may open stewardship questions. Node users decide appointments and no confidence.
          </p>
          {isActive && !data.nodeState.stewardGroupId && (
            <form action={openGroupStewardNominationAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="nodeId" value={group.nodeId} />
              <label className="block">
                <span className="field-label">Candidate group</span>
                <select name="candidateGroupId" className="field-input" required>
                  {data.nodeGroupOptions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                  ))}
                </select>
              </label>
              <SubmitButton variant="secondary">Open nomination petition</SubmitButton>
            </form>
          )}
          {isActive && data.nodeState.stewardGroupId && (
            <form action={openGroupNoConfidenceAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="nodeId" value={group.nodeId} />
              <p className="text-sm text-[var(--soft-text)]">Ask this group whether to initiate a node-wide no-confidence vote.</p>
              <SubmitButton variant="secondary">Open initiation petition</SubmitButton>
            </form>
          )}
          {isActive && data.nodeState.stewardGroupId === groupId && (
            <form action={openStewardResignationAction} className="mt-3">
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="nodeId" value={group.nodeId} />
              <SubmitButton variant="secondary">Open steward resignation petition</SubmitButton>
            </form>
          )}
          <a href="/node" className="mt-4 inline-block text-xs font-medium text-[var(--accent)] hover:underline">
            Open node governance
          </a>
        </CollapsibleSection>

        {/* ── Members ───────────────────────────────────────────────── */}
        <CollapsibleSection id="members" title="Members" eyebrow="Participation" storageKey={`group:${groupId}:section:members`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-2 text-sm text-[var(--soft-text)]">
            <p>{data.activeParticipantCount} fully active {data.activeParticipantCount === 1 ? "member" : "members"}</p>
            {currentMembership && (
              <p className="text-xs text-[var(--muted)]">Your status: <span className="capitalize">{currentMembership.participationStatus}</span></p>
            )}
          </div>

          {/* Member roster — visible to active members */}
          {isActive && data.groupMembers.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-medium text-[var(--muted)] mb-2">All members</p>
              <div className="space-y-1">
                {data.groupMembers.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-3 py-1 text-sm">
                    <div className="min-w-0">
                      <span className="text-[var(--text)]">{m.account.displayName}</span>
                      {m.affiliations.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                          <span>Also a member of</span>
                          {m.affiliations.map((group) => (
                            <a key={group.id} href={`/groups/${group.id}`} className="text-[var(--accent)] hover:underline">
                              {group.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs capitalize text-[var(--muted)]">{m.participationStatus}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              <InviteLinkSection
                groupId={groupId}
                invitePreview={data.invitePreview}
                generateAction={generateInviteLinkAction}
                revokeAction={revokeInviteLinkAction}
              />
            </div>
          )}
        </CollapsibleSection>

        </div>{/* end Participation */}

        {/* ══ Governance ════════════════════════════════════════════════ */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

        {/* ── Petitions ─────────────────────────────────────────────── */}
        <CollapsibleSection id="petitions" title="Petitions" eyebrow="Community decisions" storageKey={`group:${groupId}:section:petitions`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="space-y-4">
            <PetitionFilter currentFilter={petitionFilter} />
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
                    currentMembershipId={currentMembership?.id ?? null}
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
                        <FormWithNotice action={proposeCategoryArchivalAction} className="shrink-0">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <SubmitButton variant="secondary">Archive</SubmitButton>
                        </FormWithNotice>
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
                                <FormWithNotice action={proposeTrustedProviderRevocationAction}>
                                  <input type="hidden" name="groupId" value={groupId} />
                                  <input type="hidden" name="targetMembershipId" value={tp.membershipId} />
                                  <input type="hidden" name="statusIds" value={tp.id} />
                                  <SubmitButton variant="secondary">Revoke</SubmitButton>
                                </FormWithNotice>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {isActive && data.groupMembers.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose trusted provider</summary>
                        <FormWithNotice action={proposeTrustedProviderStatusAction} className="mt-2 space-y-2">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <select name="targetMembershipId" required className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
                            <option value="">Select member…</option>
                            {data.groupMembers.map((m) => (
                              <option key={m.id} value={m.id}>{m.account.displayName}</option>
                            ))}
                          </select>
                          <SubmitButton variant="secondary">Open petition</SubmitButton>
                        </FormWithNotice>
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
                <FormWithNotice action={proposeCategoryAction} className="mt-3 space-y-3">
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
                </FormWithNotice>
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
                    <FormWithNotice action={proposeTrustedProviderRevocationAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="targetMembershipId" value={tp.membershipId} />
                      <input type="hidden" name="statusIds" value={tp.id} />
                      <SubmitButton variant="secondary">Revoke</SubmitButton>
                    </FormWithNotice>
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
                <div className="mt-3">
                  <GovernanceSignalForm
                    action={updateGovernanceSignalAction}
                    groupId={groupId}
                    category={setting.category}
                    parameter="_"
                    currentSignal={setting.categorySignal}
                    size="md"
                  />
                </div>
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
                        <GovernanceSignalForm
                          action={updateGovernanceSignalAction}
                          groupId={groupId}
                          category={setting.category}
                          parameter={parameter.name}
                          currentSignal={parameter.signal}
                        />
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
    await archiveStalePetitions(prisma, groupId);

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

    // The acting member initiates for this group; every selected partner receives
    // an independent system-opened petition for its own electorate.
    const eligibleCoalitionPartners =
      currentMembership.participationStatus === "active"
        ? nodeGroupOptions.filter((candidate) => candidate.id !== groupId)
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
          createdByMembershipId: p.createdByMembershipId,
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
      pendingApplications,
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

async function openGroupStewardNominationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const candidateGroupId = requiredString(formData, "candidateGroupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openGroupStewardNomination(prisma, {
      nodeId,
      initiatingGroupId: groupId,
      candidateGroupId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function openGroupNoConfidenceAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openGroupNoConfidence(prisma, {
      nodeId,
      initiatingGroupId: groupId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

async function openStewardResignationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openStewardResignation(prisma, {
      nodeId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

// ── Server Actions ────────────────────────────────────────────────────────────

async function declareEmergencyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
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
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
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

async function openProjectHostingWithdrawalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const projectId = requiredString(formData, "projectId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Could not open host-withdrawal petition.";
  try {
    const result = await openProjectHostingWithdrawalPetition(prisma, {
      projectId,
      groupId,
      createdByMembershipId: membership.id,
    });
    if (result.ok) notice = "Host-withdrawal petition opened.";
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#projects`);
}

async function proposeCoalitionFormationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const name = requiredString(formData, "name");
  const description = (formData.get("description") as string | null) ?? "";
  const content = requiredString(formData, "content");
  const partnerGroupIds = formData.getAll("partnerGroupId").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (partnerGroupIds.length === 0) {
    return { kind: "error", message: "Select at least one partner group to invite into the coalition." };
  }

  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name,
      description: description.trim() || null,
      content,
      participants: [
        { groupId, createdByMembershipId: membership.id },
        ...partnerGroupIds.map((partnerGroupId) => ({ groupId: partnerGroupId })),
      ],
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Coalition formation proposal opened — each group's members will decide through their own petition." };
}

async function proposeCoalitionJoinAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const coalitionId = requiredString(formData, "coalitionId");
  const content = requiredString(formData, "content");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: { groupId, createdByMembershipId: membership.id },
      memberSponsors: coalition.memberships.map((member) => ({ groupId: member.groupId })),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Join proposal opened. Every participating group will decide independently." };
}

function coalitionProposalFailureMessage(reason: string) {
  switch (reason) {
    case "invalid_participants": return "Select at least two distinct, eligible groups on the same node.";
    case "not_eligible": return "Every sponsoring group requires an active, active-participation member to consent.";
    case "not_found": return "This coalition could not be found.";
    case "already_member": return "That group already belongs to this coalition.";
    case "not_member": return "That group is not currently a member of this coalition.";
    case "duplicate_name": return "A coalition with that name already exists on this node.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
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

async function generateInviteLinkAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "Could not generate invite link." };
    revalidatePath(`/groups/${groupId}`);
    const hdrList = await headers();
    const host = hdrList.get("host") ?? "localhost:3000";
    const proto = process.env.NODE_ENV === "production"
      ? (hdrList.get("x-forwarded-proto") ?? "https") : "http";
    return { kind: "success", message: "", inviteUrl: `${proto}://${host}/invite/${result.rawToken}` };
  } finally {
    await prisma.$disconnect();
  }
}

async function revokeInviteLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await revokeAllGroupInviteTokens(prisma, { groupId, membershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "You are not eligible to revoke this invite link." };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Invite link revoked." };
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

async function createDiscussionThreadAction(
  _prev: ThreadFormState,
  formData: FormData,
): Promise<ThreadFormState> {
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
  return { kind: "success", message: "", threadId };
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
}

async function openThreadClosurePetitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const threadId = requiredString(formData, "threadId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await openThreadClosurePetition(prisma, { threadId, groupId, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: discussionPetitionFailureNotice(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Closure petition opened." };
}

async function proposeBulletinCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeBulletinCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, body, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Bulletin proposed — check Petitions." };
}

function responsibilityProposalFailureMessage(reason: string) {
  switch (reason) {
    case "invalid_type": return "Give this responsibility a name (up to 64 characters).";
    case "invalid_description": return "Describe the purpose of this responsibility (up to 500 characters).";
    case "invalid_ability": return "One of the selected abilities is not valid.";
    case "no_abilities": return "Select at least one ability for this responsibility.";
    case "not_eligible": return "You are not eligible to propose a new responsibility.";
    case "duplicate_type": return "A responsibility with that name already exists.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
}

async function proposeResponsibilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const description = requiredString(formData, "description");
  const abilities = PROPOSABLE_RESPONSIBILITY_ABILITIES.filter(
    ({ ability }) => formData.get(`ability_${ability}`) === "on",
  ).map(({ ability }) => ({
    ability,
    availability: (formData.get(`availability_${ability}`) as string) || "always_available",
  }));
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membership.id,
      type,
      description,
      abilities,
    });
    if (!result.ok) return { kind: "error", message: responsibilityProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Responsibility proposed — check Petitions." };
}

async function proposePublicationCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposePublicationCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Publication proposed — check Petitions." };
}

async function proposeLivingDocumentCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeLivingDocumentCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, body, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Document proposed — check Petitions." };
}

async function proposePubEntryCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const publicationId = requiredString(formData, "publicationId");
  const body = requiredString(formData, "body");
  const title = formData.get("title") as string | null;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposePubEntryCreation(prisma, {
      spaceType: "group",
      spaceId: groupId,
      publicationId,
      groupId,
      body,
      title: title || undefined,
      createdByMembershipId: membership.id,
    });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Entry proposed — check Petitions." };
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
}

async function withdrawPetitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let outcome: "withdrawn" | "not_eligible";
  try {
    ({ outcome } = await withdrawPetition(prisma, petitionId, membership.id));
    if (outcome === "withdrawn") await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  if (outcome === "not_eligible") {
    return { kind: "error", message: "This petition can no longer be withdrawn — it may have already closed." };
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Petition withdrawn." };
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

async function proposeCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const name = requiredString(formData, "name");
  const description = requiredString(formData, "description");
  const entityRaw = requiredString(formData, "offeringEntityType");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
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
    if (!result.ok) return { kind: "error", message: `Could not open category petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Category proposal opened." };
}

async function proposeCategoryArchivalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeContributionCategoryArchival(prisma, { membershipId: membership.id, groupId, categoryId });
    if (!result.ok) return { kind: "error", message: `Could not open archival petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Category archival petition opened." };
}

async function proposeTrustedProviderStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      categoryIds: [categoryId],
    });
    if (!result.ok) return { kind: "error", message: `Could not open trusted provider petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Trusted provider petition opened." };
}

async function proposeTrustedProviderRevocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const statusIdsRaw = formData.get("statusIds");
  const statusIds = typeof statusIdsRaw === "string" ? statusIdsRaw.split(",").filter(Boolean) : [];
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeTrustedProviderRevocation(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      statusIds,
    });
    if (!result.ok) return { kind: "error", message: `Could not open revocation petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Revocation petition opened." };
}

async function updateGovernanceSignalAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
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
  let error: string | null = null;
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: membership.id, groupId, category, parameter, signal });
    if (!result.ok) error = governanceSignalFailureNotice(result.reason);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return error;
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
  createdByMembershipId: string | null;
};

function PetitionCard({ petition, canSupport, groupId, currentMembershipId }: { petition: SpacePetition; canSupport: boolean; groupId: string; currentMembershipId: string | null }) {
  const isOpen = petition.status === "open";
  const canWithdraw = isOpen && currentMembershipId !== null && petition.createdByMembershipId === currentMembershipId;
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
          {canWithdraw && (
            <FormWithNotice action={withdrawPetitionAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="petitionId" value={petition.id} />
              <SubmitButton variant="secondary">Withdraw petition</SubmitButton>
            </FormWithNotice>
          )}
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
  quietThresholdDays: "Quiet After",
  dormantThresholdDays: "Dormant After",
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

function contentProposalFailureMessage(reason: string) {
  switch (reason) {
    case "not_eligible": return "You are not eligible to propose this content.";
    case "publication_archived": return "That publication has been archived.";
    case "publication_not_found": return "Publication not found.";
    case "missing_required_fields": return "Please fill in all required fields.";
    default: return "This proposal could not be submitted.";
  }
}

function discussionPetitionFailureNotice(reason: string) {
  switch (reason) {
    case "creator_not_eligible": return "Only active members can propose closing a discussion thread.";
    case "petition_already_open": return "A closure petition is already open for this discussion thread.";
    default: return "This discussion closure petition could not be opened.";
  }
}
