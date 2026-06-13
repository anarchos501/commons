import type { PrismaClient } from "../generated/prisma/client";
import type { CoordinationAbility } from "../generated/prisma/enums";

/**
 * Concern review is the group's accountability path. The authority lives in a single,
 * pre-fabricated responsibility that every group receives automatically. Members must
 * still volunteer for it through the normal responsibility petition flow — the role
 * merely exists so the path is always available. These accountability abilities are
 * deliberately NOT in PROPOSABLE_RESPONSIBILITY_ABILITIES, so members cannot mint other
 * roles that carry concern-review authority.
 */

// Stable internal identifier the concern-eligibility gating keys on (hasActiveEligibleAssignment).
// Kept as "reviewer" for backward compatibility; user-facing surfaces use the label below.
export const CONCERN_REVIEWER_TYPE = "reviewer";

// User-facing name — "Concern Reviewer" is specific where the bare type "reviewer" is vague.
export const CONCERN_REVIEWER_LABEL = "Concern Reviewer";

export const CONCERN_REVIEWER_ABILITIES: CoordinationAbility[] = [
  "review_concerns",
  "issue_findings",
  "issue_action_proposals",
  "administrative_closure",
];

// Accepts the full client or a transaction client (both expose these model delegates),
// so this can run atomically inside group creation or standalone in the backfill.
type ResponsibilityWriter = Pick<PrismaClient, "responsibility" | "responsibilityAbility">;

/**
 * Idempotently provisions the Concern Reviewer responsibility (and its abilities) for a
 * group. Safe to call repeatedly — upserts leave an existing role untouched.
 */
export async function provisionConcernReviewer(
  client: ResponsibilityWriter,
  groupId: string,
): Promise<void> {
  const responsibility = await client.responsibility.upsert({
    where: { groupId_type: { groupId, type: CONCERN_REVIEWER_TYPE } },
    update: {},
    create: { groupId, type: CONCERN_REVIEWER_TYPE },
    select: { id: true },
  });
  for (const ability of CONCERN_REVIEWER_ABILITIES) {
    await client.responsibilityAbility.upsert({
      where: { responsibilityId_ability: { responsibilityId: responsibility.id, ability } },
      update: {},
      create: { responsibilityId: responsibility.id, ability },
    });
  }
}

/** Maps a responsibility type to its user-facing label (e.g. "reviewer" → "Concern Reviewer"). */
export function responsibilityTypeLabel(type: string): string {
  return type === CONCERN_REVIEWER_TYPE ? CONCERN_REVIEWER_LABEL : type;
}
