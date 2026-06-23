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
import { evaluateEventProposalForPetition } from "./events";
import { evaluateNodeStewardProposalForPetition } from "./node-stewardship";
import { evaluateNodeNameProposalForPetition } from "./node-name";
import { responsibilityTypeLabel } from "./concern-reviewer";

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
    const firstCategory = await prisma.contributionCategory.findFirst({
      where: { id: { in: categoryIds } },
      select: { offeringEntityType: true, offeringEntityId: true },
    });
    const entityLabel = firstCategory
      ? await resolveOfferingEntityLabel(prisma, firstCategory.offeringEntityType, firstCategory.offeringEntityId)
      : "";
    const n = categoryIds.length;
    return `${application.membership.account.displayName} — trusted provider for ${n} ${n === 1 ? "category" : "categories"} (${entityLabel})`;
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

export async function getPetitionDetail(prisma: PrismaClient, petition: PetitionDetailInput): Promise<PetitionDetail> {
  const proposer = await resolvePetitionProposer(prisma, petition);
  const { subjectType, subjectId, status } = petition;
  const familyLabel = proposalFamilyLabel(subjectType);
  const fields: { label: string; value: string }[] = [];

  if (subjectType === "membership_request") {
    const membership = await prisma.groupMembership.findUnique({
      where: { id: subjectId },
      select: { applicationNote: true, account: { select: { displayName: true } } },
    });
    const applicant = membership?.account.displayName ?? "the applicant";
    fields.push({ label: "Applicant", value: applicant });
    fields.push({ label: "Application message", value: membership?.applicationNote?.trim() || "—" });
    const summary = membership ? applicant : familyLabel;
    return { summary, proposer, outcome: frameOutcome(status, `${applicant} becomes a member of this group`), fields };
  }

  if (subjectType === "project_proposal") {
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
  }

  if (subjectType === "responsibility_creation_proposal") {
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
  }

  if (subjectType === "responsibility_proposal") {
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
  }

  if (subjectType === "responsibility_recall") {
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
  }

  if (subjectType === "group_visibility_proposal") {
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
  }

  if (subjectType === "custom_support_requests_toggle") {
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
  }

  if (subjectType === "membership_policy_change") {
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
  }

  if (subjectType === "discussion_thread_close") {
    const thread = await prisma.discussionThread.findUnique({ where: { id: subjectId }, select: { title: true } });
    if (thread) fields.push({ label: "Thread", value: thread.title });
    const summary = thread ? `Close "${thread.title}"` : familyLabel;
    return { summary, proposer, outcome: frameOutcome(status, "this discussion thread is closed to new replies"), fields };
  }

  if (
    subjectType === "bulletin_creation" ||
    subjectType === "publication_creation" ||
    subjectType === "publication_entry_creation" ||
    subjectType === "living_document_creation"
  ) {
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
  }

  if (subjectType === "living_document_revision") {
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
  }

  if (subjectType === "event_authorization") {
    const proposal = await prisma.eventProposal.findUnique({
      where: { id: subjectId },
      select: { category: true, title: true, description: true, startTime: true, endTime: true, timezone: true, location: true },
    });
    if (proposal) {
      fields.push({ label: "When", value: formatEventWhen(proposal.startTime, proposal.endTime, proposal.timezone) });
      if (proposal.location) fields.push({ label: "Location", value: proposal.location });
      if (proposal.description) fields.push({ label: "Description", value: truncateBody(proposal.description) });
      return {
        summary: `Authorize ${proposal.category}: ${proposal.title}`,
        proposer,
        outcome: frameOutcome(status, `the ${proposal.category} "${proposal.title}" is scheduled`),
        fields,
      };
    }
  }

  // Other families: delegate the one-line summary to describePetitionSubject (its single
  // caller path), and frame a generic outcome. No extra subject fetch for the rich types above.
  const summary = await describePetitionSubject(prisma, subjectType, subjectId);
  return {
    summary,
    proposer,
    outcome: frameOutcome(status, `this ${familyLabel.toLowerCase()} takes effect`),
    fields,
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
