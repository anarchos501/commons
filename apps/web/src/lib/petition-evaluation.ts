import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { evaluatePetition, evaluateEmergencyPetition, type EvaluateResult } from "./petitions";
import {
  onRevisionPetitionApproved,
  onLivingDocumentArchivalPetitionApproved,
} from "./living-documents";
import { onThreadClosurePetitionApproved } from "./discussions";
import { confirmResponsibilityAssignment, applyResponsibilityRecallFromPetition } from "./responsibilities";
import {
  createContributionCategoryFromPetition,
  archiveContributionCategoryFromPetition,
} from "./contribution-categories";
import {
  grantTrustedProviderStatusFromPetition,
  revokeTrustedProviderStatusFromPetition,
} from "./trusted-providers";
import { approveMembershipRequest } from "./group-membership";
import { onEmergencyPetitionApproved } from "./emergency";
import { applyGroupVisibilityFromPetition, applyCustomRequestsToggleFromPetition, applyMembershipPolicyChangeFromPetition } from "./group-settings";
import { createProjectFromPetition } from "./projects";
import { createResponsibilityFromProposal } from "./responsibility-proposals";
import { onBulletinArchivalPetitionApproved } from "./bulletins";
import { onPublicationArchivalPetitionApproved, onPublicationEntryArchivalPetitionApproved } from "./publications";
import { applyContentCreationDraft } from "./content-creation-drafts";
import {
  evaluateProjectHostingProposalForPetition,
  onProjectHostingWithdrawalPetitionApproved,
} from "./project-hosting";
import { evaluateCoalitionProposalForPetition } from "./coalitions";
import { evaluateFederationProposalForPetition } from "./federations";
import { applyFederatedVisibilityFromPetition } from "./federated-visibility";
import { applyRegistrationModeFromPetition } from "./node-registration-mode";
import {
  applyFederationDisableFromPetition,
  applyFederationPolicyFromPetition,
  applyFederationTerminationFromPetition,
} from "./federation-policy";
import { evaluateEventProposalForPetition } from "./events";
import { evaluateNodeStewardProposalForPetition } from "./node-stewardship";
import { evaluateNodeNameProposalForPetition } from "./node-name";
import { responsibilityTypeLabel } from "./concern-reviewer";
import type { ProposalFamily } from "./governance-proposal-families";

// Must NOT be called from inside another $transaction — it opens its own.
export async function evaluateAndApplyPetition(prisma: PrismaClient, petitionId: string): Promise<EvaluateResult> {
  return prisma.$transaction(async (tx) => {
    const petition = await tx.petition.findUnique({
      where: { id: petitionId },
      select: { category: true, subjectType: true },
    });
    if (!petition) return { outcome: "pending" };

    const result =
      petition.category === "emergency" && petition.subjectType === "emergency_declaration"
        ? await evaluateEmergencyPetition(tx, petitionId)
        : await evaluatePetition(tx, petitionId);

    // Specialized proposal handlers (coalition, project-hosting, steward) must run on
    // every evaluateAndApplyPetition call — they re-evaluate the *parent proposal*, not
    // just the individual petition. A coalition petition may still be "open" (pending)
    // but the proposal fails because participant snapshot changed; a withdrawn petition
    // needs to fail the whole bundle. The generic approval handler is guarded by
    // `justResolved` so it only runs when THIS transaction changed the status.
    await applyResolvedPetition(tx, petitionId, result.outcome !== "pending");

    // Competing-petition resolution can decide a winner OTHER than petitionId.
    // That winner's status just flipped to "approved" in this same transaction,
    // so apply its resolution now — a future evaluation of the winner's id will
    // see status !== "open" and never get another chance.
    if (result.winnerId && result.winnerId !== petitionId) {
      await applyResolvedPetition(tx, result.winnerId, true);
    }

    return result;
  }, { timeout: 15_000, maxWait: 5_000 });
}

// justResolved: true when this transaction changed the petition's status; false when the
// petition was already non-open before this call (e.g. withdrawn by a prior action).
// Specialized handlers always run; generic approval dispatch only fires on justResolved.
async function applyResolvedPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
  justResolved: boolean,
): Promise<void> {
  if (await evaluateProjectHostingProposalForPetition(tx, petitionId)) return;
  if (await evaluateCoalitionProposalForPetition(tx, petitionId)) return;
  if (await evaluateFederationProposalForPetition(tx, petitionId)) return;
  if (await evaluateEventProposalForPetition(tx, petitionId)) return;
  if (await evaluateNodeStewardProposalForPetition(tx, petitionId)) return;
  if (await evaluateNodeNameProposalForPetition(tx, petitionId)) return;

  if (!justResolved) return;

  const petition = await tx.petition.findUnique({
    where: { id: petitionId },
    select: { status: true, subjectType: true, subjectId: true },
  });
  if (petition?.status === "approved") {
    await applyApprovedPetition(tx, petitionId, petition.subjectType, petition.subjectId);
  }
}

async function applyApprovedPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
  subjectType: string,
  subjectId: string,
): Promise<void> {
  if (subjectType === "membership_request") {
    await approveMembershipRequest(tx, subjectId);
  } else if (subjectType === "living_document_revision") {
    await onRevisionPetitionApproved(tx, petitionId);
  } else if (subjectType === "living_document_archive") {
    await onLivingDocumentArchivalPetitionApproved(tx, petitionId);
  } else if (subjectType === "discussion_thread_close") {
    await onThreadClosurePetitionApproved(tx, petitionId);
  } else if (subjectType === "responsibility_proposal") {
    await confirmResponsibilityAssignment(tx, petitionId);
  } else if (subjectType === "responsibility_creation_proposal") {
    await createResponsibilityFromProposal(tx, petitionId);
  } else if (subjectType === "responsibility_recall") {
    await applyResponsibilityRecallFromPetition(tx, petitionId);
  } else if (subjectType === "contribution_category_proposal") {
    await createContributionCategoryFromPetition(tx, petitionId);
  } else if (subjectType === "contribution_category_archive") {
    await archiveContributionCategoryFromPetition(tx, petitionId);
  } else if (subjectType === "trusted_provider_proposal") {
    await grantTrustedProviderStatusFromPetition(tx, petitionId);
  } else if (subjectType === "trusted_provider_revocation") {
    await revokeTrustedProviderStatusFromPetition(tx, petitionId);
  } else if (subjectType === "emergency_declaration") {
    await onEmergencyPetitionApproved(tx, petitionId);
  } else if (subjectType === "project_proposal") {
    await createProjectFromPetition(tx, petitionId);
  } else if (subjectType === "project_hosting_withdrawal") {
    await onProjectHostingWithdrawalPetitionApproved(tx, petitionId);
  } else if (subjectType === "bulletin_archive") {
    await onBulletinArchivalPetitionApproved(tx, petitionId);
  } else if (subjectType === "publication_archive") {
    await onPublicationArchivalPetitionApproved(tx, petitionId);
  } else if (subjectType === "publication_entry_archive") {
    await onPublicationEntryArchivalPetitionApproved(tx, petitionId);
  } else if (subjectType === "federation_policy_change") {
    await applyFederationPolicyFromPetition(tx, petitionId);
  } else if (subjectType === "federation_termination") {
    await applyFederationTerminationFromPetition(tx, petitionId);
  } else if (subjectType === "federation_disable") {
    await applyFederationDisableFromPetition(tx, petitionId);
  } else if (subjectType === "federated_visibility_change") {
    await applyFederatedVisibilityFromPetition(tx, petitionId);
  } else if (subjectType === "registration_mode_change") {
    await applyRegistrationModeFromPetition(tx, petitionId);
  } else if (subjectType === "group_visibility_proposal") {
    await applyGroupVisibilityFromPetition(tx, petitionId);
  } else if (subjectType === "custom_support_requests_toggle") {
    await applyCustomRequestsToggleFromPetition(tx, petitionId);
  } else if (subjectType === "membership_policy_change") {
    await applyMembershipPolicyChangeFromPetition(tx, petitionId);
  } else if (subjectType === "bulletin_creation") {
    await applyContentCreationDraft(tx, petitionId, "bulletin_creation");
  } else if (subjectType === "publication_creation") {
    await applyContentCreationDraft(tx, petitionId, "publication_creation");
  } else if (subjectType === "publication_entry_creation") {
    await applyContentCreationDraft(tx, petitionId, "publication_entry_creation");
  } else if (subjectType === "living_document_creation") {
    await applyContentCreationDraft(tx, petitionId, "living_document_creation");
  }
}

