import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { CoordinationAbility, AbilityAvailability } from "../generated/prisma/enums";
import { openPetition, requireApprovedPetition } from "./petitions";
import { logAction } from "./action-log";
import { assertWithinTransaction } from "./prisma";

const MAX_TYPE_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Curated allowlist of abilities a member may grant when proposing a new responsibility.
 *
 * Every ability offered here now gates real behavior on the responsibility-acting path (F1),
 * so the toggles are no longer decorative. accountability/gatekeeping abilities
 * (approve_membership, review_concerns, issue_findings, issue_action_proposals,
 * administrative_closure) are still excluded — review_concerns et al. are auto-provisioned on
 * the Concern Reviewer role (concern-reviewer.ts), and approve_membership has no consented
 * delegation path yet (F1.4).
 *
 * issue_support_requests / issue_contribution_offers are also excluded: their underlying flows
 * are egalitarian/guest-facing and not gated, so offering them here would imply a scope they do
 * not enforce (the "illusory scoping" this work set out to remove). Re-add them only once an
 * opt-in, recallable delegation path exists (F1.4).
 */
export const PROPOSABLE_RESPONSIBILITY_ABILITIES: { ability: CoordinationAbility; label: string }[] = [
  { ability: CoordinationAbility.create_bulletins, label: "Create bulletins" },
  { ability: CoordinationAbility.create_publications, label: "Create publications" },
  { ability: CoordinationAbility.create_publication_entries, label: "Create publication entries" },
  { ability: CoordinationAbility.create_projects, label: "Create projects" },
  { ability: CoordinationAbility.create_contribution_categories, label: "Create contribution categories" },
];

const PROPOSABLE_ABILITY_SET = new Set<CoordinationAbility>(
  PROPOSABLE_RESPONSIBILITY_ABILITIES.map((entry) => entry.ability),
);

const AVAILABILITY_VALUES = new Set<string>(Object.values(AbilityAvailability));

export type ProposedAbility = { ability: CoordinationAbility; availability: AbilityAvailability };

export type ProposeResponsibilityResult =
  | { ok: true; draftId: string; petitionId: string }
  | {
      ok: false;
      reason:
        | "invalid_type"
        | "invalid_description"
        | "invalid_ability"
        | "no_abilities"
        | "not_eligible"
        | "duplicate_type"
        | "petition_error";
    };

function isProposedAbility(value: unknown): value is { ability: string; availability: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ability === "string" && typeof record.availability === "string";
}

function normalizeProposedAbilities(abilities: { ability: string; availability: string }[]): ProposedAbility[] | null {
  // Fail closed: every raw entry must name an allowlisted ability and a valid
  // availability mode before we trust any of them.
  for (const raw of abilities) {
    if (!PROPOSABLE_ABILITY_SET.has(raw.ability as CoordinationAbility) || !AVAILABILITY_VALUES.has(raw.availability)) {
      return null;
    }
  }

  // De-duplicate by ability, keeping the first occurrence (first-write-wins).
  const seen = new Set<CoordinationAbility>();
  const normalizedAbilities: ProposedAbility[] = [];
  for (const raw of abilities) {
    const ability = raw.ability as CoordinationAbility;
    if (seen.has(ability)) continue;
    seen.add(ability);
    normalizedAbilities.push({ ability, availability: raw.availability as AbilityAvailability });
  }

  return normalizedAbilities;
}

function parseStoredProposedAbilities(value: unknown): ProposedAbility[] {
  if (!Array.isArray(value) || !value.every(isProposedAbility)) {
    throw new Error("Responsibility proposal draft has invalid abilities.");
  }
  const normalized = normalizeProposedAbilities(value);
  if (!normalized || normalized.length === 0) {
    throw new Error("Responsibility proposal draft has no valid abilities.");
  }
  return normalized;
}

async function ensurePurposeDocument(
  tx: Prisma.TransactionClient,
  {
    responsibilityId,
    descriptionDocumentId,
    description,
    actorAccountId,
    petitionId,
    now,
  }: {
    responsibilityId: string;
    descriptionDocumentId: string | null;
    description: string;
    actorAccountId: string;
    petitionId: string;
    now: Date;
  },
): Promise<void> {
  if (descriptionDocumentId) return;

  const doc = await tx.livingDocument.upsert({
    where: {
      spaceType_spaceId_title: {
        spaceType: "responsibility",
        spaceId: responsibilityId,
        title: "Purpose",
      },
    },
    update: {},
    create: {
      spaceType: "responsibility",
      spaceId: responsibilityId,
      title: "Purpose",
      currentBody: description,
    },
    select: { id: true },
  });

  const revisionCount = await tx.livingDocumentRevision.count({
    where: { livingDocumentId: doc.id },
  });
  if (revisionCount === 0) {
    await tx.livingDocumentRevision.create({
      data: {
        livingDocumentId: doc.id,
        authorId: actorAccountId,
        body: description,
        approvedAt: now,
        approvedByAccountId: actorAccountId,
        proposalId: petitionId,
      },
    });
  }

  await tx.responsibility.update({
    where: { id: responsibilityId },
    data: { descriptionDocumentId: doc.id },
  });
}

