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

export async function evaluateAndApplyPetition(prisma: PrismaClient, petitionId: string) {
  const result = await evaluatePetition(prisma, petitionId);
  if (result.outcome !== "approved") return;

  const petition = await prisma.petition.findUnique({
    where: { id: petitionId },
    select: { subjectType: true },
  });
  if (!petition) return;

  if (petition.subjectType === "living_document_revision") {
    await onRevisionPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "living_document_archive") {
    await onLivingDocumentArchivalPetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "discussion_thread_close") {
    await onThreadClosurePetitionApproved(prisma, petitionId);
  } else if (petition.subjectType === "responsibility_proposal") {
    await confirmResponsibilityAssignment(prisma, petitionId);
  } else if (petition.subjectType === "contribution_category_proposal") {
    await createContributionCategoryFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "contribution_category_archive") {
    await archiveContributionCategoryFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "trusted_provider_proposal") {
    await grantTrustedProviderStatusFromPetition(prisma, petitionId);
  } else if (petition.subjectType === "trusted_provider_revocation") {
    await revokeTrustedProviderStatusFromPetition(prisma, petitionId);
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
    case "contribution_category_proposal": return "Contribution category proposal";
    case "contribution_category_archive": return "Contribution category archival";
    case "trusted_provider_proposal": return "Trusted provider recognition";
    case "trusted_provider_revocation": return "Trusted provider revocation";
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
    default: return category.replace(/_/g, " ");
  }
}