export async function resolveExpiredPetitions(
  prisma: PrismaClient,
): Promise<{ attempted: number; resolved: number; failed: number }> {
  const due = await prisma.petition.findMany({
    where: { status: "open", closesAt: { lte: new Date() } },
    select: { id: true },
  });

  let resolved = 0;
  let failed = 0;
  for (const p of due) {
    try {
      const result = await evaluateAndApplyPetition(prisma, p.id);
      if (result.outcome !== "pending") resolved++;
    } catch (err) {
      failed++;
      console.error(`[petitions] failed to evaluate petition ${p.id}`, err);
    }
  }
  return { attempted: due.length, resolved, failed };
}

// Resolves a single scope's due petitions. Called on page load so petitions
// transition purely by expiry time (no manual "check outcome" button); the 60s
// sweep in instrumentation.ts remains the unattended backstop. Per-petition
// try/catch ensures one bad petition can't break rendering the page.
async function resolveDuePetitions(prisma: PrismaClient, where: Prisma.PetitionWhereInput): Promise<void> {
  const due = await prisma.petition.findMany({
    where: { ...where, status: "open", closesAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const p of due) {
    try {
      await evaluateAndApplyPetition(prisma, p.id);
    } catch (err) {
      console.error(`[petitions] failed to evaluate petition ${p.id} on load`, err);
    }
  }
}

export async function resolveDuePetitionsForGroup(prisma: PrismaClient, groupId: string): Promise<void> {
  await resolveDuePetitions(prisma, { groupId });
}

export async function resolveDuePetitionsForProject(prisma: PrismaClient, projectId: string): Promise<void> {
  await resolveDuePetitions(prisma, { scopeType: "project", scopeId: projectId });
}

export async function describePetitionSubject(prisma: PrismaClient, subjectType: string, subjectId: string) {
  if (subjectType === "membership_request") {
    const membership = await prisma.groupMembership.findUnique({
      where: { id: subjectId },
      select: { account: { select: { displayName: true } } },
    });
    return membership ? membership.account.displayName : subjectId;
  }

  if (subjectType === "project_proposal") {
    const proposal = await prisma.proposal.findUnique({
      where: { id: subjectId },
      select: { title: true },
    });
    return proposal ? proposal.title : subjectId;
  }

  if (subjectType === "living_document_revision") {
    const revision = await prisma.livingDocumentRevision.findUnique({
      where: { id: subjectId },
      select: { livingDocument: { select: { title: true } }, author: { select: { displayName: true } } },
    });
    return revision ? `${revision.livingDocument.title} revision by ${revision.author.displayName}` : subjectId;
  }

  if (subjectType === "living_document_archive") {
    const document = await prisma.livingDocument.findUnique({
      where: { id: subjectId },
      select: { title: true },
    });
    return document ? `Archive ${document.title}` : subjectId;
  }

  if (subjectType === "responsibility_proposal") {
    const [membershipId, type] = subjectId.split(":", 2);
    const membership = await prisma.groupMembership.findUnique({
      where: { id: membershipId },
      select: { account: { select: { displayName: true } } },
    });
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return membership ? `${membership.account.displayName} for ${label}` : subjectId;
  }

  if (subjectType === "responsibility_creation_proposal") {
    const draft = await prisma.responsibilityProposalDraft.findUnique({
      where: { id: subjectId },
      select: { type: true, description: true },
    });
    if (!draft) return subjectId;
    const description =
      draft.description.length > 80 ? `${draft.description.slice(0, 80)}…` : draft.description;
    return `Propose responsibility: ${draft.type} — ${description}`;
  }

  if (subjectType === "responsibility_recall") {
    // subjectId is the target ResponsibilityAssignment id.
    const assignment = await prisma.responsibilityAssignment.findUnique({
      where: { id: subjectId },
      select: { membership: { select: { account: { select: { displayName: true } } } }, responsibility: { select: { type: true } } },
    });
    if (!assignment) return subjectId;
    return `Recall ${assignment.membership.account.displayName} from ${responsibilityTypeLabel(assignment.responsibility.type)}`;
  }

  if (subjectType === "discussion_thread_close") {
    const thread = await prisma.discussionThread.findUnique({
      where: { id: subjectId },
      select: { title: true },
    });
    return thread ? `Close "${thread.title}"` : subjectId;
  }

  if (subjectType === "contribution_category_proposal") {
    const draft = await prisma.contributionCategoryDraft.findUnique({
      where: { id: subjectId },
      select: { name: true, offeringEntityType: true, offeringEntityId: true },
    });
    if (!draft) return subjectId;
    const entityLabel = await resolveOfferingEntityLabel(prisma, draft.offeringEntityType, draft.offeringEntityId);
    return `Propose category: ${draft.name} (${entityLabel})`;
  }

  if (subjectType === "contribution_category_archive") {
    const category = await prisma.contributionCategory.findUnique({
      where: { id: subjectId },
      select: { name: true, offeringEntityType: true, offeringEntityId: true },
    });
    if (!category) return subjectId;
    const entityLabel = await resolveOfferingEntityLabel(prisma, category.offeringEntityType, category.offeringEntityId);
    return `Archive: ${category.name} (${entityLabel})`;
  }

  if (subjectType === "trusted_provider_proposal") {
    const application = await prisma.trustedProviderApplication.findUnique({
      where: { id: subjectId },
      select: {
        categoryIds: true,
        membership: { select: { account: { select: { displayName: true } } } },
      },
    });
    if (!application) return subjectId;
    const categoryIds = application.categoryIds as string[];
    const categories = await prisma.contributionCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { name: true, offeringEntityType: true, offeringEntityId: true },
    });
    const entityLabel = categories[0]
      ? await resolveOfferingEntityLabel(prisma, categories[0].offeringEntityType, categories[0].offeringEntityId)
      : "";
    const names = categories.map((c) => c.name).sort().join(", ");
    const forWhat = names || `${categoryIds.length} ${categoryIds.length === 1 ? "category" : "categories"}`;
    return `${application.membership.account.displayName} — trusted provider for ${forWhat}${entityLabel ? ` (${entityLabel})` : ""}`;
  }

  if (subjectType === "trusted_provider_revocation") {
    const req = await prisma.trustedProviderRevocationRequest.findUnique({
      where: { id: subjectId },
      select: { membership: { select: { account: { select: { displayName: true } } } } },
    });
    return req ? `Revoke trusted provider status for ${req.membership.account.displayName}` : subjectId;
  }

  if (subjectType === "group_visibility_proposal") {
    // subjectId is `${groupId}:${target}` (legacy: bare groupId → public).
    const [gid, rawTarget] = subjectId.split(":");
    const target = rawTarget === "private" ? "private" : "public";
    const group = await prisma.group.findUnique({
      where: { id: gid },
      select: { name: true },
    });
    if (!group) return subjectId;
    return target === "private" ? `Make "${group.name}" private` : `Make "${group.name}" publicly visible`;
  }

  if (subjectType === "custom_support_requests_toggle") {
    const [gid, state] = subjectId.split(":");
    const group = await prisma.group.findUnique({ where: { id: gid }, select: { name: true } });
    if (!group) return subjectId;
    return state === "on"
      ? `"${group.name}" accepts custom support requests`
      : `"${group.name}" stops accepting custom support requests`;
  }

  if (subjectType === "membership_policy_change") {
    const [gid, policy] = subjectId.split(":");
    const group = await prisma.group.findUnique({ where: { id: gid }, select: { name: true } });
    if (!group) return subjectId;
    return policy === "open"
      ? `"${group.name}" → open membership`
      : `"${group.name}" → application-based membership`;
  }

  if (
    subjectType === "bulletin_creation" ||
    subjectType === "publication_creation" ||
    subjectType === "publication_entry_creation" ||
    subjectType === "living_document_creation"
  ) {
    const draft = await prisma.contentCreationDraft.findUnique({
      where: { id: subjectId },
      select: { contentType: true, title: true },
    });
    if (!draft) return subjectId;
    const typeLabel = draft.contentType.replace(/_/g, " ");
    return `Propose ${typeLabel}: ${draft.title ?? "(untitled)"}`;
  }

  if (subjectType === "event_authorization") {
    const proposal = await prisma.eventProposal.findUnique({
      where: { id: subjectId },
      select: { category: true, title: true },
    });
    if (!proposal) return subjectId;
    return `Authorize ${proposal.category}: ${proposal.title}`;
  }

  if (subjectType === "node_name_change_proposal" || subjectType === "node_name_change") {
    const proposal = await prisma.nodeNameProposal.findUnique({ where: { id: subjectId }, select: { proposedName: true } });
    if (!proposal) return proposalFamilyLabel(subjectType);
    return subjectType === "node_name_change"
      ? `Rename node to "${proposal.proposedName}"`
      : `Propose node name: "${proposal.proposedName}"`;
  }

  if (
    subjectType === "coalition_formation" ||
    subjectType === "coalition_join" ||
    subjectType === "coalition_departure" ||
    subjectType === "coalition_removal"
  ) {
    const proposal = await prisma.coalitionProposal.findUnique({
      where: { id: subjectId },
      select: { action: true, name: true, coalition: { select: { name: true } } },
    });
    if (!proposal) return proposalFamilyLabel(subjectType);
    const coalitionName = proposal.name?.trim() || proposal.coalition?.name || "the coalition";
    switch (proposal.action) {
      case "formation": return `Form coalition "${coalitionName}"`;
      case "join": return `Join coalition "${coalitionName}"`;
      case "departure": return `Leave coalition "${coalitionName}"`;
      case "removal": return `Remove a member from coalition "${coalitionName}"`;
      default: return proposalFamilyLabel(subjectType);
    }
  }

  if (
    subjectType === "federation_formation" ||
    subjectType === "federation_join" ||
    subjectType === "federation_departure" ||
    subjectType === "federation_removal"
  ) {
    const proposal = await prisma.federationProposal.findUnique({
      where: { id: subjectId },
      select: { action: true, participantSnapshot: true, initiatedByDomain: true, federation: { select: { name: true } } },
    });
    if (!proposal) return proposalFamilyLabel(subjectType);
    const snapshot = proposal.participantSnapshot as { domains?: string[] } | null;
    const peers = (snapshot?.domains ?? []).join(" + ") || "another node";
    switch (proposal.action) {
      case "formation": return `Federate: ${peers}`;
      case "departure": return `Leave federation "${proposal.federation?.name ?? "the federation"}"`;
      case "join": return `Join federation "${proposal.federation?.name ?? "the federation"}"`;
      case "removal": return `Remove a node from "${proposal.federation?.name ?? "the federation"}"`;
      default: return proposalFamilyLabel(subjectType);
    }
  }

  if (subjectType === "federation_policy_change") {
    const target = subjectId.split(":")[1];
    return target ? `Set federation policy to "${target}"` : proposalFamilyLabel(subjectType);
  }

  if (subjectType === "federated_visibility_change") {
    const [, peerNodeId, target] = subjectId.split(":");
    const peer = peerNodeId
      ? await prisma.federatedNode.findUnique({ where: { id: peerNodeId }, select: { displayName: true, domain: true } })
      : null;
    const peerLabel = peer?.displayName ?? peer?.domain ?? "a federated node";
    return target ? `Set stance toward ${peerLabel} to "${target}"` : proposalFamilyLabel(subjectType);
  }

  if (subjectType === "federation_termination") {
    const federation = await prisma.federation.findUnique({ where: { id: subjectId }, select: { name: true } });
    return `End federation agreement${federation ? ` "${federation.name}"` : ""}`;
  }

  if (subjectType === "federation_disable") {
    return "Disable federation for this node";
  }

  if (subjectType === "registration_mode_change") {
    const target = subjectId.split(":")[1];
    return target ? `Set registration mode to "${target.replace("_", "-")}"` : proposalFamilyLabel(subjectType);
  }

  // Never surface a raw identity code: fall back to the human-readable family label.
  return proposalFamilyLabel(subjectType);
}

