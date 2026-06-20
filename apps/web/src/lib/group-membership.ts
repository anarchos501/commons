import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { logAction } from "./action-log";
import { openPetition, withdrawPetitionBySubject } from "./petitions";

export async function requireGroupMembership(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { status: true },
  });

  if (!membership || membership.status !== "active") {
    throw new Error("Active group membership required.");
  }
}

export async function joinOpenGroup(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<{ groupId: string }> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { membershipPolicy: true },
  });

  if (!group) throw new Error("Group not found.");
  if (group.membershipPolicy !== "open") throw new Error("This group is not open to join.");

  const existingMembership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { status: true },
  });

  if (existingMembership?.status === "revoked") {
    throw new Error("Revoked memberships cannot be reactivated through open join.");
  }

  if (existingMembership?.status === "pending") {
    throw new Error("Pending memberships cannot be activated through open join.");
  }

  if (existingMembership?.status !== "active") {
    const membership = await prisma.groupMembership.upsert({
      where: { accountId_groupId: { accountId, groupId } },
      update: { status: "active" },
      create: { accountId, groupId, status: "active" },
    });

    // A new active member revives a previously-defunct (archived) group.
    await prisma.group.updateMany({ where: { id: groupId, archivedAt: { not: null } }, data: { archivedAt: null } });

    await logAction(prisma, {
      actorAccountId: accountId,
      groupId,
      action: "membership.joined",
      targetType: "group_membership",
      targetId: membership.id,
    });
  }

  return { groupId };
}

// ── Membership application + sponsor flow ─────────────────────────────────────

export type ApplyForGroupResult =
  | { ok: true; membershipId: string }
  | { ok: false; reason: "group_not_found" | "already_member" | "already_applied" | "revoked" };

/**
 * Non-member submits an application to join a non-open group.
 * Creates a GroupMembership with status="pending".
 * Active group members will see this and can sponsor or dismiss it.
 */
export async function applyForGroupMembership(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
  note?: string,
): Promise<ApplyForGroupResult> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { membershipPolicy: true },
  });
  if (!group) return { ok: false, reason: "group_not_found" };

  const existing = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { status: true },
  });

  if (existing?.status === "active") return { ok: false, reason: "already_member" };
  if (existing?.status === "pending") return { ok: false, reason: "already_applied" };
  if (existing?.status === "revoked") return { ok: false, reason: "revoked" };

  // existing is "inactive" (a previous member who left) or no row at all. Upsert to "pending"
  // so re-applying after leaving reactivates the row instead of hitting the
  // @@unique([accountId, groupId]) constraint on create.
  const membership = await prisma.groupMembership.upsert({
    where: { accountId_groupId: { accountId, groupId } },
    update: { status: "pending", applicationNote: note ?? null },
    create: { accountId, groupId, status: "pending", ...(note ? { applicationNote: note } : {}) },
  });

  return { ok: true, membershipId: membership.id };
}

export type SponsorApplicationResult =
  | { ok: true; petitionId: string }
  | { ok: false; reason: "application_not_found" | "sponsor_not_eligible" | "already_open" | "petition_error" };

/**
 * Active group member sponsors a pending membership application.
 * Opens a membership_request petition; approval activates the applicant's membership.
 */
