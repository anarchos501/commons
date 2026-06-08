import type { PrismaClient } from "../generated/prisma/client";
import type { ContentCreationType, CoordinationSpaceType } from "../generated/prisma/enums";
import { openPetition } from "./petitions";
import { requireApprovedPetition } from "./petitions";
import { assertSpaceBelongsToGroup } from "./governance-ownership";
import { logAction } from "./action-log";
import type { ProposalFamily } from "./governance-proposal-families";
import { assertProjectWritable } from "./project-membership";

function contentTypeToFamily(contentType: ContentCreationType): ProposalFamily {
  switch (contentType) {
    case "bulletin":           return "bulletin_creation";
    case "publication":        return "publication_creation";
    case "publication_entry":  return "publication_entry_creation";
    case "living_document":    return "living_document_creation";
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
  } else {
    const membership = await prisma.projectMembership.findUnique({
      where: { id: opts.createdByProjectMembershipId! },
      select: { accountId: true, projectId: true, status: true, participationStatus: true, project: { select: { foundingGroupId: true } } },
    });
    if (!membership || membership.status !== "active" || membership.participationStatus !== "active") {
      return { ok: false, reason: "not_eligible" };
    }
    if (membership.project.foundingGroupId !== opts.groupId) {
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

  // Create the draft
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
  prisma: PrismaClient,
  petitionId: string,
  expectedFamily: ProposalFamily,
): Promise<void> {
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

  await prisma.$transaction(async (tx) => {
    // Row-lock the draft to prevent concurrent application
    await tx.$queryRaw`SELECT id FROM "ContentCreationDraft" WHERE id = ${draft.id} FOR UPDATE`;

    // Re-read draft inside transaction for idempotency guard
    const lockedDraft = await tx.contentCreationDraft.findUniqueOrThrow({ where: { id: draft.id } });
    appliedDraft = lockedDraft;

    if (contentTypeToFamily(lockedDraft.contentType) !== expectedFamily) {
      throw new Error(`Draft content type "${lockedDraft.contentType}" does not match expected family "${expectedFamily}".`);
    }
    if (lockedDraft.groupId !== petition.groupId) {
      throw new Error(`Draft groupId "${lockedDraft.groupId}" does not match petition groupId "${petition.groupId}".`);
    }
    if (lockedDraft.spaceType === "project") {
      await assertProjectWritable(tx as unknown as PrismaClient, lockedDraft.spaceId);
      if (petition.scopeType !== "project" || petition.scopeId !== lockedDraft.spaceId) {
        throw new Error("Project content petition scope does not match the draft project.");
      }
    } else if (petition.scopeType !== "group" || petition.scopeId !== lockedDraft.groupId) {
      throw new Error("Group-governed content petition scope does not match the draft group.");
    }

    await assertSpaceBelongsToGroup(
      tx,
      lockedDraft.spaceType,
      lockedDraft.spaceId,
      lockedDraft.groupId,
    );

    if (lockedDraft.appliedAt !== null) {
      createdContentId = lockedDraft.createdContentId!;
      return;
    }

    const now = new Date();
    let newId: string;

    switch (lockedDraft.contentType) {
      case "bulletin": {
        const record = await tx.bulletin.create({
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
        const record = await tx.publication.create({
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
        const pub = await tx.publication.findUniqueOrThrow({
          where: { id: lockedDraft.publicationId! },
          select: { archivedAt: true, spaceType: true, spaceId: true },
        });
        if (pub.archivedAt !== null) {
          throw new Error("Cannot create entry for an archived publication.");
        }
        if (pub.spaceType !== lockedDraft.spaceType || pub.spaceId !== lockedDraft.spaceId) {
          throw new Error("Publication no longer belongs to the draft coordination space.");
        }
        const record = await tx.publicationEntry.create({
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
        const doc = await tx.livingDocument.create({
          data: {
            spaceType: lockedDraft.spaceType,
            spaceId: lockedDraft.spaceId,
            title: lockedDraft.title!,
            currentBody: lockedDraft.body!,
          },
        });
        await tx.livingDocumentRevision.create({
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

    await tx.contentCreationDraft.update({
      where: { id: lockedDraft.id },
      data: { appliedAt: now, createdContentId: newId! },
    });

    createdContentId = newId!;
    createdNow = true;
  });

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