// ── Petition detail (expandable governance context) ───────────────────────────

export type PetitionDetail = {
  summary: string;
  proposer: string | null;
  outcome: string;
  fields: { label: string; value: string }[];
};

type PetitionDetailInput = {
  subjectType: string;
  subjectId: string;
  status: string;
  createdByMembershipId: string | null;
  createdByAccountId: string | null;
};

async function resolvePetitionProposer(prisma: PrismaClient, petition: PetitionDetailInput): Promise<string | null> {
  if (petition.createdByMembershipId) {
    const membership = await prisma.groupMembership.findUnique({
      where: { id: petition.createdByMembershipId },
      select: { account: { select: { displayName: true } } },
    });
    if (membership) return membership.account.displayName;
  }
  if (petition.createdByAccountId) {
    const account = await prisma.account.findUnique({
      where: { id: petition.createdByAccountId },
      select: { displayName: true },
    });
    if (account) return account.displayName;
  }
  return null;
}

/**
 * Frames a present-tense effect clause as a status-aware outcome sentence, so the line is
 * accurate whether the petition is still open or already resolved (an open petition reads
 * "If approved: …"; a rejected one reads "Rejected. Would have: …").
 */
function frameOutcome(status: string, effect: string): string {
  switch (status) {
    case "open":
      return `If approved: ${effect}.`;
    case "approved":
      return `Approved: ${effect}.`;
    case "rejected":
      return `Rejected. Would have: ${effect}.`;
    case "withdrawn":
      return `Withdrawn. Would have: ${effect}.`;
    default: // superseded, blocked, anything else terminal
      return `Closed without effect. Would have: ${effect}.`;
  }
}

