"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeContributionCategory, proposeContributionCategoryArchival } from "../../../../../../lib/contribution-categories";
import type { FormState } from "../../../../../../components/shared/form-state";
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

export async function toggleCustomRequestsAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const accepts = formData.get("accepts") === "true";
  await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await prisma.group.update({ where: { id: groupId }, data: { acceptsCustomRequests: accepts } });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
