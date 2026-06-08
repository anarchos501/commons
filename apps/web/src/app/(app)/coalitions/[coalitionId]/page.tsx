import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlphaNotice, Notice } from "../../../../components/shared/Notice";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import { type FormState } from "../../../../components/shared/form-state";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { canAccessCoalition } from "../../../../lib/coalition-authorization";
import {
  openCoalitionDepartureProposal,
  openCoalitionJoinProposal,
  openCoalitionRemovalProposal,
} from "../../../../lib/coalitions";
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
            id="coalition-actions"
            title="Coalition Actions"
            eyebrow="Federated petition bundles"
            storageKey={`coalition:${coalitionId}:section:actions`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Apply to join this coalition</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Joining requires unanimous consent — every current member group, plus the applicant, decides
                  through its own internal petition. You can only sponsor that consent where you hold active
                  participation.
                </p>
                {data.canSponsorEveryCurrentMember ? (
                  data.joinApplicantOptions.length > 0 ? (
                    <FormWithNotice action={joinCoalitionAction} className="mt-3 space-y-3">
                      <input type="hidden" name="coalitionId" value={coalitionId} />
                      <label className="block">
                        <span className="field-label">Applying as</span>
                        <select name="applicantGroupId" required className="field-input">
                          <option value="">Select a group&hellip;</option>
                          {data.joinApplicantOptions.map((option) => (
                            <option key={option.groupId} value={option.groupId}>{option.group.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="field-label">Rationale</span>
                        <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this group join?" />
                      </label>
                      <SubmitButton variant="secondary">Open join proposal</SubmitButton>
                    </FormWithNotice>
                  ) : (
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      You don&apos;t hold active participation in any other group on this node that could apply to join.
                    </p>
                  )
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    Applying to join requires sponsoring every current member group&apos;s consent with your own active
                    membership there — you don&apos;t currently hold active participation in all of them.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Propose departure</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Voluntary departure is decided solely by the departing group&apos;s own governance — the coalition
                  cannot prevent or delay it.
                </p>
                {data.departureOptions.length > 0 ? (
                  <FormWithNotice action={departCoalitionAction} className="mt-3 space-y-3">
                    <input type="hidden" name="coalitionId" value={coalitionId} />
                    <label className="block">
                      <span className="field-label">Departing group</span>
                      <select name="departingGroupId" required className="field-input">
                        <option value="">Select a group&hellip;</option>
                        {data.departureOptions.map((option) => (
                          <option key={option.groupId} value={option.groupId}>{option.groupName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Rationale</span>
                      <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why is this group departing?" />
                    </label>
                    <SubmitButton variant="secondary">Open departure proposal</SubmitButton>
                  </FormWithNotice>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    You don&apos;t hold active participation in any current member group.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Propose removal of a member group</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Removal acts on another group rather than expressing one&apos;s own will — the targeted group does not
                  participate; every remaining member group must consent.
                </p>
                {data.removalOptions.length > 0 ? (
                  <FormWithNotice action={removeCoalitionMemberAction} className="mt-3 space-y-3">
                    <input type="hidden" name="coalitionId" value={coalitionId} />
                    <label className="block">
                      <span className="field-label">Group to remove</span>
                      <select name="targetGroupId" required className="field-input">
                        <option value="">Select a group&hellip;</option>
                        {data.removalOptions.map((option) => (
                          <option key={option.groupId} value={option.groupId}>{option.groupName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Rationale</span>
                      <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this group be removed?" />
                    </label>
                    <SubmitButton variant="secondary">Open removal proposal</SubmitButton>
                  </FormWithNotice>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    Proposing removal requires sponsoring every remaining member group&apos;s consent with your own
                    active membership there — you don&apos;t currently hold active participation in enough of them.
                  </p>
                )}
              </div>
            </div>
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

    const currentGroupIds = coalition.memberships.map((membership) => membership.groupId);

    // The account's active+active memberships in this coalition's CURRENT member
    // groups — the only memberships it can use to sponsor a join/removal proposal,
    // each of which requires every relevant existing member group's own consent
    // (see openCoalitionJoinProposal / openCoalitionRemovalProposal).
    const myCurrentMemberMemberships = await prisma.groupMembership.findMany({
      where: {
        accountId,
        status: "active",
        participationStatus: "active",
        groupId: { in: currentGroupIds },
      },
      select: { id: true, groupId: true },
    });
    const myMembershipIdByGroupId = new Map(myCurrentMemberMemberships.map((m) => [m.groupId, m.id]));
    const canSponsorEveryCurrentMember = currentGroupIds.every((id) => myMembershipIdByGroupId.has(id));

    const departureOptions = currentGroupIds
      .filter((id) => myMembershipIdByGroupId.has(id))
      .map((id) => {
        const membership = coalition.memberships.find((m) => m.groupId === id)!;
        return { groupId: id, groupName: membership.group.name };
      });

    const removalOptions = currentGroupIds
      .filter((targetId) => currentGroupIds.filter((id) => id !== targetId).every((id) => myMembershipIdByGroupId.has(id)))
      .map((targetId) => {
        const membership = coalition.memberships.find((m) => m.groupId === targetId)!;
        return { groupId: targetId, groupName: membership.group.name };
      });

    const joinApplicantOptions = canSponsorEveryCurrentMember
      ? await prisma.groupMembership.findMany({
          where: {
            accountId,
            status: "active",
            participationStatus: "active",
            groupId: { notIn: currentGroupIds },
            group: { nodeId: coalition.nodeId },
          },
          select: { id: true, groupId: true, group: { select: { id: true, name: true } } },
          orderBy: { group: { name: "asc" } },
        })
      : [];

    const canWrite = myCurrentMemberMemberships.length > 0;

    return {
      coalition,
      discussionThreads,
      selectedThread,
      discussionMessages,
      canWrite,
      departureOptions,
      removalOptions,
      canSponsorEveryCurrentMember,
      joinApplicantOptions,
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

async function joinCoalitionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const applicantGroupId = requiredString(formData, "applicantGroupId");
  const content = requiredString(formData, "content");

  const prisma = createPrismaClient();
  try {
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    const currentGroupIds = coalition.memberships.map((membership) => membership.groupId);

    const myMemberships = await prisma.groupMembership.findMany({
      where: {
        accountId: session.accountId,
        status: "active",
        participationStatus: "active",
        groupId: { in: [applicantGroupId, ...currentGroupIds] },
      },
      select: { id: true, groupId: true },
    });
    const myMembershipByGroupId = new Map(myMemberships.map((m) => [m.groupId, m]));

    const applicant = myMembershipByGroupId.get(applicantGroupId);
    if (!applicant) {
      return { kind: "error", message: "You must hold active participation in the applying group." };
    }
    const memberSponsors = currentGroupIds.map((groupId) => myMembershipByGroupId.get(groupId)).filter((m): m is { id: string; groupId: string } => !!m);
    if (memberSponsors.length !== currentGroupIds.length) {
      return { kind: "error", message: "You must hold active participation in every current member group to sponsor their consent." };
    }

    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: { groupId: applicantGroupId, createdByMembershipId: applicant.id },
      memberSponsors: memberSponsors.map((m) => ({ groupId: m.groupId, createdByMembershipId: m.id })),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Join proposal opened — the applicant and every current member group will decide through their own petition." };
}

async function departCoalitionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const departingGroupId = requiredString(formData, "departingGroupId");
  const content = requiredString(formData, "content");

  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId: departingGroupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      return { kind: "error", message: "You must hold active participation in the departing group to sponsor this proposal." };
    }

    const result = await openCoalitionDepartureProposal(prisma, {
      coalitionId,
      departing: { groupId: departingGroupId, createdByMembershipId: membership.id },
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Departure proposal opened — the departing group will decide through its own petition." };
}

async function removeCoalitionMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const targetGroupId = requiredString(formData, "targetGroupId");
  const content = requiredString(formData, "content");

  const prisma = createPrismaClient();
  try {
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    const currentGroupIds = coalition.memberships.map((membership) => membership.groupId);
    const remainingGroupIds = currentGroupIds.filter((groupId) => groupId !== targetGroupId);
    if (remainingGroupIds.length === 0) {
      return { kind: "error", message: coalitionProposalFailureMessage("invalid_participants") };
    }

    const remainingMemberships = await prisma.groupMembership.findMany({
      where: {
        accountId: session.accountId,
        status: "active",
        participationStatus: "active",
        groupId: { in: remainingGroupIds },
      },
      select: { id: true, groupId: true },
    });
    if (remainingMemberships.length !== remainingGroupIds.length) {
      return { kind: "error", message: "You must hold active participation in every remaining member group to sponsor this proposal." };
    }

    const result = await openCoalitionRemovalProposal(prisma, {
      coalitionId,
      targetGroupId,
      remainingSponsors: remainingMemberships.map((m) => ({ groupId: m.groupId, createdByMembershipId: m.id })),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Removal proposal opened — every remaining member group will decide through its own petition." };
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
