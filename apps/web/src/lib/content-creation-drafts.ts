import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { ContentCreationType, CoordinationSpaceType, CoordinationAbility } from "../generated/prisma/enums";
import { openPetition } from "./petitions";
import { requireApprovedPetition } from "./petitions";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { logAction } from "./action-log";
import type { ProposalFamily } from "./governance-proposal-families";
import { assertProjectWritable } from "./project-membership";
import { assertWithinTransaction } from "./prisma";
import { hasActiveAbility } from "./responsibility-abilities";

const DRAFT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function contentTypeToFamily(contentType: ContentCreationType): ProposalFamily {
  switch (contentType) {
    case "bulletin":           return "bulletin_creation";
    case "publication":        return "publication_creation";
    case "publication_entry":  return "publication_entry_creation";
    case "living_document":    return "living_document_creation";
  }
}

// The coordination ability that governs each content type on the responsibility-acting path.
// living_document has no corresponding ability, so it cannot be proposed "as a responsibility".
function contentTypeToAbility(contentType: ContentCreationType): CoordinationAbility | null {
  switch (contentType) {
    case "bulletin":           return "create_bulletins";
    case "publication":        return "create_publications";
    case "publication_entry":  return "create_publication_entries";
    case "living_document":    return null;
  }
}

export async function proposeContentCreation(
  prisma: PrismaClient,
  opts: {
    contentType: ContentCreationType;
    spaceType: CoordinationSpaceType;
    spaceId: string;
    publicationId?: string;
    groupId: string;
    createdByMembershipId?: string;
    createdByProjectMembershipId?: string;
    // Optional responsibility-acting path: when set, the proposer is acting AS this responsibility
    // and must hold an active seat carrying the matching create_* ability now (emergency-gating
    // respected). Absent → the egalitarian baseline: any active member may propose.
    actingResponsibilityId?: string;
    title?: string;
    body?: string;
  },
): Promise<{ ok: true; draftId: string; petitionId: string } | { ok: false; reason: string }> {
  const hasGroup = !!opts.createdByMembershipId;
  const hasProject = !!opts.createdByProjectMembershipId;
  if (hasGroup === hasProject) {
    return { ok: false, reason: "invalid_proposer" };
  }

  // Validate content-type required fields
  if ((opts.contentType === "bulletin" || opts.contentType === "living_document") && (!opts.title || !opts.body)) {
    return { ok: false, reason: "missing_required_fields" };
  }
  if (opts.contentType === "publication" && !opts.title) {
    return { ok: false, reason: "missing_required_fields" };
  }
  if (opts.contentType === "publication_entry" && (!opts.body || !opts.publicationId)) {
    return { ok: false, reason: "missing_required_fields" };
  }

  let authorAccountId: string;
  let projectId: string | undefined;

  if (hasGroup) {
    const membership = await prisma.groupMembership.findUnique({
      where: { id: opts.createdByMembershipId! },
      select: { accountId: true, groupId: true, status: true, participationStatus: true },
    });
    if (!membership || membership.groupId !== opts.groupId || membership.status !== "active" || membership.participationStatus !== "active") {
      return { ok: false, reason: "not_eligible" };
    }
    authorAccountId = membership.accountId;

    // Responsibility-acting path (F1): only gated when the proposer explicitly acts as a seat.
    // This never restricts the baseline member path — it makes a responsibility's granted
    // create_* ability real, term-bound, and emergency-aware.
    if (opts.actingResponsibilityId) {
      const ability = contentTypeToAbility(opts.contentType);
      if (!ability) return { ok: false, reason: "ability_not_applicable" };
      const allowed = await hasActiveAbility(prisma, opts.createdByMembershipId!, opts.actingResponsibilityId, ability);
      if (!allowed) return { ok: false, reason: "ability_required" };
    }
  } else {
    const membership = await prisma.projectMembership.findUnique({
      where: { id: opts.createdByProjectMembershipId! },
      select: { accountId: true, projectId: true, status: true, participationStatus: true },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      return { ok: false, reason: "not_eligible" };
    }
    authorAccountId = membership.accountId;
    projectId = membership.projectId;
    await assertProjectWritable(prisma, projectId);
  }

  // Validate coordination-space ownership
  try {
    await assertSpaceBelongsToGroup(prisma, opts.spaceType, opts.spaceId, opts.groupId);
  } catch {
    return { ok: false, reason: "space_not_owned" };
  }

  // For publication_entry: verify publication is active and in the same space
  if (opts.contentType === "publication_entry") {
    const pub = await prisma.publication.findUnique({
      where: { id: opts.publicationId! },
      select: { spaceType: true, spaceId: true, archivedAt: true },
    });
    if (!pub) return { ok: false, reason: "publication_not_found" };
    if (pub.archivedAt !== null) return { ok: false, reason: "publication_archived" };
    if (pub.spaceType !== opts.spaceType || pub.spaceId !== opts.spaceId) {
      return { ok: false, reason: "publication_space_mismatch" };
    }
  }

  // Create the draft (with a data-minimization expiry; swept once unapplied + petition resolved)
  const draft = await prisma.contentCreationDraft.create({
    data: {
      contentType: opts.contentType,
      groupId: opts.groupId,
      spaceType: opts.spaceType,
      spaceId: opts.spaceId,
      publicationId: opts.publicationId ?? null,
      authorAccountId,
      createdByMembershipId: opts.createdByMembershipId ?? null,
      createdByProjectMembershipId: opts.createdByProjectMembershipId ?? null,
      title: opts.title ?? null,
      body: opts.body ?? null,
      expiresAt: new Date(Date.now() + DRAFT_EXPIRY_MS),
    },
  });

  // Open petition
  const petitionOpts = hasProject
    ? {
        groupId: opts.groupId,
        category: "publishing" as const,
        subjectType: contentTypeToFamily(opts.contentType),
        subjectId: draft.id,
        createdByProjectMembershipId: opts.createdByProjectMembershipId,
        scopeType: "project" as const,
        scopeId: projectId!,
        voterScope: { type: "project" as const, scopeId: projectId! },
      }
    : {
        groupId: opts.groupId,
        category: "publishing" as const,
        subjectType: contentTypeToFamily(opts.contentType),
        subjectId: draft.id,
        createdByMembershipId: opts.createdByMembershipId,
      };

  let petitionResult;
  try {
    petitionResult = await openPetition(prisma, petitionOpts);
  } catch (err) {
    await prisma.contentCreationDraft.delete({ where: { id: draft.id } });
    throw err;
  }

  if (!petitionResult.ok) {
    await prisma.contentCreationDraft.delete({ where: { id: draft.id } });
    return { ok: false, reason: petitionResult.reason };
  }

  return { ok: true, draftId: draft.id, petitionId: petitionResult.petitionId };
}

export async function applyContentCreationDraft(
  prisma: Prisma.TransactionClient,
  petitionId: string,
  expectedFamily: ProposalFamily,
): Promise<void> {
  assertWithinTransaction(prisma, "applyContentCreationDraft");
  const petition = await requireApprovedPetition(prisma, petitionId, expectedFamily);

  const draft = await prisma.contentCreationDraft.findUniqueOrThrow({
    where: { id: petition.subjectId },
  });

  if (contentTypeToFamily(draft.contentType) !== expectedFamily) {
    throw new Error(`Draft content type "${draft.contentType}" does not match expected family "${expectedFamily}".`);
  }
  if (draft.groupId !== petition.groupId) {
    throw new Error(`Draft groupId "${draft.groupId}" does not match petition groupId "${petition.groupId}".`);
  }

  let createdContentId: string;
  let createdNow = false;
  let appliedDraft = draft;

  // Row-lock the draft to prevent concurrent application
  await prisma.$queryRaw`SELECT id FROM "ContentCreationDraft" WHERE id = ${draft.id} FOR UPDATE`;

  // Re-read draft for idempotency guard
  const lockedDraft = await prisma.contentCreationDraft.findUniqueOrThrow({ where: { id: draft.id } });
  appliedDraft = lockedDraft;

  if (contentTypeToFamily(lockedDraft.contentType) !== expectedFamily) {
    throw new Error(`Draft content type "${lockedDraft.contentType}" does not match expected family "${expectedFamily}".`);
  }
  if (lockedDraft.groupId !== petition.groupId) {
    throw new Error(`Draft groupId "${lockedDraft.groupId}" does not match petition groupId "${petition.groupId}".`);
  }
  if (lockedDraft.spaceType === "project") {
    await assertProjectWritable(prisma, lockedDraft.spaceId);
    if (petition.scopeType !== "project" || petition.scopeId !== lockedDraft.spaceId) {
      throw new Error("Project content petition scope does not match the draft project.");
    }
  } else if (petition.scopeType !== "group" || petition.scopeId !== lockedDraft.groupId) {
    throw new Error("Group-governed content petition scope does not match the draft group.");
  }

  await assertSpaceBelongsToGroup(
    prisma,
    lockedDraft.spaceType,
    lockedDraft.spaceId,
    lockedDraft.groupId,
  );

  if (lockedDraft.appliedAt !== null) {
    createdContentId = lockedDraft.createdContentId!;
  } else {
    const now = new Date();
    let newId: string;

    switch (lockedDraft.contentType) {
      case "bulletin": {
        const record = await prisma.bulletin.create({
          data: {
            spaceType: lockedDraft.spaceType,
            spaceId: lockedDraft.spaceId,
            authorId: lockedDraft.authorAccountId,
            title: lockedDraft.title!,
            body: lockedDraft.body!,
            publishedAt: now,
          },
        });
        newId = record.id;
        break;
      }
      case "publication": {
        const record = await prisma.publication.create({
          data: {
            spaceType: lockedDraft.spaceType,
            spaceId: lockedDraft.spaceId,
            createdByAccountId: lockedDraft.authorAccountId,
            title: lockedDraft.title!,
          },
        });
        newId = record.id;
        break;
      }
      case "publication_entry": {
        const pub = await prisma.publication.findUniqueOrThrow({
          where: { id: lockedDraft.publicationId! },
          select: { archivedAt: true, spaceType: true, spaceId: true },
        });
        if (pub.archivedAt !== null) {
          throw new Error("Cannot create entry for an archived publication.");
        }
        if (pub.spaceType !== lockedDraft.spaceType || pub.spaceId !== lockedDraft.spaceId) {
          throw new Error("Publication no longer belongs to the draft coordination space.");
        }
        const record = await prisma.publicationEntry.create({
          data: {
            publicationId: lockedDraft.publicationId!,
            authorId: lockedDraft.authorAccountId,
            title: lockedDraft.title ?? undefined,
            body: lockedDraft.body!,
            publishedAt: now,
          },
        });
        newId = record.id;
        break;
      }
      case "living_document": {
        const doc = await prisma.livingDocument.create({
          data: {
            spaceType: lockedDraft.spaceType,
            spaceId: lockedDraft.spaceId,
            title: lockedDraft.title!,
            currentBody: lockedDraft.body!,
          },
        });
        await prisma.livingDocumentRevision.create({
          data: {
            livingDocumentId: doc.id,
            authorId: lockedDraft.authorAccountId,
            body: lockedDraft.body!,
            approvedAt: now,
            proposalId: petitionId,
            approvedByAccountId: lockedDraft.authorAccountId,
          },
        });
        newId = doc.id;
        break;
      }
    }

    await prisma.contentCreationDraft.update({
      where: { id: lockedDraft.id },
      data: { appliedAt: now, createdContentId: newId! },
    });

    createdContentId = newId!;
    createdNow = true;
  }

  if (!createdNow) return;

  await logAction(prisma, {
    groupId: petition.groupId,
    projectId: appliedDraft.spaceType === "project" ? appliedDraft.spaceId : null,
    actorAccountId: appliedDraft.authorAccountId,
    action: `${appliedDraft.contentType}.created`,
    targetType: appliedDraft.contentType,
    targetId: createdContentId!,
    metadata: { draftId: appliedDraft.id, petitionId },
  });
}

/**
 * Lazily deletes unapplied content-creation drafts whose petition has resolved and whose expiry
 * has passed — data-minimization hygiene mirroring archiveStalePetitions. NEVER deletes an applied
 * draft (it backs created content) or one whose petition is still open (the proposal is in flight).
 */
export async function expireStaleContentDrafts(
  prisma: PrismaClient,
  groupId: string,
  now: Date = new Date(),
): Promise<void> {
  const candidates = await prisma.contentCreationDraft.findMany({
    where: { groupId, appliedAt: null, expiresAt: { lte: now } },
    select: { id: true },
  });
  if (candidates.length === 0) return;

  const ids = candidates.map((c) => c.id);
  const openPetitions = await prisma.petition.findMany({
    where: { subjectId: { in: ids }, status: "open" },
    select: { subjectId: true },
  });
  const stillOpen = new Set(openPetitions.map((p) => p.subjectId));
  const deletable = ids.filter((id) => !stillOpen.has(id));
  if (deletable.length === 0) return;

  await prisma.contentCreationDraft.deleteMany({ where: { id: { in: deletable } } });
}
