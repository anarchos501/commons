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
import { pinPeer } from "../../../lib/federation-peers";
import {
  openFederationDepartureProposal,
  openFederationFormationProposal,
} from "../../../lib/federations";
import {
  proposeFederationDisable,
  proposeFederationPolicyChange,
  proposeFederationTermination,
} from "../../../lib/federation-policy";
import { requireActiveNodeUser } from "../../../lib/node-governance";
import { proposeRegistrationModeChange } from "../../../lib/node-registration-mode";

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
              {/* register F-5: the mandate is legible where the role is displayed and where it is granted. */}
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                The steward collective holds this node&apos;s federation authority: it decides, through its own
                visible petitions, which other Commons nodes this node federates with. Node-wide votes can
                always end an agreement or disable federation, and the steward collective is recallable.
              </p>
              {!data.steward && (
                <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">
                  This node cannot federate: no steward collective is appointed. There is no body to
                  receive or propose federation agreements, so other nodes see an honest
                  &ldquo;federation unavailable&rdquo; rather than a silent timeout. Appointing a steward
                  collective (below) is what makes federation possible.
                </p>
              )}
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
              {data.participationStatus === "active" && (
                <form action={registrationModeAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <p className="text-sm text-[var(--soft-text)]">
                    Registration mode: <span className="font-medium capitalize">{data.registrationMode.replace("_", "-")}</span>.
                    Who may join the node is constitutional — changing it is a node-wide vote.
                    {data.registrationMode === "invite_only" ? " (Invite gating itself ships with the email workstream; until then this label is aspirational.)" : ""}
                  </p>
                  <label className="block">
                    <span className="field-label">Propose mode</span>
                    <select name="target" className="field-input" defaultValue={data.registrationMode === "open" ? "invite_only" : "open"}>
                      <option value="open">open</option>
                      <option value="invite_only">invite-only</option>
                    </select>
                  </label>
                  <SubmitButton variant="secondary">Open registration-mode vote</SubmitButton>
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

          <CollapsibleSection id="federation" title="Federation" eyebrow="Between nodes" storageKey="node:section:federation" className="bg-[var(--surface)] p-5 sm:p-6">
            <p className="text-xs leading-5 text-[var(--muted)]">
              Federation is a relationship between communities, decided by mutual consent: both nodes&apos;
              steward collectives must approve. An agreement by itself exposes nothing — every collective
              stays closed toward a peer node until it opens itself by its own petition. Any member can
              petition node-wide to end an agreement or disable federation entirely.
            </p>
            <p className="mt-2 text-xs text-[var(--soft-text)]">
              Policy: <span className="font-medium text-[var(--text)]">{data.federation.policy}</span>
              {!data.steward && <span> · Not federable: no steward collective is appointed.</span>}
            </p>

            {data.federation.agreements.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Agreements</p>
                {data.federation.agreements.map((agreement) => (
                  <div key={agreement.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{agreement.name}</p>
                      <span className="text-xs capitalize text-[var(--muted)]">{agreement.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">Peer: {agreement.peerDomains.join(", ") || "—"}</p>
                    {agreement.status === "active" && data.participationStatus === "active" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={departFederationAction}>
                          <input type="hidden" name="nodeId" value={data.node.id} />
                          <input type="hidden" name="federationId" value={agreement.id} />
                          <SubmitButton variant="secondary">Ask stewards to leave</SubmitButton>
                        </form>
                        <form action={terminateFederationAction}>
                          <input type="hidden" name="nodeId" value={data.node.id} />
                          <input type="hidden" name="federationId" value={agreement.id} />
                          <SubmitButton variant="secondary">Open node-wide vote to end</SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {data.federation.proposals.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Proposals</p>
                {data.federation.proposals.map((proposal) => (
                  <div key={proposal.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium capitalize text-[var(--text)]">{proposal.action}</p>
                      <span className="text-xs capitalize text-[var(--muted)]">{proposal.status.replaceAll("-", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {proposal.decisionSummary} · initiated by {proposal.initiatedByDomain} · closes {proposal.closesAt}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {data.federation.myPresences.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your presences</p>
                {data.federation.myPresences.map((presence) => (
                  <p key={presence.id} className="text-xs text-[var(--soft-text)]">
                    Your identity is vouched to <span className="font-medium text-[var(--text)]">{presence.nodeLabel}</span>{" "}
                    ({presence.nodeDomain}) · <span className="capitalize">{presence.status}</span>
                  </p>
                ))}
              </div>
            )}

            {data.federation.hostedPresences.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Visiting presences</p>
                <p className="text-xs text-[var(--muted)]">
                  People from federated nodes whose home node vouches for them here. A presence carries no
                  password and no local authority — this node&apos;s own rules decide anything they may do.
                </p>
                {data.federation.hostedPresences.map((presence) => (
                  <p key={presence.id} className="text-xs text-[var(--soft-text)]">
                    <span className="font-medium text-[var(--text)]">{presence.label}</span>
                    {presence.homeNodeDomain ? ` from ${presence.homeNodeDomain}` : ""} ·{" "}
                    <span className="capitalize">{presence.status}</span>
                    {presence.lastSeenAt ? ` · seen ${presence.lastSeenAt}` : ""}
                  </p>
                ))}
              </div>
            )}

            {data.federation.peers.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Known nodes</p>
                {data.federation.peers.map((peer) => (
                  <div key={peer.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] p-2">
                    <span className="text-sm text-[var(--text)]">{peer.displayName ?? peer.domain}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {peer.domain} · key …{peer.keyFingerprint} · <span className="capitalize">{peer.status}</span>
                      {peer.lastSeenAt ? ` · seen ${peer.lastSeenAt.slice(0, 10)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {data.participationStatus === "active" && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <form action={pinPeerAction} className="space-y-3 border border-[var(--border)] p-3">
                  <input type="hidden" name="nodeId" value={data.node.id} />
                  <label className="block">
                    <span className="field-label">Look up a node</span>
                    <input name="address" type="text" required className="field-input" placeholder="commons.example.org" />
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      Fetches the node&apos;s identity and pins its signing key. Pinning alone grants nothing.
                    </span>
                  </label>
                  <SubmitButton variant="secondary">Look up &amp; pin</SubmitButton>
                </form>
                {data.steward && data.federation.policy !== "disabled" && (
                  <form action={proposeFederationAction} className="space-y-3 border border-[var(--border)] p-3">
                    <input type="hidden" name="nodeId" value={data.node.id} />
                    <label className="block">
                      <span className="field-label">Propose federation with</span>
                      <select name="peerDomain" className="field-input" required>
                        {data.federation.peers
                          .filter((peer) => peer.status === "proposed" || peer.status === "active")
                          .map((peer) => (
                            <option key={peer.id} value={peer.domain}>{peer.displayName ?? peer.domain}</option>
                          ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Why federate?</span>
                      <textarea name="content" required rows={2} className="field-input" />
                    </label>
                    <p className="text-xs text-[var(--muted)]">
                      Opens a petition before this node&apos;s steward collective; the peer&apos;s stewards decide
                      independently. Both must approve.
                    </p>
                    <SubmitButton variant="secondary">Request federation</SubmitButton>
                  </form>
                )}
                {data.federation.isStewardMember && (
                  <form action={federationPolicyAction} className="space-y-3 border border-[var(--border)] p-3">
                    <input type="hidden" name="nodeId" value={data.node.id} />
                    <label className="block">
                      <span className="field-label">Propose federation policy (steward collective)</span>
                      <select name="target" className="field-input" required defaultValue="allowlisted">
                        {["open", "allowlisted", "project_level", "read_only", "emergency_only", "disabled"].map((policy) => (
                          <option key={policy} value={policy}>{policy}</option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton variant="secondary">Open policy petition</SubmitButton>
                  </form>
                )}
                {data.federation.policy !== "disabled" && (
                  <form action={disableFederationAction} className="space-y-3 border border-[var(--border)] p-3">
                    <input type="hidden" name="nodeId" value={data.node.id} />
                    <p className="text-sm text-[var(--soft-text)]">
                      Ask the whole node whether to disable federation entirely. Ends every agreement.
                    </p>
                    <SubmitButton variant="secondary">Open node-wide disable vote</SubmitButton>
                  </form>
                )}
              </div>
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
                    {/* register F-5: a voter must see what the vote confers, on the card itself. */}
                    {petition.subjectType === "node_steward_appointment" && (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Approving appoints the candidate as steward collective — including federation
                        authority: deciding which other nodes this node federates with.
                      </p>
                    )}
                    {petition.subjectType === "node_steward_no_confidence" && (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Approving removes the steward collective. Federation authority is vacated — the
                        node cannot enter new agreements until a new steward is appointed.
                      </p>
                    )}
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
      select: { id: true, name: true, stewardGroupId: true, domain: true, federationPolicy: true, registrationMode: true },
    });
    const [peers, federations, federationProposals, hostedPresences, myPresences] = await Promise.all([
      prisma.federatedNode.findMany({
        select: { id: true, domain: true, displayName: true, status: true, lastSeenAt: true, publicKey: true },
        orderBy: { pinnedAt: "asc" },
        take: 50,
      }),
      prisma.federation.findMany({
        where: { memberships: { some: { isSelf: true } } },
        select: {
          id: true,
          name: true,
          status: true,
          memberships: { where: { endedAt: null }, select: { memberDomain: true, isSelf: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.federationProposal.findMany({
        select: {
          id: true,
          action: true,
          status: true,
          initiatedByDomain: true,
          participantSnapshot: true,
          decisions: true,
          closesAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      // Presences hosted HERE: remote people this node's communities can see.
      prisma.linkedNodePresence.findMany({
        where: { nodeId: node.id },
        select: { id: true, handle: true, displayName: true, homeNodeDomain: true, status: true, lastSeenAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // This account's own presences on peer nodes (the home-side mirror).
      prisma.linkedNodePresence.findMany({
        where: { portableIdentity: { accounts: { some: { id: accountId } } }, nodeId: { not: node.id } },
        select: { id: true, status: true, node: { select: { domain: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
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
      registrationMode: nodeWithSteward.registrationMode,
      federation: {
        policy: nodeWithSteward.federationPolicy,
        peers: peers.map((peer) => ({
          id: peer.id,
          domain: peer.domain,
          displayName: peer.displayName,
          status: peer.status,
          lastSeenAt: peer.lastSeenAt?.toISOString() ?? null,
          keyFingerprint: peer.publicKey.replace(/-----[^-]+-----|\s/g, "").slice(-16),
        })),
        agreements: federations.map((federation) => ({
          id: federation.id,
          name: federation.name,
          status: federation.status,
          peerDomains: federation.memberships.filter((m) => !m.isSelf).map((m) => m.memberDomain),
        })),
        proposals: federationProposals.map((proposal) => {
          const snapshot = proposal.participantSnapshot as { domains?: string[] } | null;
          const decisions = (proposal.decisions ?? {}) as Record<string, string>;
          return {
            id: proposal.id,
            action: proposal.action,
            status: proposal.status,
            initiatedByDomain: proposal.initiatedByDomain,
            decisionSummary: (snapshot?.domains ?? [])
              .map((domain) => `${domain}: ${decisions[domain] ?? "pending"}`)
              .join(" · "),
            closesAt: proposal.closesAt.toISOString().slice(0, 10),
          };
        }),
        isStewardMember: Boolean(
          nodeWithSteward.stewardGroupId &&
            memberships.some(
              (membership) =>
                membership.groupId === nodeWithSteward.stewardGroupId &&
                membership.participationStatus === "active",
            ),
        ),
        hostedPresences: hostedPresences.map((presence) => ({
          id: presence.id,
          label: presence.displayName ?? presence.handle,
          homeNodeDomain: presence.homeNodeDomain,
          status: presence.status,
          lastSeenAt: presence.lastSeenAt?.toISOString().slice(0, 10) ?? null,
        })),
        myPresences: myPresences.map((presence) => ({
          id: presence.id,
          nodeLabel: presence.node.name,
          nodeDomain: presence.node.domain,
          status: presence.status,
        })),
      },
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

async function pinPeerAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const address = requiredString(formData, "address");
  const prisma = createPrismaClient();
  try {
    await requireActiveNodeUser(prisma, nodeId, session.accountId);
    await pinPeer(prisma, address);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function proposeFederationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const peerDomain = requiredString(formData, "peerDomain");
  const content = requiredString(formData, "content");
  const prisma = createPrismaClient();
  try {
    await openFederationFormationProposal(prisma, {
      nodeId,
      peerDomain,
      content,
      requestedByAccountId: session.accountId,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function departFederationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const federationId = requiredString(formData, "federationId");
  const prisma = createPrismaClient();
  try {
    await openFederationDepartureProposal(prisma, {
      nodeId,
      federationId,
      content: "Departure requested from the node governance page.",
      requestedByAccountId: session.accountId,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function terminateFederationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const federationId = requiredString(formData, "federationId");
  const prisma = createPrismaClient();
  try {
    await proposeFederationTermination(prisma, { nodeId, federationId, requestedByAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function disableFederationAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const prisma = createPrismaClient();
  try {
    await proposeFederationDisable(prisma, { nodeId, requestedByAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function federationPolicyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const target = requiredString(formData, "target");
  const prisma = createPrismaClient();
  try {
    const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { stewardGroupId: true } });
    if (node?.stewardGroupId) {
      const membershipId = await activeMembershipForGroup(session.accountId, node.stewardGroupId);
      await proposeFederationPolicyChange(prisma, { nodeId, target, createdByMembershipId: membershipId });
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
}

async function registrationModeAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const nodeId = requiredString(formData, "nodeId");
  const target = requiredString(formData, "target");
  const prisma = createPrismaClient();
  try {
    await proposeRegistrationModeChange(prisma, { nodeId, target, requestedByAccountId: session.accountId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath("/node");
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
