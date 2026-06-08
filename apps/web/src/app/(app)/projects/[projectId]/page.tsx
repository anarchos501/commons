import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import {
  applyProjectParticipationTransitions,
  syncProjectHostingLifecycle,
  recordProjectPresence,
  leaveProject,
} from "../../../../lib/project-membership";
import { proposeBulletinCreation, openProjectBulletinArchivalPetition } from "../../../../lib/bulletins";
import { proposePublicationCreation, proposePubEntryCreation, openProjectPublicationArchivalPetition } from "../../../../lib/publications";
import {
  proposeLivingDocumentCreation,
  draftLivingDocumentRevision,
  openProjectRevisionPetition,
} from "../../../../lib/living-documents";
import {
  listDiscussionMessages,
  listProjectDiscussionThreads,
  createProjectDiscussionThread,
  postProjectDiscussionMessage,
} from "../../../../lib/discussions";
import { addPetitionSupport, withdrawPetitionSupport } from "../../../../lib/petitions";
import { evaluateAndApplyPetition } from "../../../../lib/petition-evaluation";
import {
  proposeProjectContributionCategory,
  getAvailableCategoriesForScope,
} from "../../../../lib/contribution-categories";
import { openProjectHostingProposal } from "../../../../lib/project-hosting";
import { requiredString } from "../../../../lib/support-form";
import { visibleProjectRosterAffiliations } from "../../../../lib/federation-legibility";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import { type FormState } from "../../../../components/shared/form-state";
import { Notice, AlphaNotice } from "../../../../components/shared/Notice";
import { SubmitButton } from "../../../../components/shared/SubmitButton";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
};

