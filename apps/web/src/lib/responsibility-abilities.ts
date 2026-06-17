import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationAbility, AbilityAvailability } from "../generated/prisma/enums";
import { isEmergencyActive } from "./emergency";

/**
 * Records that a responsibility holds a coordination ability, or updates
 * the availability if already granted. Calling again with a different
 * availability updates the record — this is intentional: groups may
 * change an ability from always_available to available_during_emergency
 * (or vice versa) as a governance action.
 *
 * Enforcement (F1): abilities now gate real behavior, and the gate is legitimate because the
 * authority is consent-delegated — bound to an active responsibility seat, expiring with the
 * term, and recallable by petition (see proposeResponsibilityRecall). Enforced today:
 *   - accountability: review_concerns / issue_findings / issue_action_proposals /
 *     administrative_closure gate the concern-review actions (concerns.ts).
 *   - creation: create_bulletins / create_publications / create_publication_entries /
 *     create_projects / create_contribution_categories gate the *responsibility-acting* path
 *     (acting "as" a seat), never a member's egalitarian baseline.
 *
 * Still NON-gating affordances (deferred — F1.4): approve_membership, issue_support_requests,
 * issue_contribution_offers. Their underlying flows are deliberately egalitarian/guest-facing
 * (community membership vote; guest-and-member support requests), so gating them would convert
 * open coordination into a permissioned system. Delegating these to a recallable seat is a future
 * opt-in path — until it exists, granting these abilities records intent but changes no behavior.
 */
export async function grantAbility(
  prisma: PrismaClient,
  responsibilityId: string,
  ability: CoordinationAbility,
  availability: AbilityAvailability = "always_available",
): Promise<void> {
  await prisma.responsibilityAbility.upsert({
    where: { responsibilityId_ability: { responsibilityId, ability } },
    update: { availability },
    create: { responsibilityId, ability, availability },
  });
}

/**
 * Removes an ability from a responsibility.
 * No-op if the ability was not granted.
 */
export async function revokeAbility(
  prisma: PrismaClient,
  responsibilityId: string,
  ability: CoordinationAbility,
): Promise<void> {
  await prisma.responsibilityAbility.deleteMany({
    where: { responsibilityId, ability },
  });
}

/**
 * Returns true if the responsibility currently holds the given ability.
 * Does not check availability mode (always vs emergency) — callers decide
 * whether to enforce emergency-only gating.
 */
export async function hasAbility(
  prisma: PrismaClient,
  responsibilityId: string,
  ability: CoordinationAbility,
): Promise<boolean> {
  const record = await prisma.responsibilityAbility.findUnique({
    where: { responsibilityId_ability: { responsibilityId, ability } },
  });
  return record !== null;
}

/**
 * Returns all ability records for a responsibility.
 */
export async function getAbilities(
  prisma: PrismaClient,
  responsibilityId: string,
) {
  return prisma.responsibilityAbility.findMany({
    where: { responsibilityId },
    orderBy: { ability: "asc" },
  });
}

// --- RFC-006: Emergency-gated ability check ---

/**
 * Returns true if a responsibility currently has the given ability AND the
 * ability is currently available given the responsibility's group emergency state.
 *
 * - always_available: active regardless of emergency state
 * - available_during_emergency: active only when isEmergencyActive is true for
 *   the responsibility's own group (derived from the DB record — not caller-supplied)
 *
 * groupId is NOT accepted as a parameter; it is derived from the responsibility record.
 * This prevents callers from activating emergency abilities by passing a different group's id.
 */
export async function hasAbilityNow(
  prisma: PrismaClient,
  responsibilityId: string,
  ability: CoordinationAbility,
): Promise<boolean> {
  const record = await prisma.responsibilityAbility.findUnique({
    where: { responsibilityId_ability: { responsibilityId, ability } },
  });

  if (!record) return false;

  if (record.availability === "always_available") return true;

  // available_during_emergency: derive groupId from the responsibility record
  const responsibility = await prisma.responsibility.findUnique({
    where: { id: responsibilityId },
    select: { groupId: true },
  });

  if (!responsibility) return false;

  return isEmergencyActive(prisma, responsibility.groupId);
}

// --- F1: Term-bound ability enforcement (authority lives only as long as the seat) ---
//
// hasAbilityNow alone is NOT a sufficient gate: it answers "does this responsibility carry
// this ability now?" but not "does this member currently hold that seat?". Enforcing abilities
// requires BOTH — and the seat check (active assignment, unexpired, recallable) is exactly what
// makes the authority legitimate: it vanishes the moment the term ends or the holder is recalled.

/**
 * True when `membershipId` currently holds an ACTIVE, unexpired assignment to
 * `responsibilityId` AND that responsibility has `ability` available now (emergency-gating
 * respected). Use on the responsibility-acting path (a member acting "as" a specific seat).
 */
export async function hasActiveAbility(
  prisma: PrismaClient,
  membershipId: string,
  responsibilityId: string,
  ability: CoordinationAbility,
): Promise<boolean> {
  const assignment = await prisma.responsibilityAssignment.findFirst({
    where: {
      membershipId,
      responsibilityId,
      endedAt: null,
      expiresAt: { gt: new Date() },
      membership: { status: "active", participationStatus: "active" },
    },
    select: { id: true },
  });
  if (!assignment) return false;
  return hasAbilityNow(prisma, responsibilityId, ability);
}

/**
 * Like hasActiveAbility, but identifies the seat by responsibility `type` (e.g. "reviewer")
 * rather than id. True if the member holds an active assignment of that type whose
 * responsibility has `ability` available now. Used by accountability gates where the
 * responsibility is found by its first-class type.
 */
export async function hasActiveAbilityByType(
  prisma: PrismaClient,
  membershipId: string,
  type: string,
  ability: CoordinationAbility,
): Promise<boolean> {
  const assignment = await prisma.responsibilityAssignment.findFirst({
    where: {
      membershipId,
      endedAt: null,
      expiresAt: { gt: new Date() },
      responsibility: { type },
      membership: { status: "active", participationStatus: "active" },
    },
    select: { responsibilityId: true },
  });
  if (!assignment) return false;
  return hasAbilityNow(prisma, assignment.responsibilityId, ability);
}