/**
 * Derives expandable governance context for a petition — a one-line summary, who proposed it,
 * a plain-language status-aware outcome, and type-specific details — so members can evaluate a
 * proposal without opening anything else. All values are derived from the subject (the Petition
 * model has no free-text body); the subject is fetched once per petition. Unhandled families
 * degrade to a family-label summary + a generic outcome.
 */
// Proposed bodies can be long; cap them in the petition card so the detail stays scannable.
function truncateBody(body: string, max = 2000): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Formats a proposed event's start–end range in the event's own stored IANA timezone.
 * Rendering in the scheduled zone (rather than the viewer's) is deterministic server-side
 * (no hydration mismatch) and shows everyone the same canonical time — the right framing
 * for a proposal. The live event view renders in viewer-local time separately.
 */
function formatEventWhen(start: Date, end: Date, timeZone: string): string {
  // Explicit component options (not dateStyle/timeStyle) so timeZoneName is allowed —
  // Intl.DateTimeFormat throws if dateStyle/timeStyle are mixed with component fields.
  const startOpts: Intl.DateTimeFormatOptions = {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  };
  const endOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const tz = (() => {
    try {
      // Probe the zone; an invalid IANA id throws here.
      new Intl.DateTimeFormat("en-US", { timeZone });
      return timeZone;
    } catch {
      return "UTC";
    }
  })();
  const startFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...startOpts });
  const endFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...endOpts });
  return `${startFmt.format(start)} – ${endFmt.format(end)}`;
}

type PetitionDetailContext = { proposer: string | null; familyLabel: string };
type PetitionDetailBuilder = (
  prisma: PrismaClient,
  petition: PetitionDetailInput,
  ctx: PetitionDetailContext,
) => Promise<PetitionDetail | null>;

// ── Type-specific detail builders ─────────────────────────────────────────────
// Every ProposalFamily must appear either in PETITION_DETAIL_BUILDERS or in
// KNOWN_GENERIC_FAMILIES below — the coverage test (src/test/petition-detail-coverage.test.ts)
// enforces the partition, so a new family cannot silently ship an empty Details panel.
// A builder may return null (subject row missing) to fall back to the generic rendering,
// which preserves the no-raw-id guarantee.

const membershipRequestDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const membership = await prisma.groupMembership.findUnique({
    where: { id: subjectId },
    select: { applicationNote: true, account: { select: { displayName: true } } },
  });
  const applicant = membership?.account.displayName ?? "the applicant";
  fields.push({ label: "Applicant", value: applicant });
  fields.push({ label: "Application message", value: membership?.applicationNote?.trim() || "—" });
  const summary = membership ? applicant : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `${applicant} becomes a member of this group`), fields };
};

const projectProposalDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const proposal = await prisma.proposal.findUnique({
    where: { id: subjectId },
    select: { title: true, body: true },
  });
  const title = proposal?.title ?? "the project";
  fields.push({ label: "Project", value: title });
  fields.push({ label: "Description", value: proposal?.body?.trim() || "—" });
  const summary = proposal ? proposal.title : familyLabel;
  return {
    summary,
    proposer,
    outcome: frameOutcome(status, `the project "${title}" is created and hosted by this group`),
    fields,
  };
};

const responsibilityCreationDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const draft = await prisma.responsibilityProposalDraft.findUnique({
    where: { id: subjectId },
    select: { type: true, description: true, abilities: true },
  });
  const label = responsibilityTypeLabel(draft?.type ?? "") || "the proposed role";
  fields.push({ label: "Responsibility", value: label });
  if (draft?.description) fields.push({ label: "Purpose", value: draft.description });
  const abilities = Array.isArray(draft?.abilities)
    ? (draft.abilities as { ability: string }[]).map((a) => a.ability.replace(/_/g, " "))
    : [];
  if (abilities.length > 0) fields.push({ label: "Abilities", value: abilities.join(", ") });
  const summary = draft ? `Propose responsibility: ${label}` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `a new responsibility "${label}" is created`), fields };
};

const responsibilityVolunteerDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const [membershipId, type] = subjectId.split(":", 2);
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { account: { select: { displayName: true } } },
  });
  const who = membership?.account.displayName ?? "the volunteer";
  const role = responsibilityTypeLabel(type ?? "");
  fields.push({ label: "Member", value: who });
  fields.push({ label: "Role", value: role });
  const summary = membership ? `${who} for ${role}` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `${who} holds the ${role} responsibility`), fields };
};

const responsibilityRecallDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const assignment = await prisma.responsibilityAssignment.findUnique({
    where: { id: subjectId },
    select: { membership: { select: { account: { select: { displayName: true } } } }, responsibility: { select: { type: true } } },
  });
  const who = assignment?.membership.account.displayName ?? "the holder";
  const role = responsibilityTypeLabel(assignment?.responsibility.type ?? "");
  fields.push({ label: "Member", value: who });
  fields.push({ label: "Role", value: role });
  const summary = assignment ? `Recall ${who} from ${role}` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `${who} is recalled from the ${role} responsibility`), fields };
};

const groupVisibilityDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  // subjectId is `${groupId}:${target}` (legacy: bare groupId → public).
  const [gid, rawTarget] = subjectId.split(":");
  const target = rawTarget === "private" ? "private" : "public";
  const group = await prisma.group.findUnique({ where: { id: gid }, select: { name: true } });
  if (group) fields.push({ label: "Collective", value: group.name });
  const label = target === "private" ? `Make "${group?.name}" private` : `Make "${group?.name}" publicly visible`;
  const summary = group ? label : familyLabel;
  const effect =
    target === "private"
      ? "this collective becomes private and is no longer discoverable on this node"
      : "this collective becomes publicly visible on this node";
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const customRequestsToggleDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const [gid, state] = subjectId.split(":");
  const accepts = state === "on";
  const group = await prisma.group.findUnique({ where: { id: gid }, select: { name: true } });
  if (group) fields.push({ label: "Collective", value: group.name });
  const summary = group
    ? accepts
      ? `Accept custom support requests in "${group.name}"`
      : `Stop accepting custom support requests in "${group.name}"`
    : familyLabel;
  const effect = accepts
    ? "this collective accepts free-text custom support requests (members opt in to receiving them)"
    : "this collective no longer accepts free-text custom support requests";
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const membershipPolicyChangeDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const [gid, policy] = subjectId.split(":");
  const toOpen = policy === "open";
  const group = await prisma.group.findUnique({ where: { id: gid }, select: { name: true } });
  if (group) fields.push({ label: "Collective", value: group.name });
  fields.push({ label: "New membership model", value: toOpen ? "Open (anyone may join)" : "Application-based (requires approval)" });
  const summary = group
    ? toOpen
      ? `Switch "${group.name}" to open membership`
      : `Switch "${group.name}" to application-based membership`
    : familyLabel;
  const effect = toOpen
    ? "anyone may join this collective directly"
    : "joining this collective requires an approved membership application";
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const discussionThreadCloseDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const thread = await prisma.discussionThread.findUnique({ where: { id: subjectId }, select: { title: true } });
  if (thread) fields.push({ label: "Thread", value: thread.title });
  const summary = thread ? `Close "${thread.title}"` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, "this discussion thread is closed to new replies"), fields };
};

const contentCreationDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const draft = await prisma.contentCreationDraft.findUnique({
    where: { id: subjectId },
    select: { contentType: true, title: true, body: true },
  });
  const typeLabel = (draft?.contentType ?? "").replace(/_/g, " ");
  const title = draft?.title?.trim() || "(untitled)";
  if (draft?.title) fields.push({ label: "Title", value: title });
  if (draft?.body) fields.push({ label: "Proposed text", value: truncateBody(draft.body) });
  const summary = draft ? `Propose ${typeLabel}: ${title}` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `this ${typeLabel} is published`), fields };
};

const livingDocumentRevisionDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer, familyLabel }) => {
  const fields: { label: string; value: string }[] = [];
  const revision = await prisma.livingDocumentRevision.findUnique({
    where: { id: subjectId },
    select: { body: true, livingDocument: { select: { title: true } }, author: { select: { displayName: true } } },
  });
  const docTitle = revision?.livingDocument.title ?? "the document";
  fields.push({ label: "Document", value: docTitle });
  if (revision?.author?.displayName) fields.push({ label: "Author", value: revision.author.displayName });
  if (revision?.body) fields.push({ label: "Proposed text", value: truncateBody(revision.body) });
  const summary = revision ? `${docTitle} revision` : familyLabel;
  return { summary, proposer, outcome: frameOutcome(status, `this revision to "${docTitle}" is adopted`), fields };
};

const eventAuthorizationDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer }) => {
  const proposal = await prisma.eventProposal.findUnique({
    where: { id: subjectId },
    select: { category: true, title: true, description: true, startTime: true, endTime: true, timezone: true, location: true },
  });
  if (!proposal) return null;
  const fields: { label: string; value: string }[] = [];
  fields.push({ label: "When", value: formatEventWhen(proposal.startTime, proposal.endTime, proposal.timezone) });
  if (proposal.location) fields.push({ label: "Location", value: proposal.location });
  if (proposal.description) fields.push({ label: "Description", value: truncateBody(proposal.description) });
  return {
    summary: `Authorize ${proposal.category}: ${proposal.title}`,
    proposer,
    outcome: frameOutcome(status, `the ${proposal.category} "${proposal.title}" is scheduled`),
    fields,
  };
};

const COALITION_ROLE_LABELS: Record<string, string> = {
  participant: "Participating collectives",
  applicant: "Applicant collective",
  departing: "Departing collective",
  remaining_member: "Remaining member collectives",
};

const coalitionDetail: PetitionDetailBuilder = async (prisma, { subjectId, subjectType, status }, { proposer, familyLabel }) => {
  const proposal = await prisma.coalitionProposal.findUnique({
    where: { id: subjectId },
    select: {
      action: true,
      name: true,
      description: true,
      content: true,
      targetGroupId: true,
      proposedByGroup: { select: { name: true } },
      coalition: { select: { name: true } },
      petitions: { select: { role: true, groupSnapshot: true } },
    },
  });
  if (!proposal) return null;

  const coalitionName = proposal.name?.trim() || proposal.coalition?.name || "the coalition";
  const fields: { label: string; value: string }[] = [];
  fields.push({ label: "Coalition", value: coalitionName });
  fields.push({ label: "Proposing collective", value: proposal.proposedByGroup.name });
  if (proposal.description?.trim()) fields.push({ label: "Description", value: proposal.description.trim() });

  const namesByRole = new Map<string, string[]>();
  for (const p of proposal.petitions) {
    const name = (p.groupSnapshot as { name?: string } | null)?.name ?? "a collective";
    const list = namesByRole.get(p.role) ?? [];
    list.push(name);
    namesByRole.set(p.role, list);
  }
  for (const [role, label] of Object.entries(COALITION_ROLE_LABELS)) {
    const names = namesByRole.get(role);
    if (names?.length) fields.push({ label, value: names.join(", ") });
  }
  if (proposal.content?.trim()) fields.push({ label: "Rationale", value: truncateBody(proposal.content) });

  const applicant = namesByRole.get("applicant")?.[0];
  const departing = namesByRole.get("departing")?.[0];
  let summary = familyLabel;
  let effect = `this ${familyLabel.toLowerCase()} takes effect`;
  if (subjectType === "coalition_formation") {
    summary = `Form coalition "${coalitionName}"`;
    effect = `the coalition "${coalitionName}" is formed by the participating collectives`;
  } else if (subjectType === "coalition_join") {
    summary = `${applicant ?? "A collective"} joins "${coalitionName}"`;
    effect = `${applicant ?? "the applicant collective"} joins the coalition "${coalitionName}"`;
  } else if (subjectType === "coalition_departure") {
    summary = `${departing ?? "A collective"} leaves "${coalitionName}"`;
    effect = `${departing ?? "the departing collective"} leaves the coalition "${coalitionName}"`;
  } else if (subjectType === "coalition_removal") {
    const target = proposal.targetGroupId
      ? (await prisma.group.findUnique({ where: { id: proposal.targetGroupId }, select: { name: true } }))?.name
      : undefined;
    if (target) fields.push({ label: "Collective proposed for removal", value: target });
    summary = `Remove ${target ?? "a collective"} from "${coalitionName}"`;
    effect = `${target ?? "the collective"} is removed from the coalition "${coalitionName}"`;
  }
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const federatedVisibilityDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer }) => {
  const [, peerNodeId, target] = subjectId.split(":");
  if (!peerNodeId || !target) return null;
  const peer = await prisma.federatedNode.findUnique({
    where: { id: peerNodeId },
    select: { displayName: true, domain: true, status: true },
  });
  const peerLabel = peer?.displayName ?? peer?.domain ?? "a federated node";
  const stanceMeaning =
    target === "closed"
      ? "invisible to that node's federated surfaces (the default)"
      : target === "visible"
        ? "discoverable in that node's federated listings, but not interactive"
        : "that node's members may interact (join requests, presence interaction) through the normal processes";
  return {
    summary: `Set this collective's stance toward ${peerLabel} to "${target}"`,
    proposer,
    outcome: frameOutcome(status, `this collective becomes ${target} toward ${peerLabel}`),
    fields: [
      { label: "Peer node", value: peer ? `${peerLabel} (${peer.domain}, ${peer.status})` : peerNodeId },
      { label: "Proposed stance", value: `${target} — ${stanceMeaning}` },
      {
        label: "Honest scope",
        value:
          "This governs the federated layer only. A public collective's page is already readable by anyone on the open web, including that node's members — no stance can retract that.",
      },
    ],
  };
};

