"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeBulletinCreation, openBulletinArchivalPetition } from "../../../../../../lib/bulletins";
import { proposePublicationCreation, proposePubEntryCreation, openPublicationArchivalPetition } from "../../../../../../lib/publications";
import { proposeLivingDocumentCreation, draftLivingDocumentRevision, openRevisionPetition } from "../../../../../../lib/living-documents";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

function contentProposalFailureMessage(reason: string) {
  switch (reason) {
    case "not_eligible": return "You are not eligible to propose this content.";
    case "publication_archived": return "That publication has been archived.";
    case "publication_not_found": return "Publication not found.";
    case "missing_required_fields": return "Please fill in all required fields.";
    default: return "This proposal could not be submitted.";
  }
}

export async function archiveBulletinAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const bulletinId = formData.get("bulletinId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await openBulletinArchivalPetition(prisma, { bulletinId, createdByMembershipId: membership.id, groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function archivePublicationAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const publicationId = formData.get("publicationId") as string;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await openPublicationArchivalPetition(prisma, { publicationId, createdByMembershipId: membership.id, groupId });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function proposeBulletinCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeBulletinCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, body, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Bulletin proposed — check Petitions." };
}

export async function proposePublicationCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposePublicationCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Publication proposed — check Petitions." };
}

export async function proposeLivingDocumentCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeLivingDocumentCreation(prisma, { spaceType: "group", spaceId: groupId, groupId, title, body, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Document proposed — check Petitions." };
}

export async function proposePubEntryCreationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const publicationId = requiredString(formData, "publicationId");
  const body = requiredString(formData, "body");
  const title = formData.get("title") as string | null;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposePubEntryCreation(prisma, {
      spaceType: "group",
      spaceId: groupId,
      publicationId,
      groupId,
      body,
      title: title || undefined,
      createdByMembershipId: membership.id,
    });
    if (!result.ok) return { kind: "error", message: contentProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Entry proposed — check Petitions." };
}

export async function proposeLivingDocumentRevisionAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const livingDocumentId = requiredString(formData, "livingDocumentId");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const draft = await draftLivingDocumentRevision(prisma, { livingDocumentId, body, authorId: session.accountId });
    await openRevisionPetition(prisma, { livingDocumentId, revisionId: draft.id, groupId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