export async function sponsorMembershipApplication(
  prisma: PrismaClient,
  sponsorMembershipId: string,
  pendingMembershipId: string,
): Promise<SponsorApplicationResult> {
  const sponsor = await prisma.groupMembership.findUnique({
    where: { id: sponsorMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  if (!sponsor || sponsor.status !== "active" || sponsor.participationStatus !== "active") {
    return { ok: false, reason: "sponsor_not_eligible" };
  }

  const application = await prisma.groupMembership.findUnique({
    where: { id: pendingMembershipId },
    select: { groupId: true, status: true },
  });
  if (!application || application.groupId !== sponsor.groupId || application.status !== "pending") {
    return { ok: false, reason: "application_not_found" };
  }

  const result = await openPetition(prisma, {
    groupId: sponsor.groupId,
    category: "membership",
    subjectType: "membership_request",
    subjectId: pendingMembershipId,
    createdByMembershipId: sponsorMembershipId,
  });

  if (!result.ok) {
    // A sponsorship petition for this applicant is already open (enforced by the
    // Petition_membership_request_open_unique index — prevents double-click duplicates).
    if (result.reason === "petition_already_open") return { ok: false, reason: "already_open" };
    return { ok: false, reason: "petition_error" };
  }
  return { ok: true, petitionId: result.petitionId };
}

/**
 * Called when a membership_request petition is approved.
 * Activates the pending GroupMembership.
 */
export async function approveMembershipRequest(
  prisma: Prisma.TransactionClient,
  pendingMembershipId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.findUnique({
    where: { id: pendingMembershipId },
    select: { id: true, accountId: true, groupId: true, status: true },
  });
  if (!membership || membership.status !== "pending") return;

  await prisma.groupMembership.update({
    where: { id: pendingMembershipId },
    data: { status: "active", decidedAt: new Date() },
  });

  await logAction(prisma, {
    actorAccountId: membership.accountId,
    groupId: membership.groupId,
    action: "membership.joined",
    targetType: "group_membership",
    targetId: membership.id,
  });
}

export async function dismissMembershipApplication(
  prisma: PrismaClient,
  pendingMembershipId: string,
  dismissedByMembershipId: string,
): Promise<void> {
  const dismisser = await prisma.groupMembership.findUnique({
    where: { id: dismissedByMembershipId },
    select: { groupId: true, status: true, participationStatus: true },
  });
  const application = await prisma.groupMembership.findUnique({
    where: { id: pendingMembershipId },
    select: { groupId: true, status: true },
  });
  if (
    !dismisser || !application ||
    dismisser.groupId !== application.groupId ||
    dismisser.status !== "active" ||
    dismisser.participationStatus !== "active" ||
    application.status !== "pending"
  ) return;

  await prisma.groupMembership.update({
    where: { id: pendingMembershipId },
    data: { status: "inactive", decidedAt: new Date() },
  });
}

/**
 * An applicant withdraws their own pending group application: deactivates the pending row and
 * withdraws any open membership_request petition a member may have opened to sponsor it.
 */
export async function withdrawGroupApplication(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<{ ok: boolean }> {
  const membership = await prisma.groupMembership.findUnique({
    where: { accountId_groupId: { accountId, groupId } },
    select: { id: true, status: true },
  });
  if (!membership || membership.status !== "pending") return { ok: false };

  await withdrawPetitionBySubject(prisma, { subjectType: "membership_request", subjectId: membership.id });
  await prisma.groupMembership.update({ where: { id: membership.id }, data: { status: "inactive" } });
  await logAction(prisma, {
    actorAccountId: accountId,
    groupId,
    action: "membership.application_withdrawn",
    targetType: "group_membership",
    targetId: membership.id,
  });
  return { ok: true };
}

export async function leaveGroup(
  prisma: PrismaClient,
  accountId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMembership.update({
    where: { accountId_groupId: { accountId, groupId } },
    data: { status: "inactive" },
  });

  await logAction(prisma, {
    actorAccountId: accountId,
    groupId,
    action: "membership.left",
    targetType: "group_membership",
    targetId: membership.id,
  });

  await archiveGroupIfDefunct(prisma, groupId);
}

/**
 * Marks a group archived once it has no active members left. Archived groups are hidden everywhere
 * (find-collectives, support, steward/coalition candidate lists). The archivedAt timestamp starts a
 * grace window for eventual hard deletion (deletion itself is deferred — see roadmap — because Group
 * has ~40 child relations without DB-level cascade, so a destructive purge is its own piece of work).
 */
export async function archiveGroupIfDefunct(prisma: PrismaClient, groupId: string): Promise<void> {
  const activeCount = await prisma.groupMembership.count({ where: { groupId, status: "active" } });
  if (activeCount === 0) {
    await prisma.group.updateMany({ where: { id: groupId, archivedAt: null }, data: { archivedAt: new Date() } });
  }
}