// Federation petitions decide relationships between whole communities; every
// one of them gets a real detail panel (the plan's "legibility matters most
// exactly here" rule — none may land in KNOWN_GENERIC_FAMILIES).

const federationProposalDetail: PetitionDetailBuilder = async (prisma, { subjectId, subjectType, status }, { proposer, familyLabel }) => {
  const proposal = await prisma.federationProposal.findUnique({
    where: { id: subjectId },
    select: {
      action: true,
      name: true,
      content: true,
      initiatedByDomain: true,
      participantSnapshot: true,
      decisions: true,
      closesAt: true,
      federation: { select: { name: true } },
    },
  });
  if (!proposal) return null;

  const snapshot = proposal.participantSnapshot as { domains?: string[] } | null;
  const domains = snapshot?.domains ?? [];
  const decisions = (proposal.decisions ?? {}) as Record<string, string>;
  const federationName = proposal.name?.trim() || proposal.federation?.name || "the federation";

  const fields: { label: string; value: string }[] = [];
  fields.push({ label: "Participating nodes", value: domains.join(", ") || "—" });
  fields.push({ label: "Initiated by", value: proposal.initiatedByDomain });
  const decided = domains
    .map((domain) => `${domain}: ${decisions[domain] ?? "pending"}`)
    .join(" · ");
  if (decided) fields.push({ label: "Node decisions", value: decided });
  if (proposal.content?.trim()) fields.push({ label: "Rationale", value: truncateBody(proposal.content) });
  fields.push({
    label: "What an agreement grants",
    value:
      "Only the capability to interact: every collective on this node stays closed toward the peer until it opens itself by its own petition. No community data flows from the agreement alone.",
  });

  let summary = familyLabel;
  let effect = `this ${familyLabel.toLowerCase()} takes effect`;
  if (subjectType === "federation_formation") {
    summary = `Federate with ${domains.filter((d) => d !== proposal.initiatedByDomain).join(", ") || "a peer node"}`;
    effect = "the agreement becomes active once EVERY participating node's steward petition approves (mutual consent)";
  } else if (subjectType === "federation_departure") {
    summary = `Leave "${federationName}"`;
    effect = "this node leaves the agreement unilaterally and the peer is notified";
  } else if (subjectType === "federation_join") {
    summary = `Join "${federationName}"`;
    effect = "this node joins the agreement once every member consents";
  } else if (subjectType === "federation_removal") {
    summary = `Remove a node from "${federationName}"`;
    effect = "the node is removed once the remaining members consent";
  }
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const federationPolicyDetail: PetitionDetailBuilder = async (_prisma, { subjectId, status }, { proposer }) => {
  const target = subjectId.split(":")[1] ?? "unknown";
  return {
    summary: `Set federation policy to "${target}"`,
    proposer,
    outcome: frameOutcome(status, `this node's federation policy becomes "${target}"`),
    fields: [
      { label: "Proposed policy", value: target },
      {
        label: "Scope",
        value:
          "Policy governs how this node handles federation requests. It is steward-managed; any member can petition node-wide to end an agreement or disable federation entirely.",
      },
    ],
  };
};

const federationTerminationDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer }) => {
  const federation = await prisma.federation.findUnique({
    where: { id: subjectId },
    select: { name: true, memberships: { where: { endedAt: null }, select: { memberDomain: true, isSelf: true } } },
  });
  const name = federation?.name ?? "the federation";
  const peers = federation?.memberships.filter((m) => !m.isSelf).map((m) => m.memberDomain) ?? [];
  return {
    summary: `End federation agreement "${name}"`,
    proposer,
    outcome: frameOutcome(status, `the agreement with ${peers.join(", ") || "the peer node"} ends and the peer is notified`),
    fields: [
      { label: "Agreement", value: name },
      ...(peers.length ? [{ label: "Peer nodes", value: peers.join(", ") }] : []),
      {
        label: "Why this vote is node-wide",
        value:
          "Starting federation is delegated to the steward collective; stopping it always belongs to the whole node. Ending is reversible — a new agreement can be proposed later.",
      },
    ],
  };
};

const federationDisableDetail: PetitionDetailBuilder = async (prisma, { status }, { proposer }) => {
  const activeCount = await prisma.federation.count({
    where: { status: "active", memberships: { some: { isSelf: true, endedAt: null } } },
  });
  return {
    summary: "Disable federation for this node",
    proposer,
    outcome: frameOutcome(
      status,
      `federation is disabled: ${activeCount > 0 ? `all ${activeCount} active agreement${activeCount === 1 ? "" : "s"} end` : "no agreements are active"} and the node stops accepting federation requests`,
    ),
    fields: [
      { label: "Active agreements affected", value: String(activeCount) },
      {
        label: "Why this vote is node-wide",
        value:
          "A community that wants to be constitutionally non-federating can make itself so. This is the strongest stop valve; it is reversible only by the steward collective re-enabling policy later.",
      },
    ],
  };
};

const registrationModeDetail: PetitionDetailBuilder = async (_prisma, { subjectId, status }, { proposer }) => {
  const target = subjectId.split(":")[1] ?? "unknown";
  const meaning =
    target === "open"
      ? "anyone may register on this node (protected by the registration rate limiter once C0 ships)"
      : "registration requires a valid node invite (the gate itself ships with Workstream C0; until then this label is aspirational and the node behaves as open)";
  return {
    summary: `Set registration mode to "${target.replace("_", "-")}"`,
    proposer,
    outcome: frameOutcome(status, `this node's registration mode becomes "${target.replace("_", "-")}"`),
    fields: [
      { label: "Proposed mode", value: `${target.replace("_", "-")} — ${meaning}` },
      {
        label: "Why this vote is node-wide",
        value:
          "Who may join the node is constitutional, like the node's name — never a delegated operational act. The mode also governs how this node consents to hosting other communities' backups (register F-10).",
      },
    ],
  };
};

// Steward petitions carry real authority since federation landed (register
// F-5): the detail panel must say what the vote confers, not just name it —
// this is Workstream A finding A7, the mandated appointment legibility.
const NODE_STEWARD_MANDATE =
  "The steward collective holds the node's federation authority: it decides which other Commons nodes " +
  "this node federates with, through its own visible petitions. Node-wide votes can end any agreement " +
  "or disable federation, and the steward collective is recallable by node-wide no-confidence vote.";

