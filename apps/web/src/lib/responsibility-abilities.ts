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
 * Abilities are coordination affordances, not permissions.
 * No platform behavior is gated on abilities in D2.
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
