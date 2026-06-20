"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { addPetitionSupport, withdrawPetitionSupport, withdrawPetition } from "../../../../../../lib/petitions";
import { evaluateAndApplyPetition } from "../../../../../../lib/petition-evaluation";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

export async function supportPetitionAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await addPetitionSupport(prisma, { petitionId, actorAccountId: session.accountId, membershipId: membership.id });
    await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function withdrawPetitionSupportAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await withdrawPetitionSupport(prisma, { petitionId, actorAccountId: session.accountId, membershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function withdrawPetitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const petitionId = requiredString(formData, "petitionId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let outcome: "withdrawn" | "not_eligible";
  try {
    ({ outcome } = await withdrawPetition(prisma, petitionId, membership.id));
    if (outcome === "withdrawn") await evaluateAndApplyPetition(prisma, petitionId);
  } finally {
    await prisma.$disconnect();
  }
  if (outcome === "not_eligible") {
    return { kind: "error", message: "This petition can no longer be withdrawn — it may have already closed." };
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Petition withdrawn." };
}
