import type { PrismaClient } from "../generated/prisma/client";
import { evaluatePetition } from "./petitions";
import {
  onRevisionPetitionApproved,
  onLivingDocumentArchivalPetitionApproved,
} from "./living-documents";
import { onThreadClosurePetitionApproved } from "./discussions";
import { confirmResponsibilityAssignment } from "./responsibilities";

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

  return subjectId;
}

export function proposalFamilyLabel(subjectType: string) {
  switch (subjectType) {
    case "living_document_revision": return "Living document revision";
    case "living_document_archive": return "Living document archival";
    case "discussion_thread_close": return "Discussion thread closure";
    case "responsibility_proposal": return "Responsibility volunteer";
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
    default: return category.replace(/_/g, " ");
  }
}
