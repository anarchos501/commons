"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { sponsorMembershipApplication, dismissMembershipApplication } from "../../../../../../lib/group-membership";
import { generateGroupInviteToken, revokeAllGroupInviteTokens } from "../../../../../../lib/group-invites";
import { resolveCurrentNode, absoluteUrl } from "../../../../../../lib/node-context";
import type { FormState, InviteFormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

export async function sponsorApplicationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const pendingMembershipId = formData.get("pendingMembershipId") as string;
  const prisma = createPrismaClient();
  try {
    const sponsor = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!sponsor) redirect("/dashboard");
    const result = await sponsorMembershipApplication(prisma, sponsor.id, pendingMembershipId);
    revalidatePath(`/groups/${groupId}`);
    if (result.ok) return { kind: "success", message: "Sponsorship petition opened." };
    if (result.reason === "already_open") {
      return { kind: "success", message: "A sponsorship petition for this applicant is already open." };
    }
    return { kind: "error", message: "This sponsorship could not be submitted." };
  } finally {
    await prisma.$disconnect();
  }
}

export async function dismissApplicationAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const pendingMembershipId = formData.get("pendingMembershipId") as string;
  const prisma = createPrismaClient();
  try {
    const dismisser = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId: session.accountId, groupId } },
      select: { id: true },
    });
    if (!dismisser) redirect("/dashboard");
    await dismissMembershipApplication(prisma, pendingMembershipId, dismisser.id);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function generateInviteLinkAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await generateGroupInviteToken(prisma, { groupId, createdByMembershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "Could not generate invite link." };
    revalidatePath(`/groups/${groupId}`);
    const hdrList = await headers();
    // Prefer the node's canonical domain over the request Host (proxy-mangled to localhost in prod).
    const nodeDomain = (await resolveCurrentNode(prisma))?.domain ?? null;
    return { kind: "success", message: "", inviteUrl: absoluteUrl(nodeDomain, hdrList.get("host"), `/invite/${result.rawToken}`) };
  } finally {
    await prisma.$disconnect();
  }
}

export async function revokeInviteLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await revokeAllGroupInviteTokens(prisma, { groupId, membershipId: membership.id });
    if (!result.ok) return { kind: "error", message: "You are not eligible to revoke this invite link." };
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Invite link revoked." };
}