const nodeStewardDetail: PetitionDetailBuilder = async (prisma, { subjectId, subjectType, status }, { proposer, familyLabel }) => {
  const proposal = await prisma.nodeStewardProposal.findUnique({
    where: { id: subjectId },
    select: { action: true, origin: true, snapshot: true },
  });
  if (!proposal) return null;

  const snapshot = proposal.snapshot as {
    node?: { name?: string };
    candidateGroup?: { name?: string };
    stewardGroup?: { name?: string };
    initiatingGroup?: { name?: string };
  } | null;
  const nodeName = snapshot?.node?.name ?? "this node";
  const collective = snapshot?.candidateGroup?.name ?? snapshot?.stewardGroup?.name ?? "a collective";

  const fields: { label: string; value: string }[] = [];
  fields.push({ label: "Node", value: nodeName });
  fields.push({
    label: proposal.action === "appointment" ? "Candidate collective" : "Steward collective",
    value: collective,
  });
  if (snapshot?.initiatingGroup?.name) {
    fields.push({ label: "Initiated through", value: snapshot.initiatingGroup.name });
  }
  fields.push({ label: "Origin", value: proposal.origin === "host" ? "Node host" : "Collective" });
  fields.push({ label: "What stewardship carries", value: NODE_STEWARD_MANDATE });

  let summary = familyLabel;
  let effect = `this ${familyLabel.toLowerCase()} takes effect`;
  if (subjectType === "node_steward_group_nomination") {
    summary = `Nominate ${collective} as steward collective`;
    effect = "the nomination advances (candidate consent, then a node-wide appointment vote)";
  } else if (subjectType === "node_steward_candidate_consent") {
    summary = `${collective} consents to steward candidacy`;
    effect = "the candidacy advances to a node-wide appointment vote";
  } else if (subjectType === "node_steward_appointment") {
    summary = `Appoint ${collective} as steward collective`;
    effect = `${collective} becomes the steward collective, holding the node's federation authority`;
  } else if (subjectType === "node_steward_no_confidence_initiation") {
    summary = `Initiate no-confidence in ${collective}`;
    effect = "a node-wide no-confidence vote opens";
  } else if (subjectType === "node_steward_no_confidence") {
    summary = `Remove ${collective} as steward collective`;
    effect = `${collective} is removed and the node's federation authority is vacated until a new steward is appointed`;
  } else if (subjectType === "node_steward_resignation") {
    summary = `${collective} resigns as steward collective`;
    effect = `${collective} steps down and the node's federation authority is vacated until a new steward is appointed`;
  }
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const trustedProviderProposalDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer }) => {
  const application = await prisma.trustedProviderApplication.findUnique({
    where: { id: subjectId },
    select: { categoryIds: true, membership: { select: { account: { select: { displayName: true } } } } },
  });
  if (!application) return null;
  const who = application.membership.account.displayName;
  const categoryIds = (application.categoryIds as string[]) ?? [];
  const categories = categoryIds.length
    ? await prisma.contributionCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { name: true, offeringEntityType: true, offeringEntityId: true },
      })
    : [];
  const names = categories.map((c) => c.name).sort().join(", ");
  const fields: { label: string; value: string }[] = [{ label: "Nominee", value: who }];
  if (names) fields.push({ label: "Contribution categories", value: names });
  const first = categories[0];
  if (first) {
    fields.push({
      label: "Offering space",
      value: await resolveOfferingEntityLabel(prisma, first.offeringEntityType, first.offeringEntityId),
    });
  }
  const summary = names ? `${who} — trusted provider for ${names}` : `${who} — trusted provider`;
  const effect = names
    ? `${who} is recognized as a trusted provider for ${names}`
    : `${who} is recognized as a trusted provider`;
  return { summary, proposer, outcome: frameOutcome(status, effect), fields };
};

const trustedProviderRevocationDetail: PetitionDetailBuilder = async (prisma, { subjectId, status }, { proposer }) => {
  const req = await prisma.trustedProviderRevocationRequest.findUnique({
    where: { id: subjectId },
    select: { statusIds: true, membership: { select: { account: { select: { displayName: true } } } } },
  });
  if (!req) return null;
  const who = req.membership.account.displayName;
  const statusIds = (req.statusIds as string[]) ?? [];
  const statuses = statusIds.length
    ? await prisma.trustedProviderStatus.findMany({ where: { id: { in: statusIds } }, select: { categoryId: true } })
    : [];
  const categoryIds = [...new Set(statuses.map((s) => s.categoryId))];
  const categories = categoryIds.length
    ? await prisma.contributionCategory.findMany({ where: { id: { in: categoryIds } }, select: { name: true } })
    : [];
  const names = categories.map((c) => c.name).sort().join(", ");
  const fields: { label: string; value: string }[] = [{ label: "Member", value: who }];
  if (names) fields.push({ label: "Contribution categories", value: names });
  const effect = names
    ? `${who}'s trusted-provider status for ${names} is revoked`
    : `${who}'s trusted-provider status is revoked`;
  return { summary: `Revoke trusted provider status for ${who}`, proposer, outcome: frameOutcome(status, effect), fields };
};

const projectHostingDetail: PetitionDetailBuilder = async (prisma, { subjectId, subjectType, status }, { proposer }) => {
  const proposal = await prisma.projectHostingProposal.findUnique({
    where: { id: subjectId },
    select: { content: true, projectSnapshot: true, candidateGroupSnapshot: true },
  });
  if (!proposal) return null;
  const projectName = (proposal.projectSnapshot as { name?: string } | null)?.name ?? "the project";
  const groupName = (proposal.candidateGroupSnapshot as { name?: string } | null)?.name ?? "the collective";
  const fields: { label: string; value: string }[] = [
    { label: "Project", value: projectName },
    { label: "Candidate host collective", value: groupName },
  ];
  if (proposal.content?.trim()) fields.push({ label: "Rationale", value: truncateBody(proposal.content) });
  const summary =
    subjectType === "project_hosting_offer"
      ? `Host the project "${projectName}"`
      : `Accept "${groupName}" as a host collective`;
  return {
    summary,
    proposer,
    outcome: frameOutcome(status, `"${groupName}" becomes a host collective for the project "${projectName}"`),
    fields,
  };
};

