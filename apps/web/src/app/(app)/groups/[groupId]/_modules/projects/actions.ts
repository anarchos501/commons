"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeProject } from "../../../../../../lib/projects";
import { openProjectHostingWithdrawalPetition } from "../../../../../../lib/project-hosting";
import { requireMembership } from "../_shared/guards";

export async function proposeProjectAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || "";
  if (!name) return;
  const prisma = createPrismaClient();
  try {
    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");
    await proposeProject(prisma, {
      groupId,
      createdByMembershipId: membership.id,
      accountId: session.accountId,
      name,
      description,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function openProjectHostingWithdrawalAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const projectId = requiredString(formData, "projectId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let notice = "Could not open host-withdrawal petition.";
  try {
    const result = await openProjectHostingWithdrawalPetition(prisma, {
      projectId,
      groupId,
      createdByMembershipId: membership.id,
    });
    if (result.ok) notice = "Host-withdrawal petition opened.";
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?notice=${encodeURIComponent(notice)}#projects`);
}
