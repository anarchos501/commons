import type { PrismaClient } from "../generated/prisma/client";
import { evaluatePetition } from "./petitions";
import {
  onRevisionPetitionApproved,
  onLivingDocumentArchivalPetitionApproved,
} from "./living-documents";
import { onThreadClosurePetitionApproved } from "./discussions";
import { confirmResponsibilityAssignment } from "./responsibilities";
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
import { applyGroupVisibilityFromPetition } from "./group-settings";
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
import { evaluateNodeStewardProposalForPetition } from "./node-stewardship";

export async function evaluateAndApplyPetition(prisma: PrismaClient, petitionId: string) {
  const result = await evaluatePetition(prisma, petitionId);
  const hostingProposalResult = await evaluateProjectHostingProposalForPetition(prisma, petitionId);
  if (hostingProposalResult) return;
  const coalitionProposalResult = await evaluateCoalitionProposalForPetition(prisma, petitionId);
  if (coalitionProposalResult) return;
  const nodeStewardResult = await evaluateNodeStewardProposalForPetition(prisma, petitionId);
  if (nodeStewardResult) return;
  if (result.outcome !== "approved") return;

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectType: true, subjectId: true },
  });
  if (!petition) return;

  if (petition.subjectType === "membership_request") {
    await approveMembershipRequest(prisma, petition.subjectId);
  } else if (petition.subjectType === "living_document_revision") {
    await onRevisionPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "living_document_archive") {
    await onLivingDocumentArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "discussion_thread_close") {
    await onThreadClosurePetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "responsibility_proposal") {
    await confirmResponsibilityAssignment(prisma, petitionId);
  } else if (petition.subjectType === "responsibility_creation_proposal") {
    await createResponsibilityFromProposal(prisma, petitionId);
  } else if (petition.subjectType === "contribution_category_proposal") {
    await createContributionCategoryFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "contribution_category_archive") {
    await archiveContributionCategoryFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "trusted_provider_proposal") {
    await grantTrustedProviderStatusFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "trusted_provider_revocation") {
    await revokeTrustedProviderStatusFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "emergency_declaration") {
    await onEmergencyPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "project_proposal") {
    await createProjectFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "project_hosting_withdrawal") {
    await onProjectHostingWithdrawalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "bulletin_archive") {
    await onBulletinArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "publication_archive") {
    await onPublicationArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "publication_entry_archive") {
    await onPublicationEntryArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "group_visibility_proposal") {
    await applyGroupVisibilityFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "bulletin_creation") {
    await applyContentCreationDraft(prisma, petitionId, "bulletin_creation");
  } else if (petition.subjectType === "publication_creation") {
    await applyContentCreationDraft(prisma, petitionId, "publication_creation");
  } else if (petition.subjectType === "publication_entry_creation") {
    await applyContentCreationDraft(prisma, petitionId, "publication_entry_creation");
  } else if (petition.subjectType === "living_document_creation") {
    await applyContentCreationDraft(prisma, petitionId, "living_document_creation");
  }
}

export async function describePetitionSubject(prisma: PrismaClient, subjectType: string, subjectId: string) {
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
    const group = await prisma.group.findUnique({
      where: { id: subjectId },
      select: { name: true },
    });
    return group ? `Make "${group.name}" publicly visible` : subjectId;
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

  return subjectId;
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
    case "contribution_category_proposal": return "Contribution category proposal";
    case "contribution_category_archive": return "Contribution category archival";
    case "trusted_provider_proposal": return "Trusted provider recognition";
    case "trusted_provider_revocation": return "Trusted provider revocation";
    case "group_visibility_proposal": return "Group visibility proposal";
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
    default: return category.replace(/_/g, " ");
  }
}
