"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeTrustedProviderStatus, proposeTrustedProviderRevocation } from "../../../../../../lib/trusted-providers";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "./guards";

export async function proposeTrustedProviderStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const categoryId = requiredString(formData, "categoryId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeTrustedProviderStatus(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      categoryIds: [categoryId],
    });
    if (!result.ok) return { kind: "error", message: `Could not open trusted provider petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Trusted provider petition opened." };
}

export async function proposeTrustedProviderRevocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const targetMembershipId = requiredString(formData, "targetMembershipId");
  const statusIdsRaw = formData.get("statusIds");
  const statusIds = typeof statusIdsRaw === "string" ? statusIdsRaw.split(",").filter(Boolean) : [];
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeTrustedProviderRevocation(prisma, {
      requestingMembershipId: membership.id,
      targetMembershipId,
      groupId,
      statusIds,
    });
    if (!result.ok) return { kind: "error", message: `Could not open revocation petition: ${result.reason}.` };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Revocation petition opened." };
}
