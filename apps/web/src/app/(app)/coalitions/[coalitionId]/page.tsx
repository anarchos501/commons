import { NodeTag } from "../../../../components/shared/NodeTag";
import { revalidatePath } from "next/cache";
import { broadcastCoalitionMessage } from "../../../../lib/federated-coalitions";
import { redirect } from "next/navigation";
import { AlphaNotice, Notice } from "../../../../components/shared/Notice";
import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { DiscussionMessage } from "../../../../components/shared/DiscussionMessage";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import { type FormState } from "../../../../components/shared/form-state";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { canAccessCoalition, requireCoalitionWritable } from "../../../../lib/coalition-authorization";
import { resolveWriteAuthority } from "../../../../lib/continuity";
import { openCoalitionBackupDesignationProposal } from "../../../../lib/coalitions";
import { proposeCoalitionBackupWithdrawal } from "../../../../lib/federated-coalitions";
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
import { listNodeGroupLabelsForAccount } from "../../../../lib/node-privacy";
import { requiredString } from "../../../../lib/support-form";
import { SpaceCalendar } from "../../../../components/shared/SpaceCalendar";
import { loadSpaceCalendarData } from "../../../../lib/calendar-data";
import { submitEvent, setInterest, cancelEvent } from "../../../../lib/events";
import { parseEventSubmission, submitEventFailureMessage } from "../../../../lib/event-form";
import type { EventInterestLevel } from "../../../../generated/prisma/enums";

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

  const calendar = await loadSpaceCalendarData(session.accountId, "coalition", coalitionId);

  async function submitCoalitionEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const input = parseEventSubmission(formData, { accountId: s.accountId, hostType: "coalition", hostId: coalitionId });
    const prisma = createPrismaClient();
    try {
      await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
      const result = await submitEvent(prisma, input);
      if (!result.ok) return { kind: "error", message: submitEventFailureMessage(result.reason) };
      revalidatePath(`/coalitions/${coalitionId}`);
      return {
        kind: "success",
        message: result.kind === "created"
          ? "Workshop scheduled."
          : "Event proposed — each member collective decides through its own petition.",
      };
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
    revalidatePath(`/coalitions/${coalitionId}`);
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
    revalidatePath(`/coalitions/${coalitionId}`);
  }

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
              {data.coalition.memberships.length} member {data.coalition.memberships.length === 1 ? "collective" : "collectives"}
            </p>
            {data.continuityAuthority !== "writable" && (
              <div className="mt-3 border border-[var(--border)] bg-[var(--subtle)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Continuity failover</p>
                <p className="mt-1 text-sm text-[var(--soft-text)]">
                  {data.continuityAuthority === "unverified"
                    ? "This node just restarted and is verifying with the coalition's backup node. The space is read-only for a moment."
                    : "This coalition's home node has been out of federation contact longer than its failover window — the space is read-only until contact returns. Proposals are paused, not lost."}
                </p>
              </div>
            )}
          </div>

          <CollapsibleSection
            id="continuity"
            title="Continuity"
            eyebrow="Backup designation — a decision of every member collective"
            storageKey={`coalition:${coalitionId}:section:continuity`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            {data.continuity.backup && data.continuity.backup.status !== "revoked" && data.continuity.backup.status !== "ended" ? (
              <div className="space-y-2 text-sm text-[var(--soft-text)]">
                <p>
                  Backup on <span className="font-medium text-[var(--text)]">{data.continuity.backup.peerLabel}</span>{" "}
                  ({data.continuity.backup.peerDomain}) · window {data.continuity.backup.windowHours}h · directive{" "}
                  <span className="capitalize">{data.continuity.backup.directive}</span> ·{" "}
                  <span className="capitalize">{data.continuity.backup.status.replaceAll("_", " ")}</span>
                  {data.continuity.backup.lastReplicatedAt && (
                    <> · last replicated {data.continuity.backup.lastReplicatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</>
                  )}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  The replica holds this coalition&apos;s home-side skeleton and relay thread only — never member
                  collectives&apos; own data. Any single member collective can withdraw its consent, which revokes
                  the backup for everyone (it stands on unanimous consent).
                </p>
                {data.continuity.withdrawOptions.length > 0 && (
                  <FormWithNotice action={withdrawCoalitionBackupAction} className="mt-2">
                    <input type="hidden" name="coalitionId" value={coalitionId} />
                    <label className="block max-w-xs">
                      <span className="field-label">Withdraw consent as</span>
                      <select name="groupId" className="field-input">
                        {data.continuity.withdrawOptions.map((member) => (
                          <option key={member.groupId} value={member.groupId}>{member.groupName}</option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-2">
                      <SubmitButton variant="secondary">Open withdrawal petition</SubmitButton>
                    </div>
                  </FormWithNotice>
                )}
              </div>
            ) : data.continuity.hasOpenProposal ? (
              <p className="text-sm text-[var(--soft-text)]">
                A backup designation is being decided — every member collective, on every node, votes through its
                own governance. It applies only when all approve.
              </p>
            ) : data.canWrite && data.continuity.activePeers.length > 0 ? (
              <FormWithNotice action={proposeCoalitionBackupDesignationAction} className="space-y-3">
                <input type="hidden" name="coalitionId" value={coalitionId} />
                <p className="text-sm text-[var(--soft-text)]">
                  Designating a backup asks EVERY member collective — on every node — to consent to the chosen
                  node, the failover window, and the advance directive. The replica holds the coalition&apos;s
                  home-side skeleton and relay thread only, never member collectives&apos; own data.
                </p>
                {/* The calm-weather property (register F-8): stated where the decision is made. */}
                <p className="text-xs text-[var(--muted)]">
                  Designation needs every member node reachable — a proposal with an unreachable member times out.
                  Arrange protection before you need it: designate early, in calm weather.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="field-label">Backup node</span>
                    <select name="peerNodeId" className="field-input">
                      {data.continuity.activePeers.map((peer) => (
                        <option key={peer.id} value={peer.id}>{peer.displayName ?? peer.domain}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Failover window (hours)</span>
                    <input name="windowHours" type="number" min={1} defaultValue={24} className="field-input" />
                  </label>
                  <label className="block">
                    <span className="field-label">If the home is ever permanently lost</span>
                    <select name="directive" className="field-input">
                      <option value="none">Do nothing — members re-form by hand</option>
                      <option value="reconstitute">Consent now to re-forming from the replica</option>
                    </select>
                  </label>
                  <SubmitButton variant="secondary">Open designation proposal</SubmitButton>
                </div>
              </FormWithNotice>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No backup designated. Designation requires an active federation agreement and an active membership
                in a member collective.
              </p>
            )}
          </CollapsibleSection>

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
                            <DiscussionMessage
                              key={message.id}
                              body={message.body}
                              authorName={message.author.displayName}
                              authorId={message.authorId}
                              viewerAccountId={session.accountId ?? null}
                            />
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

          <SpaceCalendar
            sectionId="calendar"
            storageKey={`coalition:${coalitionId}:section:calendar`}
            events={calendar.events}
            myInterests={calendar.myInterests}
            audiences={calendar.audiences}
            canCreate={data.canWrite}
            allowMeeting
            currentAccountId={session.accountId}
            submitAction={submitCoalitionEventAction}
            interestAction={eventInterestAction}
            cancelAction={eventCancelAction}
          />

          <CollapsibleSection
            id="members"
            title="Member Collectives"
            eyebrow="Independent governance"
            storageKey={`coalition:${coalitionId}:section:members`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
              {data.coalition.memberships.map((membership) =>
                membership.group ? (
                  <a
                    key={membership.id}
                    href={`/groups/${membership.group.id}`}
                    className="block px-3 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                  >
                    {membership.group.name}
                  </a>
                ) : membership.federatedGroupPresence ? (
                  // Remote member collectives are full members — rendered
                  // with the node tag, never silently dropped (F3(3)).
                  <p key={membership.id} className="px-3 py-3 text-sm font-medium text-[var(--text)]">
                    {membership.federatedGroupPresence.name}
                    <NodeTag
                      domain={membership.federatedGroupPresence.federatedNode.domain}
                      status={membership.federatedGroupPresence.status}
                    />
                  </p>
                ) : null,
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Coalition decisions are made separately by each participating collective. This space does not create a pooled electorate.
            </p>
          </CollapsibleSection>

          <CollapsibleSection
            id="coalition-actions"
            title="Coalition Actions"
            eyebrow="Actions requiring joint agreement"
            storageKey={`coalition:${coalitionId}:section:actions`}
            className="bg-[var(--surface)] p-5 sm:p-6"
          >
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Invite a collective to join</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  To join, every current member collective — and the applicant — must agree through their own
                  internal petition. Any active participant in a member collective can start the process.
                </p>
                {data.canSponsorCurrentMember ? (
                  data.joinApplicantOptions.length > 0 ? (
                    <FormWithNotice action={joinCoalitionAction} className="mt-3 space-y-3">
                      <input type="hidden" name="coalitionId" value={coalitionId} />
                      <label className="block">
                        <span className="field-label">Collective to invite</span>
                        <select name="applicantGroupId" required className="field-input">
                          <option value="">Select a collective&hellip;</option>
                          {data.joinApplicantOptions.map((option) => (
                            <option key={option.groupId} value={option.groupId}>{option.group.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="field-label">Rationale</span>
                        <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this collective join?" />
                      </label>
                      <SubmitButton variant="secondary">Open join proposal</SubmitButton>
                    </FormWithNotice>
                  ) : (
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      There are no other collectives on this node to invite.
                    </p>
                  )
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    You need active participation in a member collective to initiate an invitation.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Propose departure</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Voluntary departure is decided solely by the departing collective&apos;s own governance — the coalition
                  cannot prevent or delay it.
                </p>
                {data.departureOptions.length > 0 ? (
                  <FormWithNotice action={departCoalitionAction} className="mt-3 space-y-3">
                    <input type="hidden" name="coalitionId" value={coalitionId} />
                    <label className="block">
                      <span className="field-label">Departing collective</span>
                      <select name="departingGroupId" required className="field-input">
                        <option value="">Select a collective&hellip;</option>
                        {data.departureOptions.map((option) => (
                          <option key={option.groupId} value={option.groupId}>{option.groupName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Rationale</span>
                      <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why is this collective departing?" />
                    </label>
                    <SubmitButton variant="secondary">Open departure proposal</SubmitButton>
                  </FormWithNotice>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    You don&apos;t hold active participation in any member collective.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Propose removal of a member collective</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Removal acts on another collective rather than expressing one&apos;s own will — the targeted collective does not
                  participate; every remaining member collective must consent.
                </p>
                {data.removalOptions.length > 0 ? (
                  <FormWithNotice action={removeCoalitionMemberAction} className="mt-3 space-y-3">
                    <input type="hidden" name="coalitionId" value={coalitionId} />
                    <label className="block">
                      <span className="field-label">Collective to remove</span>
                      <select name="targetGroupId" required className="field-input">
                        <option value="">Select a collective&hellip;</option>
                        {data.removalOptions.map((option) => (
                          <option key={option.groupId} value={option.groupId}>{option.groupName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Rationale</span>
                      <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this collective be removed?" />
                    </label>
                    <SubmitButton variant="secondary">Open removal proposal</SubmitButton>
                  </FormWithNotice>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    You need active participation in a remaining member collective to initiate removal.
                  </p>
                )}
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="proposals"
            title="Coalition Proposals"
            eyebrow="Active joint proposals"
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
                      {proposal.petitions.length} participating collective {proposal.petitions.length === 1 ? "petition" : "petitions"}
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
          include: {
            group: { select: { id: true, name: true } },
            federatedGroupPresence: {
              select: { name: true, status: true, federatedNode: { select: { domain: true } } },
            },
          },
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

    // Local member groups only: cross-node members (null groupId, F3) are
    // never sponsors of LOCAL bundle petitions through this page.
    const currentGroupIds = coalition.memberships.flatMap((membership) =>
      membership.groupId ? [membership.groupId] : [],
    );

    // One active member-group participant may initiate a bundle; every affected
    // group still decides through its own petition.
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
    const canSponsorCurrentMember = myCurrentMemberMemberships.length > 0;

    const localMembers = coalition.memberships.flatMap((m) =>
      m.groupId && m.group ? [{ groupId: m.groupId, groupName: m.group.name }] : [],
    );
    const departureOptions = localMembers.filter((member) => myMembershipIdByGroupId.has(member.groupId));

    const removalOptions = localMembers.filter((target) =>
      currentGroupIds.some((id) => id !== target.groupId && myMembershipIdByGroupId.has(id)),
    );

    // Offer only groups the acting member can already legitimately see (public, or private
    // groups they belong to). Private groups are never shown to non-members, so this is not a
    // discovery directory; a shared member bridges private–private coalitions from within a
    // group they belong to. (isPrivate = !(public || actor-is-member).)
    const joinApplicantOptions = canSponsorCurrentMember
      ? (await listNodeGroupLabelsForAccount(prisma, coalition.nodeId, accountId))
          .filter((group) => !currentGroupIds.includes(group.id) && !group.isPrivate)
          .map((group) => ({ groupId: group.id, group: { name: group.label } }))
      : [];

    // Continuity (F3.5 Phase 5): authority forces read-only during failover;
    // the card shows the current backup and the designation/withdrawal doors.
    const continuityAuthority = await resolveWriteAuthority(prisma, { entityType: "coalition", entityId: coalitionId });
    const backup = await prisma.entityBackup.findUnique({
      where: { entityType_entityId: { entityType: "coalition", entityId: coalitionId } },
      include: { peer: { select: { domain: true, displayName: true } } },
    });
    const activePeers = await prisma.federatedNode.findMany({
      where: { status: "active" },
      select: { id: true, domain: true, displayName: true },
      orderBy: { domain: "asc" },
    });
    const openBackupProposal = await prisma.coalitionProposal.findFirst({
      where: { coalitionId, action: "backup_designation", status: "open" },
      select: { id: true },
    });

    const canWrite = myCurrentMemberMemberships.length > 0 && continuityAuthority === "writable";

    return {
      coalition,
      discussionThreads,
      selectedThread,
      discussionMessages,
      canWrite,
      departureOptions,
      removalOptions,
      canSponsorCurrentMember,
      joinApplicantOptions,
      continuityAuthority,
      continuity: {
        backup: backup
          ? {
              peerLabel: backup.peer.displayName ?? backup.peer.domain,
              peerDomain: backup.peer.domain,
              status: backup.status,
              windowHours: backup.windowHours,
              directive: backup.directive,
              lastReplicatedAt: backup.lastReplicatedAt,
            }
          : null,
        activePeers,
        hasOpenProposal: Boolean(openBackupProposal),
        withdrawOptions: localMembers.filter((member) => myMembershipIdByGroupId.has(member.groupId)),
        myMembershipIdByGroupId: Object.fromEntries(myMembershipIdByGroupId),
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function proposeCoalitionBackupDesignationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const peerNodeId = requiredString(formData, "peerNodeId");
  const windowHours = Number.parseInt(requiredString(formData, "windowHours"), 10);
  const directive = requiredString(formData, "directive");
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findFirst({
      where: {
        accountId: session.accountId,
        status: "active",
        participationStatus: "active",
        group: { coalitionMemberships: { some: { coalitionId, endedAt: null } } },
      },
      select: { id: true },
    });
    if (!membership) return { kind: "error", message: "Active membership in a member collective is required." };
    const result = await openCoalitionBackupDesignationProposal(prisma, {
      coalitionId,
      peerNodeId,
      windowHours,
      directive,
      createdByMembershipId: membership.id,
    });
    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_window: "The failover window must be at least 1 hour.",
        invalid_directive: "Choose a valid directive.",
        no_active_agreement: "Every member node needs an active federation agreement path — one is missing or lapsed.",
        backup_already_exists: "This coalition already has a backup designated.",
        proposal_already_open: "A designation proposal is already being decided.",
        not_eligible: "An active member of a member collective must open this.",
        not_found: "This coalition could not be found.",
      };
      return { kind: "error", message: messages[result.reason] ?? "The designation proposal could not be opened." };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Designation proposal opened — every member collective now decides through its own governance." };
}

async function withdrawCoalitionBackupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const groupId = requiredString(formData, "groupId");
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findFirst({
      where: { accountId: session.accountId, groupId, status: "active", participationStatus: "active" },
      select: { id: true },
    });
    if (!membership) return { kind: "error", message: "Active membership in that collective is required." };
    const result = await proposeCoalitionBackupWithdrawal(prisma, {
      coalitionId,
      groupId,
      createdByMembershipId: membership.id,
    });
    if (!result.ok) {
      return {
        kind: "error",
        message:
          result.reason === "petition_already_open"
            ? "A withdrawal petition is already open in that collective."
            : "The withdrawal petition could not be opened.",
      };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Withdrawal petition opened in your collective — its approval alone revokes the backup." };
}

async function createDiscussionThreadAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const coalitionId = requiredString(formData, "coalitionId");
  const title = requiredString(formData, "title");
  const prisma = createPrismaClient();
  try {
    await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
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
    await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
    const message = await postCoalitionDiscussionMessage(prisma, {
      coalitionId,
      threadId,
      accountId: session.accountId,
      body,
    });
    // Hub relay (A4): a locally-posted coalition message reaches remote
    // member nodes via the home's broadcast. No-op for local-only coalitions.
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { node: { select: { id: true, domain: true } } },
    });
    const author = await prisma.account.findUnique({
      where: { id: session.accountId },
      select: { displayName: true },
    });
    if (coalition) {
      await broadcastCoalitionMessage(prisma, coalition.node, {
        coalitionId,
        messageId: message.id,
        originDomain: coalition.node.domain,
        authorLabel: author?.displayName ?? "member",
        body: message.body,
        postedAt: message.createdAt,
      });
    }
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
    await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    // Local member groups only: cross-node members (null groupId, F3) are
    // never sponsors of LOCAL bundle petitions through this page.
    const currentGroupIds = coalition.memberships.flatMap((membership) =>
      membership.groupId ? [membership.groupId] : [],
    );

    const myMemberships = await prisma.groupMembership.findMany({
      where: {
        accountId: session.accountId,
        status: "active",
        participationStatus: "active",
        groupId: { in: currentGroupIds },
      },
      select: { id: true, groupId: true },
    });
    const myMembershipByGroupId = new Map(myMemberships.map((m) => [m.groupId, m]));
    if (myMemberships.length === 0) {
      return { kind: "error", message: "You must hold active participation in a current member collective." };
    }

    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: { groupId: applicantGroupId },
      memberSponsors: currentGroupIds.map((groupId) => ({
        groupId,
        createdByMembershipId: myMembershipByGroupId.get(groupId)?.id,
      })),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Join proposal opened — the applicant and every current member collective will decide through their own petition." };
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
    await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId: departingGroupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      return { kind: "error", message: "You must hold active participation in the departing collective to sponsor this proposal." };
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
  return { kind: "success", message: "Departure proposal opened — the departing collective will decide through its own petition." };
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
    await requireCoalitionWritable(prisma, coalitionId); // continuity gate (register F-9)
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      select: { memberships: { where: { endedAt: null }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    // Local member groups only: cross-node members (null groupId, F3) are
    // never sponsors of LOCAL bundle petitions through this page.
    const currentGroupIds = coalition.memberships.flatMap((membership) =>
      membership.groupId ? [membership.groupId] : [],
    );
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
    if (remainingMemberships.length === 0) {
      return { kind: "error", message: "You must hold active participation in a remaining member collective to sponsor this proposal." };
    }
    const membershipByGroupId = new Map(remainingMemberships.map((membership) => [membership.groupId, membership.id]));

    const result = await openCoalitionRemovalProposal(prisma, {
      coalitionId,
      targetGroupId,
      remainingSponsors: remainingGroupIds.map((groupId) => ({
        groupId,
        createdByMembershipId: membershipByGroupId.get(groupId),
      })),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/${coalitionId}`);
  return { kind: "success", message: "Removal proposal opened — every remaining member collective will decide through its own petition." };
}

function coalitionProposalFailureMessage(reason: string) {
  switch (reason) {
    case "invalid_participants": return "Select at least two distinct, eligible groups on the same node.";
    case "not_eligible": return "Every sponsoring group requires an active, active-participation member to consent.";
    case "not_found": return "This coalition could not be found.";
    case "already_member": return "That collective already belongs to this coalition.";
    case "not_member": return "That collective is not currently a member of this coalition.";
    case "duplicate_name": return "A coalition with that name already exists on this node.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
}
