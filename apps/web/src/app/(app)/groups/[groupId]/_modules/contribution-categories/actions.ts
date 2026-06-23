"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeContributionCategory, proposeContributionCategoryArchival } from "../../../../../../lib/contribution-categories";
import { proposeCustomRequestsToggle } from "../../../../../../lib/group-settings";
import { generateGroupRequestLink, revokeAllGroupRequestLinks } from "../../../../../../lib/group-request-links";
import { resolveCurrentNode, absoluteUrl } from "../../../../../../lib/node-context";
import type { FormState, InviteFormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

export async function proposeCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const name = requiredString(formData, "name");
  const description = requiredString(formData, "description");
  const entityRaw = requiredString(formData, "offeringEntityType");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    // entityRaw is either "group" or "project:<projectId>"
    const [entityType, entityId] = entityRaw.startsWith("project:")
      ? ["project" as const, entityRaw.slice("project:".length)]
      : ["group" as const, groupId];
    const result = await proposeContributionCategory(prisma, {
      membershipId: membership.id,
      groupId,
      offeringEntityType: entityType,
      offeringEntityId: entityId,
      name,
      description,
    });
    if (!result.ok) return { kind: "error", message: `Could not open category petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Category proposal opened." };
}

export async function proposeCategoryArchivalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeContributionCategoryArchival(prisma, { membershipId: membership.id, groupId, categoryId });
    if (!result.ok) return { kind: "error", message: `Could not open archival petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Category archival petition opened." };
}

// Accepting/declining custom support requests is collective-wide, so it opens a petition
// rather than flipping the setting on one click (feedback #1).
export async function proposeCustomRequestsToggleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const accepts = formData.get("accepts") === "true";
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeCustomRequestsToggle(prisma, { groupId, createdByMembershipId: membership.id, accepts });
    if (!result.ok) {
      if (result.reason === "already_set") {
        return { kind: "success", message: "Custom requests are already in that state." };
      }
      if (result.reason === "petition_already_open") {
        return { kind: "success", message: "A petition to change custom requests is already open." };
      }
      return { kind: "error", message: "Could not open the petition." };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return {
    kind: "success",
    message: accepts ? "Petition to accept custom requests opened." : "Petition to stop accepting custom requests opened.",
  };
}

// Shareable private request link (feedback #9): generating/revoking is a member action (like
// invite links), not a petition — it doesn't change the group's discoverability and is revocable.
export async function generateRequestLinkAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await generateGroupRequestLink(prisma, { groupId, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "Could not generate a request link." };
    const nodeDomain = (await resolveCurrentNode(prisma))?.domain ?? null;
    const url = absoluteUrl(nodeDomain, (await headers()).get("host"), `/request/${groupId}?k=${result.rawToken}`);
    revalidatePath(`/groups/${groupId}`);
    return { kind: "success", message: "", inviteUrl: url };
  } finally {
    await prisma.$disconnect();
  }
}

export async function revokeRequestLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await revokeAllGroupRequestLinks(prisma, { groupId, membershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "You are not eligible to revoke this request link." };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Request link revoked." };
}
