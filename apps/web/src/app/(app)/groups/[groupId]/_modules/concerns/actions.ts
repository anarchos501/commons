"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { submitMemberConcern } from "../../../../../../lib/concerns";
import { requireGroupMembershipStatus } from "../_shared/guards";

export async function submitConcernAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const subject = requiredString(formData, "subject");
  const description = requiredString(formData, "description");
  const context = formData.get("context") as string | null;
  const subjectMembershipId = (formData.get("subjectMembershipId") as string | null) || null;
  await requireGroupMembershipStatus(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    // Resolve the optional named subject to an accountId, validating it's an active member of THIS group.
    let subjectAccountId: string | null = null;
    if (subjectMembershipId) {
      const subjectMembership = await prisma.groupMembership.findFirst({
        where: { id: subjectMembershipId, groupId, status: "active" },
        select: { accountId: true },
      });
      subjectAccountId = subjectMembership?.accountId ?? null;
    }
    await submitMemberConcern(prisma, {
      groupId,
      reportedByAccountId: session.accountId,
      subject,
      description,
      context: context || null,
      subjectAccountId,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
