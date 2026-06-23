"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { openEmergencyPetition } from "../../../../../../lib/emergency";
import { proposeGroupVisibility, proposeMembershipPolicyChange } from "../../../../../../lib/group-settings";
import { upsertGovernanceSignal } from "../../../../../../lib/governance-temperature";
import type { GovernanceCategory } from "../../../../../../lib/governance-categories";
import { requireMembership } from "../_shared/guards";

function governanceSignalFailureNotice(reason: string) {
  switch (reason) {
    case "cooldown": return "Governance signal changes are limited for a short cooldown window.";
    case "invalid_signal": return "That governance signal value is not valid.";
    case "invalid_category": return "That governance category is not valid.";
    case "invalid_parameter": return "That governance characteristic is not valid.";
    case "membership_group_mismatch": return "That membership does not belong to this collective.";
    default: return "That governance signal could not be saved.";
  }
}

export async function declareEmergencyAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openEmergencyPetition(prisma, { groupId, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function proposeGroupVisibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const target = formData.get("target") === "private" ? "private" : "public";
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await proposeGroupVisibility(prisma, { groupId, createdByMembershipId: membership.id, target });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function proposeMembershipPolicyChangeAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const target = formData.get("target") === "open" ? "open" : "request_required";
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await proposeMembershipPolicyChange(prisma, { groupId, createdByMembershipId: membership.id, target });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

// Full active participation required — for content creation, petitions, governance signals.
export async function updateGovernanceSignalAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const category = requiredString(formData, "category") as GovernanceCategory;
  const parameterRaw = formData.get("parameter");
  const parameter = typeof parameterRaw === "string" && parameterRaw.length > 0 ? parameterRaw : "_";
  const signalRaw = formData.get("signal");
  const signal = signalRaw === "-1" ? -1 : signalRaw === "1" ? 1 : 0;
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let error: string | null = null;
  try {
    const result = await upsertGovernanceSignal(prisma, { membershipId: membership.id, groupId, category, parameter, signal });
    if (!result.ok) error = governanceSignalFailureNotice(result.reason);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return error;
}