/**
 * Active group member proposes creation of a new responsibility, naming its
 * purpose and the coordination abilities it should grant. Opens a
 * responsibility_creation_proposal petition with a ResponsibilityProposalDraft
 * as the subject. On approval, createResponsibilityFromProposal() creates the
 * Responsibility (and its Purpose living document, the first time the type is
 * created) and grants the proposed abilities.
 */
export async function proposeResponsibility(
  prisma: PrismaClient,
  {
    groupId,
    createdByMembershipId,
    type,
    description,
    abilities,
  }: {
    groupId: string;
    createdByMembershipId: string;
    type: string;
    description: string;
    abilities: { ability: string; availability: string }[];
  },
): Promise<ProposeResponsibilityResult> {
  const normalizedType = type.trim();
  if (normalizedType.length === 0 || normalizedType.length > MAX_TYPE_LENGTH) {
    return { ok: false, reason: "invalid_type" };
  }

  const normalizedDescription = description.trim();
  if (normalizedDescription.length === 0 || normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, reason: "invalid_description" };
  }

  const normalizedAbilities = normalizeProposedAbilities(abilities);
  if (!normalizedAbilities) return { ok: false, reason: "invalid_ability" };
  if (normalizedAbilities.length === 0) {
    return { ok: false, reason: "no_abilities" };
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { id: createdByMembershipId },
    select: { groupId: true, status: true, participationStatus: true, accountId: true },
  });
  if (
    !membership ||
    membership.groupId !== groupId ||
    membership.status !== "active" ||
    membership.participationStatus !== "active"
  ) {
    return { ok: false, reason: "not_eligible" };
  }
  const actorAccountId = membership.accountId;

  const existing = await prisma.responsibility.findFirst({
    where: { groupId, type: { equals: normalizedType, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, reason: "duplicate_type" };
  }

  const draft = await prisma.responsibilityProposalDraft.create({
    data: {
      groupId,
      type: normalizedType,
      description: normalizedDescription,
      abilities: normalizedAbilities,
      proposedByMembershipId: createdByMembershipId,
    },
  });

  const result = await openPetition(prisma, {
    groupId,
    category: "responsibility",
    subjectType: "responsibility_creation_proposal",
    subjectId: draft.id,
    createdByMembershipId,
  });

  if (!result.ok) {
    await prisma.responsibilityProposalDraft.delete({ where: { id: draft.id } });
    return { ok: false, reason: "petition_error" };
  }

  await logAction(prisma, {
    groupId,
    actorAccountId,
    action: "responsibility_proposal.created",
    targetType: "responsibility_proposal_draft",
    targetId: draft.id,
    metadata: { type: normalizedType, petitionId: result.petitionId },
  });

  return { ok: true, draftId: draft.id, petitionId: result.petitionId };
}

/**
 * Called when a responsibility_creation_proposal petition is approved.
 *
 * Concurrent proposals whose types differ only in case (e.g. "Reviewer" /
 * "reviewer") must converge onto a single Responsibility — the application
 * takes a Postgres advisory lock keyed on the normalized identity so that
 * convergence is deterministic regardless of apply order:
 *   - The first-applying proposal creates the Responsibility and seeds its
 *     "Purpose" living document from this proposal's description.
 *   - Every later proposal for the same normalized type augments the existing
 *     Responsibility (unioning abilities) and never creates or touches a
 *     living document — both petitions were independently community-approved,
 *     so converging onto one role with the union of approved grants is the
 *     correct reading of "the community said yes to both."
 *
 * Idempotent: re-evaluating an already-applied petition is a no-op.
 */
export async function createResponsibilityFromProposal(prisma: Prisma.TransactionClient, petitionId: string): Promise<void> {
  assertWithinTransaction(prisma, "createResponsibilityFromProposal");
  const petition = await requireApprovedPetition(prisma, petitionId, "responsibility_creation_proposal");

  const draft = await prisma.responsibilityProposalDraft.findUniqueOrThrow({
    where: { id: petition.subjectId },
    include: { membership: { select: { accountId: true, groupId: true } } },
  });
  if (petition.scopeType !== "group" || petition.scopeId !== draft.groupId || petition.groupId !== draft.groupId) {
    throw new Error("Responsibility proposal petition scope does not match the draft group.");
  }
  if (draft.membership.groupId !== draft.groupId || draft.proposedByMembershipId !== petition.createdByMembershipId) {
    throw new Error("Responsibility proposal draft proposer does not match the petition creator.");
  }
  const actorAccountId = draft.membership.accountId;
  const groupId = petition.groupId;
  const normalizedType = draft.type;
  parseStoredProposedAbilities(draft.abilities);

  let appliedNow = false;
  let outcome: "created" | "augmented" = "created";
  let responsibilityId: string;

  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${groupId}:${normalizedType.toLowerCase()}`}, 0))`;

  // Row-lock and re-read the draft to guard against duplicate application.
  await prisma.$queryRaw`SELECT id FROM "ResponsibilityProposalDraft" WHERE id = ${draft.id} FOR UPDATE`;
  const lockedDraft = await prisma.responsibilityProposalDraft.findUniqueOrThrow({ where: { id: draft.id } });
  if (
    lockedDraft.groupId !== groupId ||
    lockedDraft.type !== normalizedType ||
    lockedDraft.proposedByMembershipId !== petition.createdByMembershipId
  ) {
    throw new Error("Responsibility proposal draft no longer matches the approved petition.");
  }

  if (lockedDraft.appliedAt !== null) {
    responsibilityId = lockedDraft.appliedResponsibilityId!;
  } else {
    const now = new Date();
    const proposedAbilities = parseStoredProposedAbilities(lockedDraft.abilities);

    const existingResponsibility = await prisma.responsibility.findFirst({
      where: { groupId, type: { equals: normalizedType, mode: "insensitive" } },
      select: { id: true, descriptionDocumentId: true },
    });

    let targetResponsibilityId: string;
    let targetDescriptionDocumentId: string | null;
    if (!existingResponsibility) {
      outcome = "created";
      const created = await prisma.responsibility.create({
        data: { groupId, type: normalizedType },
      });
      targetResponsibilityId = created.id;
      targetDescriptionDocumentId = created.descriptionDocumentId;

    } else {
      outcome = "augmented";
      targetResponsibilityId = existingResponsibility.id;
      targetDescriptionDocumentId = existingResponsibility.descriptionDocumentId;
    }

    // First purpose wins. Sibling proposals never revise an existing Purpose,
    // but an approved proposal may seed one on a bare responsibility created
    // concurrently through the legacy volunteer path.
    await ensurePurposeDocument(prisma, {
      responsibilityId: targetResponsibilityId,
      descriptionDocumentId: targetDescriptionDocumentId,
      description: lockedDraft.description,
      actorAccountId,
      petitionId,
      now,
    });

    // Union abilities with deterministic precedence: always_available always wins.
    // The community independently approved each grant; broadening is safe to
    // apply unilaterally, narrowing an affirmative "works outside emergencies
    // too" decision back down is not.
    for (const incoming of proposedAbilities) {
      const existingAbility = await prisma.responsibilityAbility.findUnique({
        where: { responsibilityId_ability: { responsibilityId: targetResponsibilityId, ability: incoming.ability } },
      });
      const finalAvailability: AbilityAvailability =
        existingAbility?.availability === "always_available" || incoming.availability === "always_available"
          ? "always_available"
          : "available_during_emergency";
      await prisma.responsibilityAbility.upsert({
        where: { responsibilityId_ability: { responsibilityId: targetResponsibilityId, ability: incoming.ability } },
        update: { availability: finalAvailability },
        create: { responsibilityId: targetResponsibilityId, ability: incoming.ability, availability: finalAvailability },
      });
    }

    await prisma.responsibilityProposalDraft.update({
      where: { id: lockedDraft.id },
      data: { appliedAt: now, appliedResponsibilityId: targetResponsibilityId },
    });

    responsibilityId = targetResponsibilityId;
    appliedNow = true;
  }

  if (!appliedNow) return;

  await logAction(prisma, {
    groupId,
    actorAccountId,
    action: outcome === "created" ? "responsibility.created" : "responsibility.augmented",
    targetType: "responsibility",
    targetId: responsibilityId!,
    metadata: { draftId: draft.id, petitionId },
  });
}
