import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlphaNotice, Notice } from "../../../components/shared/Notice";
import { CollapsibleSection } from "../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../components/shared/EmptyState";
import { SubmitButton } from "../../../components/shared/SubmitButton";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import { resolveCurrentNode } from "../../../lib/node-context";
import { requiredString } from "../../../lib/support-form";
import {
  activeNodeHostExists,
  getNodeGovernanceEligibility,
  getNodeParticipationStatus,
  upsertNodeGovernanceSignal,
} from "../../../lib/node-governance";
import { governanceCategoryDescription } from "../../../lib/governance-categories";
import {
  openGroupNoConfidence,
  openGroupStewardNomination,
  openHostNoConfidence,
  openHostStewardNomination,
  openStewardResignation,
} from "../../../lib/node-stewardship";
import { addNodePetitionSupport, withdrawNodePetitionSupport } from "../../../lib/petitions";
import { evaluateAndApplyPetition, proposalFamilyLabel } from "../../../lib/petition-evaluation";
import { listNodeGroupLabelsForAccount, labelNodeGroupForAccount } from "../../../lib/node-privacy";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NodePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const data = await getNodePageData(session.accountId);

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <AlphaNotice />
        {notice && <div className="mt-4"><Notice message={notice} /></div>}
        <div className="mt-4 flex flex-col divide-y divide-[var(--border)] border border-[var(--border)]">
          <div className="bg-[var(--surface)] p-5 sm:p-6">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Node governance</span>
            <h1 className="mt-1 text-2xl font-bold text-[var(--text)]">{data.node.name}</h1>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
              <span>{data.activeVoterCount} active node {data.activeVoterCount === 1 ? "user" : "users"}</span>
              {data.participationStatus && <span className="capitalize">You: {data.participationStatus}</span>}
              {data.isHost && <span>Node host</span>}
            </div>
            <div className="mt-4 border-l-2 border-[var(--accent)] pl-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Current steward</p>
              <p className="mt-1 text-sm text-[var(--soft-text)]">{data.steward?.label ?? "No steward group"}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                The server operator controls host status. Community governance appoints or removes only the steward collective.
              </p>
            </div>
          </div>

          <CollapsibleSection id="actions" title="Actions" eyebrow="Questions, not outcomes" storageKey="node:section:actions" className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              {data.isHost && !data.steward && (
                <form action={hostNominateAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <label className="block">
                    <span className="field-label">Nominate steward group</span>
                    <select name="candidateGroupId" className="field-input" required>
                      {data.groupOptions.filter((group) => !group.isPrivate).map((group) => (
                        <option key={group.id} value={group.id}>{group.label}</option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton variant="secondary">Nominate as host</SubmitButton>
                </form>
              )}
              {!data.steward && data.myGroups.length > 0 && (
                <form action={groupNominateAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <label className="block">
                    <span className="field-label">Nominating group</span>
                    <select name="initiatingGroupId" className="field-input" required>
                      {data.myGroups.map((group) => (
                        <option key={group.groupId} value={group.groupId}>{group.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Candidate group</span>
                    <select name="candidateGroupId" className="field-input" required>
                      {data.groupOptions.filter((group) => !group.isPrivate).map((group) => (
                        <option key={group.id} value={group.id}>{group.label}</option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton variant="secondary">Open group nomination</SubmitButton>
                </form>
              )}
              {data.steward && data.isHost && (
                <form action={hostNoConfidenceAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <p className="text-sm text-[var(--soft-text)]">
                    Ask the node whether to remove the current steward collective. This does not affect the node host or create an interim removal.
                  </p>
                  <SubmitButton variant="secondary">Open steward no-confidence question</SubmitButton>
                </form>
              )}
              {data.steward && data.myGroups.length > 0 && (
                <form action={groupNoConfidenceAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <label className="block">
                    <span className="field-label">Initiating group</span>
                    <select name="initiatingGroupId" className="field-input" required>
                      {data.myGroups.map((group) => (
                        <option key={group.groupId} value={group.groupId}>{group.label}</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-[var(--soft-text)]">
                    Ask this collective whether to initiate a node-wide vote to remove the current steward collective.
                  </p>
                  <SubmitButton variant="secondary">Open steward no-confidence initiation</SubmitButton>
                </form>
              )}
              {data.canResignSteward && (
                <form action={resignStewardAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <p className="text-sm text-[var(--soft-text)]">Ask the current steward group to resign.</p>
                  <SubmitButton variant="secondary">Open resignation petition</SubmitButton>
                </form>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="proposals" title="Steward Proposals" eyebrow="Lifecycle" storageKey="node:section:proposals" className="bg-[var(--surface)] p-5 sm:p-6">
            {data.proposals.length > 0 ? (
              <div className="space-y-3">
                {data.proposals.map((proposal) => (
                  <div key={proposal.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium capitalize text-[var(--text)]">
                        {proposal.action.replaceAll("_", " ")}: {proposal.candidateLabel}
                      </p>
                      <span className="text-xs capitalize text-[var(--muted)]">
                        {proposal.status.replaceAll("-", " ").replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Origin: {proposal.origin}
                      {proposal.initiatingLabel ? ` · Initiated through ${proposal.initiatingLabel}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No steward proposals are currently visible." />
            )}
          </CollapsibleSection>

          <CollapsibleSection id="petitions" title="Node Petitions" eyebrow="One account, one vote" storageKey="node:section:petitions" className="bg-[var(--surface)] p-5 sm:p-6">
            {data.nodePetitions.length > 0 ? (
              <div className="space-y-3">
                {data.nodePetitions.map((petition) => (
                  <div key={petition.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{proposalFamilyLabel(petition.subjectType)}</p>
                      <span className="text-xs capitalize text-[var(--muted)]">{petition.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{petition.supportCount} support</p>
                    {petition.status === "open" && data.participationStatus === "active" && (
                      petition.supportedByCurrentAccount ? (
                        <form action={withdrawNodeSupportAction} className="mt-3">
                          <input type="hidden" name="petitionId" value={petition.id} />
                          <SubmitButton variant="secondary">Withdraw support</SubmitButton>
                        </form>
                      ) : (
                        <form action={supportNodePetitionAction} className="mt-3">
                          <input type="hidden" name="petitionId" value={petition.id} />
                          <SubmitButton variant="secondary">Support</SubmitButton>
                        </form>
                      )
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No node petitions are currently visible." />
            )}
          </CollapsibleSection>

          <CollapsibleSection id="signals" title="Governance Signal" eyebrow="Node stewardship temperature" storageKey="node:section:signals" className="bg-[var(--surface)] p-5 sm:p-6">
            <p className="mb-4 text-xs leading-5 text-[var(--soft-text)]">
              {governanceCategoryDescription("node_stewardship")}
            </p>
            {data.participationStatus === "active" || data.participationStatus === "quiet" ? (
              <form action={nodeSignalAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="nodeId" value={data.node.id} />
                {[-1, 0, 1].map((value) => (
                  <button
                    key={value}
                    name="signal"
                    value={value}
                    type="submit"
                    className={`border px-3 py-2 text-sm ${data.currentSignal === value ? "border-[var(--accent)] bg-[var(--subtle)] text-[var(--text)]" : "border-[var(--border)] text-[var(--soft-text)]"}`}
                  >
                    {value === -1 ? "Careful" : value === 1 ? "Permissive" : "Neutral"}
                  </button>
                ))}
              </form>
            ) : (
              <EmptyState text="Active or quiet node participation is required to signal." />
            )}
          </CollapsibleSection>
        </div>
      </div>
    </main>
  );
}

async function getNodePageData(accountId: string) {
  const prisma = createPrismaClient();
  try {
    const node = await resolveCurrentNode(prisma);
    if (!node) redirect("/dashboard");
    const [participationStatus, isHost, eligibility, groupOptions, currentSignal] = await Promise.all([
      getNodeParticipationStatus(prisma, node.id, accountId),
      activeNodeHostExists(prisma, node.id, accountId),
      getNodeGovernanceEligibility(prisma, node.id),
      listNodeGroupLabelsForAccount(prisma, node.id, accountId),
      prisma.nodeGovernanceSignal.findUnique({
        where: { accountId_nodeId_category_parameter: { accountId, nodeId: node.id, category: "node_stewardship", parameter: "_" } },
        select: { signal: true },
      }),
    ]);
    if (!participationStatus && !isHost) redirect("/dashboard");
    const nodeWithSteward = await prisma.node.findUniqueOrThrow({
      where: { id: node.id },
      select: { id: true, name: true, stewardGroupId: true },
    });
    const [steward, memberships, proposals, nodePetitions] = await Promise.all([
      labelNodeGroupForAccount(prisma, nodeWithSteward.stewardGroupId, accountId),
      prisma.groupMembership.findMany({
        where: { accountId, status: "active", group: { nodeId: node.id } },
        select: { id: true, groupId: true, participationStatus: true, group: { select: { name: true } } },
        orderBy: { joinedAt: "asc" },
      }),
      prisma.nodeStewardProposal.findMany({
        where: { nodeId: node.id },
        select: {
          id: true,
          action: true,
          origin: true,
          status: true,
          candidateGroupId: true,
          initiatingGroupId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.petition.findMany({
        where: { scopeType: "node", scopeId: node.id, archivedAt: null },
        include: {
          nodeSupport: { where: { accountId }, select: { id: true }, take: 1 },
          _count: { select: { nodeSupport: true } },
        },
        orderBy: [{ status: "asc" }, { opensAt: "desc" }],
        take: 20,
      }),
    ]);
    const optionById = new Map(groupOptions.map((group) => [group.id, group]));
    return {
      node: nodeWithSteward,
      steward,
      isHost,
      participationStatus,
      activeVoterCount: eligibility.filter((entry) => entry.participationStatus === "active").length,
      groupOptions,
      myGroups: memberships.map((membership) => ({
        membershipId: membership.id,
        groupId: membership.groupId,
        label: optionById.get(membership.groupId)?.label ?? membership.group.name,
      })),
      canResignSteward: Boolean(steward && memberships.some((membership) => membership.groupId === steward.id && membership.participationStatus === "active")),
      proposals: proposals.map((proposal) => ({
        id: proposal.id,
        action: proposal.action,
        origin: proposal.origin,
        status: proposal.status,
        candidateLabel: optionById.get(proposal.candidateGroupId)?.label ?? "Private group",
        initiatingLabel: proposal.initiatingGroupId
          ? optionById.get(proposal.initiatingGroupId)?.label ?? "Private group"
          : null,
      })),
      nodePetitions: nodePetitions.map((petition) => ({
        id: petition.id,
        subjectType: petition.subjectType,
        status: petition.status,
        supportCount: petition._count.nodeSupport,
        supportedByCurrentAccount: petition.nodeSupport.length > 0,
      })),
      currentSignal: currentSignal?.signal ?? 0,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function activeMembershipForGroup(accountId: string, groupId: string) {
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
      select: { id: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      throw new Error("Active group membership required.");
    }
    return membership.id;
  } finally {
    await prisma.$disconnect();
  }
}

async function hostNominateAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const candidateGroupId = requiredString(formData, "candidateGroupId");
  const prisma = createPrismaClient();
  try {
    await openHostStewardNomination(prisma, { nodeId, candidateGroupId, hostAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function groupNominateAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const initiatingGroupId = requiredString(formData, "initiatingGroupId");
  const candidateGroupId = requiredString(formData, "candidateGroupId");
  const membershipId = await activeMembershipForGroup(session.accountId, initiatingGroupId);
  const prisma = createPrismaClient();
  try {
    await openGroupStewardNomination(prisma, { nodeId, initiatingGroupId, candidateGroupId, createdByMembershipId: membershipId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function hostNoConfidenceAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const prisma = createPrismaClient();
  try {
    await openHostNoConfidence(prisma, { nodeId, hostAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function groupNoConfidenceAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const initiatingGroupId = requiredString(formData, "initiatingGroupId");
  const membershipId = await activeMembershipForGroup(session.accountId, initiatingGroupId);
  const prisma = createPrismaClient();
  try {
    await openGroupNoConfidence(prisma, { nodeId, initiatingGroupId, createdByMembershipId: membershipId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function resignStewardAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const prisma = createPrismaClient();
  try {
    const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId }, select: { stewardGroupId: true } });
    if (!node.stewardGroupId) return;
    const membershipId = await activeMembershipForGroup(session.accountId, node.stewardGroupId);
    await openStewardResignation(prisma, { nodeId, createdByMembershipId: membershipId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function supportNodePetitionAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    await addNodePetitionSupport(prisma, { petitionId, accountId: session.accountId });
    await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function withdrawNodeSupportAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const petitionId = requiredString(formData, "petitionId");
  const prisma = createPrismaClient();
  try {
    await withdrawNodePetitionSupport(prisma, { petitionId, accountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function nodeSignalAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const signal = Number(formData.get("signal"));
  const prisma = createPrismaClient();
  try {
    await upsertNodeGovernanceSignal(prisma, {
      nodeId,
      accountId: session.accountId,
      category: "node_stewardship",
      signal,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}
