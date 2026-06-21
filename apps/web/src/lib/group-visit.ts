import type { PrismaClient } from "../generated/prisma/client";
import { applyParticipationTransitions, recordGroupPresence, type GroupPresenceResult } from "./participation";
import { expireStaleAssignments } from "./responsibilities";
import { resolveDuePetitionsForGroup } from "./petition-evaluation";
import { archiveStalePetitions } from "./petitions";
import { autoCloseStaleWithdrawnConcerns } from "./concerns";
import { expireStaleContentDrafts } from "./content-creation-drafts";

/**
 * Side effects that MUST run on every group-workspace visit, before any data is read:
 *  1. `recordGroupPresence` — records the viewer's presence and IMMEDIATELY reactivates a
 *     quiet/dormant member back to active (the non-negotiable participation invariant);
 *  2. `applyParticipationTransitions` — applies active→quiet→dormant transitions for the group;
 *  3. the five per-group maintenance sweeps (assignments, due/stale petitions, withdrawn concerns,
 *     stale content drafts).
 *
 * Extracted as one named, ordered unit so the group loader can call it as its first line and a
 * future loader edit can't silently drop, reorder, or scatter it. Pinned by group-visit.test.ts.
 */
export async function runGroupVisitEffects(prisma: PrismaClient, accountId: string, groupId: string): Promise<GroupPresenceResult> {
  const presence = await recordGroupPresence(prisma, accountId, groupId);
  await applyParticipationTransitions(prisma, groupId);
  await expireStaleAssignments(prisma, groupId);
  await resolveDuePetitionsForGroup(prisma, groupId);
  await archiveStalePetitions(prisma, groupId);
  await autoCloseStaleWithdrawnConcerns(prisma, groupId);
  await expireStaleContentDrafts(prisma, groupId);
  // Surfaced for the group shell's one-time "while you were away" banner at the reactivation moment.
  return presence;
}