const PETITION_DETAIL_BUILDERS: Partial<Record<ProposalFamily, PetitionDetailBuilder>> = {
  membership_request: membershipRequestDetail,
  project_proposal: projectProposalDetail,
  responsibility_creation_proposal: responsibilityCreationDetail,
  responsibility_proposal: responsibilityVolunteerDetail,
  responsibility_recall: responsibilityRecallDetail,
  group_visibility_proposal: groupVisibilityDetail,
  custom_support_requests_toggle: customRequestsToggleDetail,
  membership_policy_change: membershipPolicyChangeDetail,
  discussion_thread_close: discussionThreadCloseDetail,
  bulletin_creation: contentCreationDetail,
  publication_creation: contentCreationDetail,
  publication_entry_creation: contentCreationDetail,
  living_document_creation: contentCreationDetail,
  living_document_revision: livingDocumentRevisionDetail,
  event_authorization: eventAuthorizationDetail,
  coalition_formation: coalitionDetail,
  coalition_join: coalitionDetail,
  coalition_departure: coalitionDetail,
  coalition_removal: coalitionDetail,
  node_steward_group_nomination: nodeStewardDetail,
  node_steward_candidate_consent: nodeStewardDetail,
  node_steward_appointment: nodeStewardDetail,
  node_steward_no_confidence_initiation: nodeStewardDetail,
  node_steward_no_confidence: nodeStewardDetail,
  node_steward_resignation: nodeStewardDetail,
  federation_formation: federationProposalDetail,
  federation_join: federationProposalDetail,
  federation_departure: federationProposalDetail,
  federation_removal: federationProposalDetail,
  federation_policy_change: federationPolicyDetail,
  federation_termination: federationTerminationDetail,
  federation_disable: federationDisableDetail,
  federated_visibility_change: federatedVisibilityDetail,
  registration_mode_change: registrationModeDetail,
  trusted_provider_proposal: trustedProviderProposalDetail,
  trusted_provider_revocation: trustedProviderRevocationDetail,
  project_hosting_offer: projectHostingDetail,
  project_hosting_acceptance: projectHostingDetail,
};

/** Families with a type-specific detail builder — exported for the coverage test. */
export const PETITION_DETAILED_FAMILIES = Object.keys(PETITION_DETAIL_BUILDERS) as ProposalFamily[];

/**
 * Families that deliberately render the generic detail (describePetitionSubject summary +
 * framed outcome, no fields). Adding a new ProposalFamily? Either give it a builder above
 * or add it here consciously — the coverage test fails the suite otherwise.
 */
export const KNOWN_GENERIC_FAMILIES: ReadonlySet<ProposalFamily> = new Set<ProposalFamily>([
  "project_hosting_withdrawal",
  "node_name_change_proposal",
  "node_name_change",
  "accountability_action",
  "bulletin_archive",
  "publication_archive",
  "publication_entry_archive",
  "living_document_archive",
  "emergency_declaration",
  "collective_support_request",
  "collective_contribution_offer",
  "contribution_category_proposal",
  "contribution_category_archive",
]);

export async function getPetitionDetail(prisma: PrismaClient, petition: PetitionDetailInput): Promise<PetitionDetail> {
  const proposer = await resolvePetitionProposer(prisma, petition);
  const familyLabel = proposalFamilyLabel(petition.subjectType);

  const builder = PETITION_DETAIL_BUILDERS[petition.subjectType as ProposalFamily];
  if (builder) {
    const detail = await builder(prisma, petition, { proposer, familyLabel });
    if (detail) return detail;
  }

  // Known-generic families — and any builder whose subject row is missing: delegate the
  // one-line summary to describePetitionSubject (never a raw id) and frame a generic outcome.
  const summary = await describePetitionSubject(prisma, petition.subjectType, petition.subjectId);
  return {
    summary,
    proposer,
    outcome: frameOutcome(petition.status, `this ${familyLabel.toLowerCase()} takes effect`),
    fields: [],
  };
}

async function resolveOfferingEntityLabel(
  prisma: PrismaClient,
  entityType: string,
  entityId: string,
): Promise<string> {
  if (entityType === "group") {
    const g = await prisma.group.findUnique({ where: { id: entityId }, select: { name: true } });
    return g ? g.name : entityId;
  }
  if (entityType === "project") {
    const p = await prisma.project.findUnique({ where: { id: entityId }, select: { name: true } });
    return p ? `Project: ${p.name}` : entityId;
  }
  if (entityType === "responsibility") {
    const r = await prisma.responsibility.findUnique({ where: { id: entityId }, select: { type: true } });
    return r ? `Responsibility: ${r.type}` : entityId;
  }
  return entityId;
}

export function proposalFamilyLabel(subjectType: string) {
  switch (subjectType) {
    case "living_document_revision": return "Living document revision";
    case "living_document_archive": return "Living document archival";
    case "discussion_thread_close": return "Discussion thread closure";
    case "responsibility_proposal": return "Responsibility volunteer";
    case "responsibility_creation_proposal": return "Responsibility proposal";
    case "responsibility_recall": return "Responsibility recall";
    case "contribution_category_proposal": return "Contribution category proposal";
    case "contribution_category_archive": return "Contribution category archival";
    case "trusted_provider_proposal": return "Trusted provider recognition";
    case "trusted_provider_revocation": return "Trusted provider revocation";
    case "group_visibility_proposal": return "Group visibility proposal";
    case "custom_support_requests_toggle": return "Custom support requests";
    case "membership_policy_change": return "Membership model change";
    case "bulletin_creation": return "Bulletin Creation";
    case "publication_creation": return "Publication Creation";
    case "publication_entry_creation": return "Publication Entry";
    case "living_document_creation": return "Living Document Creation";
    case "project_hosting_withdrawal": return "Project host withdrawal";
    case "project_hosting_offer": return "Project hosting offer";
    case "project_hosting_acceptance": return "Project host acceptance";
    case "coalition_formation": return "Coalition formation";
    case "coalition_join": return "Coalition membership";
    case "coalition_departure": return "Coalition departure";
    case "coalition_removal": return "Coalition member removal";
    case "node_steward_group_nomination": return "Node steward group nomination";
    case "node_steward_candidate_consent": return "Node steward candidate consent";
    case "node_steward_appointment": return "Node steward appointment";
    case "node_steward_no_confidence_initiation": return "Node steward no-confidence initiation";
    case "node_steward_no_confidence": return "Node steward no confidence";
    case "node_steward_resignation": return "Node steward resignation";
    case "node_name_change_proposal": return "Node name proposal";
    case "node_name_change": return "Node rename vote";
    case "federation_formation": return "Federation agreement";
    case "federation_join": return "Federation join";
    case "federation_departure": return "Federation departure";
    case "federation_removal": return "Federation member removal";
    case "federation_policy_change": return "Federation policy change";
    case "federated_visibility_change": return "Federated visibility stance";
    case "registration_mode_change": return "Registration mode change";
    case "federation_termination": return "End federation agreement";
    case "federation_disable": return "Disable federation";
    case "event_authorization": return "Event authorization";
    default: return subjectType.replace(/_/g, " ");
  }
}

export function governanceCategoryLabel(category: string) {
  switch (category) {
    case "membership": return "Membership";
    case "project": return "Projects";
    case "responsibility": return "Responsibilities";
    case "accountability": return "Accountability";
    case "living_document": return "Living Documents";
    case "archival": return "Archival";
    case "emergency": return "Emergency";
    case "discussion": return "Discussion";
    case "support_request": return "Support Requests";
    case "contribution_offer": return "Contribution Offers";
    case "contribution_category": return "Contribution Categories";
    case "trusted_provider": return "Trusted Providers";
    case "group_settings": return "Group Settings";
    case "publishing": return "Publishing";
    case "participation": return "Participation";
    case "node_stewardship": return "Node Stewardship";
    case "coordination": return "Coordination";
    default: return category.replace(/_/g, " ");
  }
}
