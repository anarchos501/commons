import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import {
  applyProjectParticipationTransitions,
  recordProjectPresence,
  leaveProject,
} from "../../../../lib/project-membership";
import { createBulletin, openProjectBulletinArchivalPetition } from "../../../../lib/bulletins";
import { createPublication, openProjectPublicationArchivalPetition } from "../../../../lib/publications";
import {
  createLivingDocument,
  draftLivingDocumentRevision,
  openProjectRevisionPetition,
} from "../../../../lib/living-documents";
import {
  listDiscussionMessages,
  listDiscussionThreads,
  createProjectDiscussionThread,
  postProjectDiscussionMessage,
} from "../../../../lib/discussions";
import { addPetitionSupport, withdrawPetitionSupport } from "../../../../lib/petitions";
import { evaluateAndApplyPetition } from "../../../../lib/petition-evaluation";
import {
  proposeProjectContributionCategory,
  getAvailableCategoriesForScope,
} from "../../../../lib/contribution-categories";
import { requiredString } from "../../../../lib/support-form";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { Notice, AlphaNotice } from "../../../../components/shared/Notice";

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
            {data.hostGroups.map((g) => (
              <a key={g.id} href={`/groups/${g.id}`} className="text-[var(--accent)] hover:underline">
                ↑ {g.name}
              </a>
            ))}
          </div>
          {currentMembership && isActive && (
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
                    {isActive && (
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
          {isActive && (
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
                          {isActive && (
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
                {isActive && (
                  <form action={createBulletinAction} className="space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="A short title" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={4} className="field-input resize-none" placeholder="Update text" /></label>
                    <SubmitButton variant="secondary">Post bulletin</SubmitButton>
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
                      <div key={p.id} className="border border-[var(--border)] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                          {isActive && (
                            <form action={archivePublicationAction}>
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="publicationId" value={p.id} />
                              <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">Archive</button>
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
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="e.g. Project Resources" /></label>
                    <SubmitButton variant="secondary">Create publication</SubmitButton>
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
                        {isActive && (
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
                {isActive && (
                  <form action={createLivingDocumentAction} className="space-y-3">
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="block"><span className="field-label">Title</span><input name="title" type="text" required className="field-input" placeholder="e.g. Charter, Guidelines" /></label>
                    <label className="block"><span className="field-label">Body</span><textarea name="body" required rows={4} className="field-input resize-none" placeholder="The current text." /></label>
                    <SubmitButton variant="secondary">Create document</SubmitButton>
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
                      {isActive && petition.status === "open" && (
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
              {isActive && (
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
    await applyProjectParticipationTransitions(prisma, projectId);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, description: true, status: true, groupId: true },
    });

    // Require active project membership OR active group membership in any host group
    const currentMembership = await prisma.projectMembership.findUnique({
      where: { accountId_projectId: { accountId, projectId } },
      select: { id: true, status: true, participationStatus: true },
    });

    const hostings = await prisma.projectHosting.findMany({
      where: { projectId },
      select: { groupId: true, group: { select: { id: true, name: true } } },
    });
    const hostGroupId = project.groupId; // primary host group for petitions
    const hostGroups = hostings.map((h) => ({ id: h.groupId, name: h.group.name }));

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

    // Discussion (threads are anchored to host group until discussion lib is project-aware)
    const discussionThreads = await listDiscussionThreads(prisma, { spaceType: "project", spaceId: projectId, groupId: hostGroupId });
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
    const rawCategories = await getAvailableCategoriesForScope(prisma, { groupId: hostGroupId, projectId });

    return {
      project,
      currentMembership,
      hostGroups,
      hostGroupId,
      bulletins,
      publications,
      livingDocuments,
      activeParticipantCount,
      discussionThreads,
      selectedThread,
      discussionMessages,
      petitions,
      contributionCategories: rawCategories,
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
  await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await createBulletin(prisma, { spaceType: "project", spaceId: projectId, title, body, authorId: session.accountId });
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
  await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await createPublication(prisma, { spaceType: "project", spaceId: projectId, title, createdByAccountId: session.accountId });
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
  await requireProjectMembership(session.accountId, projectId);
  const prisma = createPrismaClient();
  try {
    await createLivingDocument(prisma, { spaceType: "project", spaceId: projectId, title, body, authorId: session.accountId });
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
