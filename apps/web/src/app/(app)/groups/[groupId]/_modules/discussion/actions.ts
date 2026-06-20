"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { createDiscussionThread, openThreadClosurePetition, postDiscussionMessage } from "../../../../../../lib/discussions";
import type { FormState, ThreadFormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

function discussionPetitionFailureNotice(reason: string) {
  switch (reason) {
    case "creator_not_eligible": return "Only active members can propose closing a discussion thread.";
    case "petition_already_open": return "A closure petition is already open for this discussion thread.";
    default: return "This discussion closure petition could not be opened.";
  }
}

export async function createDiscussionThreadAction(
  _prev: ThreadFormState,
  formData: FormData,
): Promise<ThreadFormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const title = requiredString(formData, "title");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  let threadId: string;
  try {
    const thread = await createDiscussionThread(prisma, {
      spaceType: "group",
      spaceId: groupId,
      groupId,
      createdByMembershipId: membership.id,
      title,
    });
    threadId = thread.id;
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "", threadId };
}

export async function postDiscussionMessageAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const threadId = requiredString(formData, "threadId");
  const body = requiredString(formData, "body");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    await postDiscussionMessage(prisma, { threadId, groupId, authorMembershipId: membership.id, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function openThreadClosurePetitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const threadId = requiredString(formData, "threadId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await openThreadClosurePetition(prisma, { threadId, groupId, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: discussionPetitionFailureNotice(result.reason) };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Closure petition opened." };
}
