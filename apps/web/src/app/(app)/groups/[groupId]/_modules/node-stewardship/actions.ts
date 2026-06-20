"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { openGroupNoConfidence, openGroupStewardNomination, openStewardResignation } from "../../../../../../lib/node-stewardship";
import { openNodeNameProposal } from "../../../../../../lib/node-name";
import { requireMembership } from "../_shared/guards";

export async function openGroupStewardNominationAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const candidateGroupId = requiredString(formData, "candidateGroupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openGroupStewardNomination(prisma, {
      nodeId,
      initiatingGroupId: groupId,
      candidateGroupId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function openGroupNoConfidenceAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openGroupNoConfidence(prisma, {
      nodeId,
      initiatingGroupId: groupId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function openStewardResignationAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const nodeId = requiredString(formData, "nodeId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openStewardResignation(prisma, {
      nodeId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function proposeNodeNameAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const nodeId = formData.get("nodeId") as string;
  const proposedName = (formData.get("proposedName") as string) ?? "";
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await openNodeNameProposal(prisma, { nodeId, initiatingGroupId: groupId, proposedName, createdByMembershipId: membership.id });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
