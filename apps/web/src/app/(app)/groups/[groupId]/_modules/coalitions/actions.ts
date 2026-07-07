"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { openCoalitionFormationProposal, openCoalitionJoinProposal } from "../../../../../../lib/coalitions";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

function coalitionProposalFailureMessage(reason: string) {
  switch (reason) {
    case "invalid_participants": return "Select at least two distinct, eligible groups on the same node.";
    case "not_eligible": return "Every sponsoring group requires an active, active-participation member to consent.";
    case "not_found": return "This coalition could not be found.";
    case "already_member": return "That collective already belongs to this coalition.";
    case "not_member": return "That collective is not currently a member of this coalition.";
    case "duplicate_name": return "A coalition with that name already exists on this node.";
    case "petition_error": return "This proposal could not be submitted.";
    default: return "This proposal could not be submitted.";
  }
}

export async function proposeCoalitionFormationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const name = requiredString(formData, "name");
  const description = (formData.get("description") as string | null) ?? "";
  const content = requiredString(formData, "content");
  const partnerGroupIds = formData.getAll("partnerGroupId").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (partnerGroupIds.length === 0) {
    return { kind: "error", message: "Select at least one partner collective to invite into the coalition." };
  }

  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await openCoalitionFormationProposal(prisma, {
      name,
      description: description.trim() || null,
      content,
      participants: [
        { groupId, createdByMembershipId: membership.id },
        ...partnerGroupIds.map((partnerGroupId) => ({ groupId: partnerGroupId })),
      ],
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Coalition formation proposal opened — each collective's members will decide through their own petition." };
}

export async function proposeCoalitionJoinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const coalitionId = requiredString(formData, "coalitionId");
  const content = requiredString(formData, "content");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const coalition = await prisma.coalition.findUnique({
      where: { id: coalitionId },
      // Local member groups only (cross-node members have null groupId, F3).
      select: { memberships: { where: { endedAt: null, groupId: { not: null } }, select: { groupId: true } } },
    });
    if (!coalition) return { kind: "error", message: coalitionProposalFailureMessage("not_found") };
    const result = await openCoalitionJoinProposal(prisma, {
      coalitionId,
      applicant: { groupId, createdByMembershipId: membership.id },
      memberSponsors: coalition.memberships.flatMap((member) => (member.groupId ? [{ groupId: member.groupId }] : [])),
      content,
    });
    if (!result.ok) return { kind: "error", message: coalitionProposalFailureMessage(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Join proposal opened. Every participating collective will decide independently." };
}