export default async function ProjectSpacePage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;

  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const data = await getProjectSpaceData(session.accountId, projectId, selectedThreadId);

  const { project, currentMembership } = data;
  const isActive = currentMembership?.participationStatus === "active";
  const canWrite = isActive && project.status !== "closed" && project.pendingClosureAt === null;
  const canParticipateInGovernance = isActive && project.status !== "closed";
  const membershipId = currentMembership?.id ?? "";

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <AlphaNotice />
      {notice && <div className="mt-4"><Notice message={notice} /></div>}

      {/* ── Overview + Discussion ─────────────────────────────────── */}
      <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
        <div id="overview" className="bg-[var(--surface)] p-5 sm:p-6">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Project coordination space</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)]">{project.name}</h1>
          {project.description && (
            <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{project.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <span>{data.activeParticipantCount} active {data.activeParticipantCount === 1 ? "member" : "members"}</span>
            {currentMembership && (
              <span className="capitalize">You: {currentMembership.participationStatus}</span>
            )}
          </div>
          {project.status === "closed" ? (
            <div className="mt-4"><Notice message="This project is closed. Its historical record remains readable, but it is read-only." /></div>
          ) : project.pendingClosureAt ? (
            <div className="mt-4"><Notice message="This project has no current host and is pending closure. Only successor-host adoption governance remains open." /></div>
          ) : null}
          <div className="mt-4 border-l-2 border-[var(--accent)] pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Hosted by</p>
            {data.hostGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {data.hostGroups.map((group) => (
                  <a key={group.id} href={`/groups/${group.id}`} className="text-sm font-medium text-[var(--accent)] hover:underline">
                    {group.name}
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-[var(--soft-text)]">No current host group</p>
            )}
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Hosting is endorsement and support, not ownership. Project members govern the project.
            </p>
          </div>
          {project.pendingClosureAt && (
            <div className="mt-4 border-l-2 border-amber-500 pl-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Propose a successor host</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Adoption requires mutual consent — the candidate group&apos;s own governance must agree to host, and
                the project&apos;s frozen pre-closure membership must agree to accept. Either side declining, withdrawing,
                or timing out fails the whole proposal.
              </p>
              {data.eligibleAsProjectSponsor ? (
                data.candidateHostGroups.length > 0 ? (
                  <FormWithNotice action={proposeProjectHostingAction} className="mt-3 space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="projectMembershipId" value={currentMembership?.id ?? ""} />
                    <label className="block">
                      <span className="field-label">Candidate group</span>
                      <select name="candidateMembershipId" required className="field-input">
                        <option value="">Select a group&hellip;</option>
                        {data.candidateHostGroups.map((option) => (
                          <option key={option.groupId} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Rationale</span>
                      <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this group host the project?" />
                    </label>
                    <SubmitButton variant="secondary">Open hosting proposal</SubmitButton>
                  </FormWithNotice>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    You don&apos;t hold active participation in any group that could be proposed as a successor host.
                  </p>
                )
              ) : (
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  Sponsoring the project&apos;s side of an adoption requires being part of the membership that was
                  active when the closure clock started — that frozen group is what decides whether to accept a
                  successor host.
                </p>
              )}
            </div>
          )}
          {currentMembership && canWrite && (
            <form action={leaveProjectAction} className="mt-3">
              <input type="hidden" name="projectId" value={projectId} />
              <button type="submit" className="text-xs text-amber-700 hover:text-amber-600 transition">
                Leave project
              </button>
            </form>
          )}
        </div>

        <CollapsibleSection id="discussion" title="Discussion" eyebrow="Temporary coordination" storageKey={`project:${projectId}:section:discussion`} className="bg-[var(--surface)] p-5 sm:p-6">
          {data.discussionThreads.length > 0 ? (
            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                {data.discussionThreads.map((thread) => (
                  <a
                    key={thread.id}
                    href={`/projects/${projectId}?discussionThread=${thread.id}#discussion`}
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
                          <div key={msg.id} className="bg-[var(--subtle)] px-3 py-2">
                            <p className="text-sm leading-6 text-[var(--soft-text)]">{msg.body}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{msg.author.displayName}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="No active messages in this thread." />
                    )}
                    {canWrite && (
                      <form action={postDiscussionMessageAction} className="space-y-2 mt-2">
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="threadId" value={data.selectedThread.id} />
                        <textarea name="body" required rows={3} className="field-input resize-none" placeholder="Add a coordination note." />
                        <SubmitButton variant="secondary">Post message</SubmitButton>
                      </form>
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
          {canWrite && (
            <form action={createDiscussionThreadAction} className="space-y-3">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="block">
                <span className="field-label">New thread</span>
                <input name="title" type="text" required className="field-input" placeholder="A focused coordination topic" />
              </label>
              <SubmitButton variant="secondary">Create thread</SubmitButton>
            </form>
          )}
        </CollapsibleSection>

        {/* ── Library ─────────────────────────────────────────────── */}
        <CollapsibleSection id="library" title="Library" eyebrow="Project resources" storageKey={`project:${projectId}:section:library`} className="bg-[var(--surface)] p-5 sm:p-6">
          <div className="divide-y divide-[var(--border)] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-3">

            <details id="bulletins" className="group/lib">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Project updates</span>
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
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-xs text-[var(--muted)]">{b.author.displayName}</p>
                          {canWrite && (
                            <form action={archiveBulletinAction}>
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="bulletinId" value={b.id} />
                              <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">Archive</button>
                            </form>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No bulletins yet." />
                )}
                {canWrite && (
                  <form action={createBulletinAction} className="space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="A short title" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={4} className="field-input resize-none" placeholder="Update text" /></label>
                    <SubmitButton variant="secondary">Propose bulletin</SubmitButton>
                  </form>
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
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                          {canWrite && (
                            <form action={archivePublicationAction}>
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="publicationId" value={p.id} />
                              <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">Archive</button>
                            </form>
                          )}
                        </div>
                        {canWrite && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose an entry</summary>
                            <form action={proposePubEntryCreationAction} className="mt-2 space-y-2">
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="publicationId" value={p.id} />
                              <label className="block"><span className="field-label text-xs">Title (optional)</span><input name="title" type="text" className="field-input text-sm" placeholder="Entry title" /></label>
                              <label className="block"><span className="field-label text-xs">Body</span><textarea name="body" required rows={3} className="field-input resize-none text-sm" placeholder="Entry content" /></label>
                              <SubmitButton variant="secondary">Propose entry</SubmitButton>
                            </form>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No publications yet." />
                )}
                {canWrite && (
                  <form action={createPublicationAction} className="space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="e.g. Project Resources" /></label>
                    <SubmitButton variant="secondary">Propose publication</SubmitButton>
                  </form>
                )}
              </div>
            </details>

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
                  <div className="space-y-4">
                    {data.livingDocuments.map((doc) => (
                      <div key={doc.id} className="border border-[var(--border)] p-3 space-y-2">
                        <p className="text-sm font-semibold text-[var(--text)]">{doc.title}</p>
                        <p className="text-xs leading-5 text-[var(--soft-text)] line-clamp-3">{doc.currentBody}</p>
                        {canWrite && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a revision</summary>
                            <form action={proposeLivingDocumentRevisionAction} className="mt-2 space-y-2">
                              <input type="hidden" name="projectId" value={projectId} />
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
                {canWrite && (
                  <form action={createLivingDocumentAction} className="space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="e.g. Charter, Guidelines" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={4} className="field-input resize-none" placeholder="The current text." /></label>
                    <SubmitButton variant="secondary">Propose document</SubmitButton>
                  </form>
                )}
              </div>
            </details>

          </div>
        </CollapsibleSection>
      </div>

      <div className="mt-4 flex flex-col gap-6">

        {/* ── Participation ─────────────────────────────────────────── */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">
          <CollapsibleSection id="members" title="Members" eyebrow="Participation" storageKey={`project:${projectId}:section:members`} className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="space-y-2 text-sm text-[var(--soft-text)]">
              <p>{data.activeParticipantCount} fully active {data.activeParticipantCount === 1 ? "member" : "members"}</p>
              {currentMembership && (
                <p className="text-xs text-[var(--muted)]">Your status: <span className="capitalize">{currentMembership.participationStatus}</span></p>
              )}
            </div>
            {isActive && data.projectMembers.length > 0 && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <p className="text-xs font-medium text-[var(--muted)] mb-2">All members</p>
                <div className="space-y-1">
                  {data.projectMembers.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-3 py-1 text-sm">
                      <div className="min-w-0">
                        <span className="text-[var(--text)]">{m.account.displayName}</span>
                        {m.affiliations.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                            <span>Member of</span>
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
          </CollapsibleSection>
        </div>

        {/* ── Governance ────────────────────────────────────────────── */}
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] flex flex-col">

          <CollapsibleSection id="petitions" title="Petitions" eyebrow="Project decisions" storageKey={`project:${projectId}:section:petitions`} className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="space-y-4">
              <form action={evaluateClosedPetitionsAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <SubmitButton variant="secondary">Check petition outcomes</SubmitButton>
              </form>
              {data.petitions.length > 0 ? (
                <div className="space-y-3">
                  {data.petitions.map((petition) => (
                    <article key={petition.id} className="border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold capitalize">{petition.subjectType.replace(/_/g, " ")}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {petition.supportCount} / {petition.requiredSupport} supporters · closes {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(petition.closesAt)}
                          </p>
                        </div>
                        <span className="border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs capitalize text-[var(--soft-text)]">
                          {petition.status}
                        </span>
                      </div>
                      {canParticipateInGovernance && petition.status === "open" && (
                        <div className="mt-3 flex gap-2">
                          {!petition.supportedByCurrentMember ? (
                            <form action={supportPetitionAction}>
                              <input type="hidden" name="petitionId" value={petition.id} />
                              <input type="hidden" name="projectMembershipId" value={membershipId} />
                              <SubmitButton variant="secondary">Support</SubmitButton>
                            </form>
                          ) : (
                            <form action={withdrawPetitionSupportAction}>
                              <input type="hidden" name="petitionId" value={petition.id} />
                              <input type="hidden" name="projectMembershipId" value={membershipId} />
                              <SubmitButton variant="secondary">Withdraw support</SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState text="No petitions yet." />
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="contribution-categories" title="Contribution Categories" eyebrow="What this project offers" storageKey={`project:${projectId}:section:categories`} className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="space-y-4">
              {data.contributionCategories.length > 0 ? (
                <div className="space-y-3">
                  {data.contributionCategories.map((cat) => (
                    <div key={cat.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{cat.name}</p>
                      {cat.description && <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{cat.description}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No contribution categories defined yet." />
              )}
              {canWrite && (
                <details>
                  <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new category</summary>
                  <form action={proposeCategoryAction} className="mt-3 space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <div><label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Name</label><input name="name" required placeholder="e.g. Code Review" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" /></div>
                    <div><label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Description</label><textarea name="description" required rows={2} placeholder="What kind of contribution does this cover?" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" /></div>
                    <SubmitButton>Open petition</SubmitButton>
                  </form>
                </details>
              )}
            </div>
          </CollapsibleSection>

        </div>
      </div>
    </main>
  );
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function getProjectSpaceData(accountId: string, projectId: string, selectedThreadId: string | null) {
  const prisma = createPrismaClient();
  try {
    await recordProjectPresence(prisma, accountId, projectId);
    // Hosting lifecycle first: it's the sole authority for pendingClosureAt,
    // which participation transitions read (read-only) to apply the RFC-007
    // electorate freeze for hostless projects.
    await syncProjectHostingLifecycle(prisma, projectId);
    await applyProjectParticipationTransitions(prisma, projectId);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true, name: true, description: true, status: true,
        pendingClosureAt: true, pendingClosureElectorate: true, foundingGroupId: true,
      },
    });

    // Require active project membership OR active group membership in any host group
    const currentMembership = await prisma.projectMembership.findUnique({
      where: { accountId_projectId: { accountId, projectId } },
      select: { id: true, status: true, participationStatus: true },
    });

    // Current hosting only — a group's founding role confers no ongoing standing
    // once it is no longer an active host (RFC-007).
    const hostings = await prisma.projectHosting.findMany({
      where: { projectId, endedAt: null },
      select: { groupId: true, group: { select: { id: true, name: true } } },
    });
    const hostGroups = hostings.map((h) => ({ id: h.groupId, name: h.group.name }));

    // Pending-closure adoption (RFC-007 ProjectHostingProposal): the acting
    // account can sponsor the project's side of an adoption only if its own
    // ProjectMembership is part of the frozen pending-closure electorate (see
    // openProjectHostingProposal) — and can sponsor a candidate group's side
    // only where it holds active+active membership in a group that isn't
    // already an active host.
    let eligibleAsProjectSponsor = false;
    let candidateHostGroups: { id: string; groupId: string; name: string }[] = [];
    if (project.pendingClosureAt !== null) {
      const frozenElectorate = project.pendingClosureElectorate as { projectMembershipIds: string[] } | null;
      eligibleAsProjectSponsor = !!(
        currentMembership &&
        currentMembership.status === "active" &&
        frozenElectorate?.projectMembershipIds.includes(currentMembership.id)
      );

      const hostGroupIds = hostings.map((h) => h.groupId);
      const candidateMemberships = await prisma.groupMembership.findMany({
        where: {
          accountId, status: "active", participationStatus: "active",
          groupId: { notIn: hostGroupIds },
        },
        select: { id: true, groupId: true, group: { select: { id: true, name: true } } },
        orderBy: { group: { name: "asc" } },
      });
      candidateHostGroups = candidateMemberships.map((m) => ({ id: m.id, groupId: m.groupId, name: m.group.name }));
    }

    // If not a project member, check if they're a group member of any host group
    if (!currentMembership || currentMembership.status !== "active") {
      const hostGroupIds = hostGroups.map((g) => g.id);
      const groupMembership = await prisma.groupMembership.findFirst({
        where: { accountId, groupId: { in: hostGroupIds }, status: "active" },
        select: { id: true },
      });
      if (!groupMembership) redirect("/dashboard");
    }

    const [bulletins, publications, livingDocuments, activeParticipantCount] = await Promise.all([
      prisma.bulletin.findMany({
        where: { spaceType: "project", spaceId: projectId, archivedAt: null },
        include: { author: { select: { displayName: true } } },
        orderBy: { publishedAt: "desc" },
      }),
      prisma.publication.findMany({
        where: { spaceType: "project", spaceId: projectId, archivedAt: null },
        include: {
          creator: { select: { displayName: true } },
          _count: { select: { entries: { where: { archivedAt: null } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.livingDocument.findMany({
        where: { spaceType: "project", spaceId: projectId, archivedAt: null },
        orderBy: { lastRevisedAt: "desc" },
      }),
      prisma.projectMembership.count({ where: { projectId, status: "active", participationStatus: "active" } }),
    ]);

    // Discussion (project-native authorization — readable regardless of current
    // hosting state, per RFC-007 "the project remains fully readable")
    const discussionThreads = await listProjectDiscussionThreads(prisma, { projectId });
    const selectedThread = discussionThreads.find((t) => t.id === selectedThreadId) ?? discussionThreads[0] ?? null;
    const discussionMessages = selectedThread ? await listDiscussionMessages(prisma, selectedThread.id) : [];

    // Petitions for this project
    const petitionRows = await prisma.petition.findMany({
      where: { scopeType: "project", scopeId: projectId },
      orderBy: [{ status: "asc" }, { closesAt: "asc" }],
      include: {
        _count: { select: { support: true } },
        support: currentMembership
          ? { where: { projectMembershipId: currentMembership.id }, select: { id: true }, take: 1 }
          : { where: { id: "never" }, select: { id: true }, take: 0 },
      },
      take: 12,
    });

    const petitions = petitionRows.map((p) => {
      const snapshot = p.governanceSnapshot as { threshold: number } | null;
      const threshold = snapshot?.threshold ?? 0.6;
      return {
        id: p.id,
        subjectType: p.subjectType,
        status: p.status,
        closesAt: p.closesAt,
        supportCount: p._count.support,
        requiredSupport: Math.ceil(activeParticipantCount * threshold),
        supportedByCurrentMember: p.support.length > 0,
      };
    });

    // Contribution categories for project scope
    // Project-offered categories are anchored at foundingGroupId (see contribution-categories.ts),
    // independent of which group(s) currently host the project.
    const rawCategories = await getAvailableCategoriesForScope(prisma, { groupId: project.foundingGroupId, projectId });

    // Member roster
    const projectMembers = await prisma.projectMembership.findMany({
      where: { projectId, status: "active" },
      select: {
        id: true,
        participationStatus: true,
        account: {
          select: {
            displayName: true,
            groupMemberships: {
              where: { status: "active", groupId: { in: hostGroups.map((group) => group.id) } },
              select: {
                group: {
                  select: { id: true, name: true, privacyPreferences: true },
                },
              },
            },
          },
        },
      },
      orderBy: { account: { displayName: "asc" } },
    });

    return {
      project,
      currentMembership,
      hostGroups,
      eligibleAsProjectSponsor,
      candidateHostGroups,
      bulletins,
      publications,
      livingDocuments,
      activeParticipantCount,
      discussionThreads,
      selectedThread,
      discussionMessages,
      petitions,
      contributionCategories: rawCategories,
      projectMembers: projectMembers.map((membership) => ({
        id: membership.id,
        participationStatus: membership.participationStatus,
        account: { displayName: membership.account.displayName },
        affiliations: visibleProjectRosterAffiliations(
          membership.account.groupMemberships.map(({ group }) => group),
        ),
      })),
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Server Actions ────────────────────────────────────────────────────────────

async function requireProjectMembership(accountId: string, projectId: string) {
  const prisma = createPrismaClient();
  const membership = await prisma.projectMembership.findUnique({
    where: { accountId_projectId: { accountId, projectId } },
    select: { id: true, status: true, participationStatus: true },
  });
  await prisma.$disconnect();
  if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
    throw new Error("Active project membership required.");
  }
  return membership;
}

async function leaveProjectAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const prisma = createPrismaClient();
  try {
    await leaveProject(prisma, session.accountId, projectId);
  } finally {
    await prisma.$disconnect();
  }
  redirect("/dashboard");
}

async function proposeProjectHostingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = requiredString(formData, "projectId");
  const projectMembershipId = requiredString(formData, "projectMembershipId");
  const candidateMembershipId = requiredString(formData, "candidateMembershipId");
  const content = requiredString(formData, "content");

  const prisma = createPrismaClient();
  try {
    const [projectMembership, candidateMembership] = await Promise.all([
      prisma.projectMembership.findUnique({
        where: { id: projectMembershipId },
        select: { accountId: true, projectId: true, status: true },
      }),
      prisma.groupMembership.findUnique({
        where: { id: candidateMembershipId },
        select: { accountId: true, groupId: true, status: true, participationStatus: true },
      }),
    ]);
    if (!projectMembership || projectMembership.accountId !== session.accountId || projectMembership.projectId !== projectId || projectMembership.status !== "active") {
      return { kind: "error", message: "Your project membership could not be confirmed." };
    }
    if (!candidateMembership || candidateMembership.accountId !== session.accountId || candidateMembership.status !== "active" || candidateMembership.participationStatus !== "active") {
      return { kind: "error", message: "You must hold active participation in the candidate group to sponsor its offer to host." };
    }

    const result = await openProjectHostingProposal(prisma, {
      projectId,
      candidateGroupId: candidateMembership.groupId,
      groupCreatedByMembershipId: candidateMembershipId,
      projectCreatedByProjectMembershipId: projectMembershipId,
      content,
    });
    if (!result.ok) return { kind: "error", message: projectHostingProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
  return { kind: "success", message: "Hosting proposal opened — both the candidate group and the project's frozen membership will decide through their own petitions." };
}

function projectHostingProposalFailureMessage(reason: string) {
  switch (reason) {
    case "not_eligible": return "Both the candidate group and the project sponsor must hold active, active-participation membership.";
    case "project_not_adoptable": return "This project is not currently open to successor-host adoption.";
    case "already_hosted": return "That group is already an active host of this project.";
    case "empty_electorate": return "This project's frozen pre-closure membership is empty, so adoption cannot proceed — its remaining participants may found a new group instead.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
}

async function createDiscussionThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const title = requiredString(formData, "title");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await createProjectDiscussionThread(prisma, { projectId, title, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function postDiscussionMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await postProjectDiscussionMessage(prisma, { threadId, projectId, authorProjectMembershipId: projectMembership.id, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function createBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    const hosting = await prisma.projectHosting.findFirst({ where: { projectId, endedAt: null }, select: { groupId: true } });
    if (!hosting) throw new Error("Project has no active host.");
    await proposeBulletinCreation(prisma, { spaceType: "project", spaceId: projectId, groupId: hosting.groupId, title, body, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function archiveBulletinAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const bulletinId = formData.get("bulletinId") as string;
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await openProjectBulletinArchivalPetition(prisma, { bulletinId, projectId, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function createPublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const title = requiredString(formData, "title");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    const hosting = await prisma.projectHosting.findFirst({ where: { projectId, endedAt: null }, select: { groupId: true } });
    if (!hosting) throw new Error("Project has no active host.");
    await proposePublicationCreation(prisma, { spaceType: "project", spaceId: projectId, groupId: hosting.groupId, title, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function proposePubEntryCreationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const publicationId = requiredString(formData, "publicationId");
  const body = requiredString(formData, "body");
  const title = formData.get("title") as string | null;
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    const hosting = await prisma.projectHosting.findFirst({ where: { projectId, endedAt: null }, select: { groupId: true } });
    if (!hosting) throw new Error("Project has no active host.");
    await proposePubEntryCreation(prisma, { spaceType: "project", spaceId: projectId, publicationId, groupId: hosting.groupId, body, title: title || undefined, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function archivePublicationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const publicationId = formData.get("publicationId") as string;
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await openProjectPublicationArchivalPetition(prisma, { publicationId, projectId, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function createLivingDocumentAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    const hosting = await prisma.projectHosting.findFirst({ where: { projectId, endedAt: null }, select: { groupId: true } });
    if (!hosting) throw new Error("Project has no active host.");
    await proposeLivingDocumentCreation(prisma, { spaceType: "project", spaceId: projectId, groupId: hosting.groupId, title, body, createdByProjectMembershipId: projectMembership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function proposeLivingDocumentRevisionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const livingDocumentId = requiredString(formData, "livingDocumentId");
  const body = requiredString(formData, "body");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    const draft = await draftLivingDocumentRevision(prisma, { livingDocumentId, body, authorId: session.accountId });
    await openProjectRevisionPetition(prisma, { livingDocumentId, revisionId: draft.id, createdByProjectMembershipId: projectMembership.id, projectId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function evaluateClosedPetitionsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const prisma = createPrismaClient();
  try {
    const petitions = await prisma.petition.findMany({
      where: { scopeType: "project", scopeId: projectId, status: "open", closesAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const p of petitions) await evaluateAndApplyPetition(prisma, p.id);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

async function supportPetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const projectMembershipId = requiredString(formData, "projectMembershipId");
  const prisma = createPrismaClient();
  try {
    await addPetitionSupport(prisma, { petitionId, projectMembershipId });
  } finally {
    await prisma.$disconnect();
  }
  const projectId = formData.get("projectId") as string;
  revalidatePath(`/projects/${projectId}`);
}

async function withdrawPetitionSupportAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const projectMembershipId = requiredString(formData, "projectMembershipId");
  const prisma = createPrismaClient();
  try {
    await withdrawPetitionSupport(prisma, { petitionId, projectMembershipId });
  } finally {
    await prisma.$disconnect();
  }
  const projectId = formData.get("projectId") as string;
  revalidatePath(`/projects/${projectId}`);
}

async function proposeCategoryAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const projectId = formData.get("projectId") as string;
  const name = requiredString(formData, "name");
  const description = requiredString(formData, "description");
  const projectMembership = await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await proposeProjectContributionCategory(prisma, {
      projectMembershipId: projectMembership.id,
      projectId,
      name,
      description,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/projects/${projectId}`);
}

// ── Utilities ──────────────────────────────────────────────────────────────
