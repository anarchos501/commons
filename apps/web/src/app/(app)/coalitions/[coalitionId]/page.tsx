import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlphaNotice, Notice } from "../../../../components/shared/Notice";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { canAccessCoalition } from "../../../../lib/coalition-authorization";
import {
  createCoalitionDiscussionThread,
  listCoalitionDiscussionThreads,
  listDiscussionMessages,
  postCoalitionDiscussionMessage,
} from "../../../../lib/discussions";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { requiredString } from "../../../../lib/support-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ coalitionId: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
};

export default async function CoalitionSpacePage({ params, searchParams }: PageProps) {
  const { coalitionId } = await params;
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const selectedThreadId = typeof sp.discussionThread === "string" ? sp.discussionThread : null;
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const data = await getCoalitionSpaceData(session.accountId, coalitionId, selectedThreadId);

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <AlphaNotice />
        {notice && <div className="mt-4"><Notice message={notice} /></div>}

        <div className="flex flex-col divide-y divide-[var(--border)] border border-[var(--border)]">
          <div className="bg-[var(--surface)] p-5 sm:p-6">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Coalition coordination space
            </span>
            <h1 className="mt-1 text-2xl font-bold text-[var(--text)]">{data.coalition.name}</h1>
            {data.coalition.description && (
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{data.coalition.description}</p>
            )}
            <p className="mt-3 text-xs text-[var(--muted)]">
              {data.coalition.memberships.length} member {data.coalition.memberships.length === 1 ? "group" : "groups"}
            </p>
          </div>

          <CollapsibleSection
            id="discussion"
            title="Discussion"
            eyebrow="Shared temporary coordination"
            storageKey={`coalition:${coalitionId}:section:discussion`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            {data.discussionThreads.length > 0 ? (
              <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  {data.discussionThreads.map((thread) => (
                    <a
                      key={thread.id}
                      href={`/coalitions/${coalitionId}?discussionThread=${thread.id}#discussion`}
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
                          {data.discussionMessages.map((message) => (
                            <div key={message.id} className="bg-[var(--subtle)] px-3 py-2">
                              <p className="text-sm leading-6 text-[var(--soft-text)]">{message.body}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">{message.author.displayName}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState text="No active messages in this thread." />
                      )}
                      {data.canWrite && (
                        <form action={postDiscussionMessageAction} className="mt-2 space-y-2">
                          <input type="hidden" name="coalitionId" value={coalitionId} />
                          <input type="hidden" name="threadId" value={data.selectedThread.id} />
                          <textarea
                            name="body"
                            required
                            rows={3}
                            className="field-input resize-none"
                            placeholder="Add a coordination note."
                          />
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
            {data.canWrite && (
              <form action={createDiscussionThreadAction} className="space-y-3">
                <input type="hidden" name="coalitionId" value={coalitionId} />
                <label className="block">
                  <span className="field-label">New thread</span>
                  <input
                    name="title"
                    type="text"
                    required
                    className="field-input"
                    placeholder="A focused coordination topic"
                  />
                </label>
                <SubmitButton variant="secondary">Create thread</SubmitButton>
              </form>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="members"
            title="Member Groups"
            eyebrow="Independent governance"
            storageKey={`coalition:${coalitionId}:section:members`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
              {data.coalition.memberships.map((membership) => (
                <a
                  key={membership.id}
                  href={`/groups/${membership.group.id}`}
                  className="block px-3 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  {membership.group.name}
                </a>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Coalition decisions are ratified separately by the participating groups. This space does not create a pooled electorate.
            </p>
          </CollapsibleSection>

          <CollapsibleSection
            id="proposals"
            title="Coalition Proposals"
            eyebrow="Federated petition bundles"
            storageKey={`coalition:${coalitionId}:section:proposals`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            {data.coalition.proposals.length > 0 ? (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
                {data.coalition.proposals.map((proposal) => (
                  <div key={proposal.id} className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium capitalize text-[var(--text)]">{proposal.action}</p>
                      <span className="text-xs capitalize text-[var(--muted)]">{proposal.status.replaceAll("-", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {proposal.petitions.length} participating group {proposal.petitions.length === 1 ? "petition" : "petitions"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No coalition proposals have been recorded." />
            )}
          </CollapsibleSection>
        </div>
      </div>
    </main>
  );
}

async function getCoalitionSpaceData(accountId: string, coalitionId: string, selectedThreadId: string | null) {
  const prisma = createPrismaClient();
  try {
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      include: {
        memberships: {
          where: { endedAt: null },
          include: { group: { select: { id: true, name: true } } },
          orderBy: { joinedAt: "asc" },
        },
        proposals: {
          include: { petitions: { select: { petitionId: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!coalition || coalition.status !== "active" || !(await canAccessCoalition(prisma, accountId, coalitionId))) {
      redirect("/dashboard");
    }

    const discussionThreads = await listCoalitionDiscussionThreads(prisma, { coalitionId, accountId });
    const selectedThread =
      discussionThreads.find((thread) => thread.id === selectedThreadId) ?? discussionThreads[0] ?? null;
    const discussionMessages = selectedThread
      ? await listDiscussionMessages(prisma, selectedThread.id)
      : [];
    const canWrite = await prisma.groupMembership.count({
      where: {
        accountId,
        status: "active",
        participationStatus: "active",
        group: {
          coalitionMemberships: {
            some: { coalitionId, endedAt: null },
          },
        },
      },
    });

    return {
      coalition,
      discussionThreads,
      selectedThread,
      discussionMessages,
      canWrite: canWrite > 0,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function createDiscussionThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    await createCoalitionDiscussionThread(prisma, { coalitionId, accountId: session.accountId, title });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
}

async function postDiscussionMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    await postCoalitionDiscussionMessage(prisma, {
      coalitionId,
      threadId,
      accountId: session.accountId,
      body,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
}
