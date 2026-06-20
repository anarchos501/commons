"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { resignAssignment, volunteerForResponsibility, proposeResponsibilityRecall } from "../../../../../../lib/responsibilities";
import { proposeResponsibility, PROPOSABLE_RESPONSIBILITY_ABILITIES } from "../../../../../../lib/responsibility-proposals";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

function responsibilityProposalFailureMessage(reason: string) {
  switch (reason) {
    case "invalid_type": return "Give this responsibility a name (up to 64 characters).";
    case "invalid_description": return "Describe the purpose of this responsibility (up to 500 characters).";
    case "invalid_ability": return "One of the selected abilities is not valid.";
    case "no_abilities": return "Select at least one ability for this responsibility.";
    case "not_eligible": return "You are not eligible to propose a new responsibility.";
    case "duplicate_type": return "A responsibility with that name already exists.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
}

export async function proposeResponsibilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const description = requiredString(formData, "description");
  const abilities = PROPOSABLE_RESPONSIBILITY_ABILITIES.filter(
    ({ ability }) => formData.get(`ability_${ability}`) === "on",
  ).map(({ ability }) => ({
    ability,
    availability: (formData.get(`availability_${ability}`) as string) || "always_available",
  }));
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membership.id,
      type,
      description,
      abilities,
    });
    if (!result.ok) return { kind: "error", message: responsibilityProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Responsibility proposed — check Petitions." };
}

export async function volunteerForResponsibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await volunteerForResponsibility(prisma, { membershipId: membership.id, type });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function recallResponsibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const assignmentId = requiredString(formData, "assignmentId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await proposeResponsibilityRecall(prisma, { assignmentId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function resignResponsibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const type = requiredString(formData, "type");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await resignAssignment(prisma, membership.id, type);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
