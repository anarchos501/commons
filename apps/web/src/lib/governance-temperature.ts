import type { PrismaClient } from "../generated/prisma/client";
import type { GovernanceCategory } from "./governance-categories";
import { isGovernanceCategory } from "./governance-categories";

export const SIGNAL_CHANGE_COOLDOWN_HOURS = 1;
const VALID_SIGNALS = [-1, 0, 1] as const;
type GovernanceSignal = (typeof VALID_SIGNALS)[number];

export type UpsertSignalResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfter: Date }
  | { ok: false; reason: "invalid_signal" }
  | { ok: false; reason: "invalid_category" }
  | { ok: false; reason: "membership_group_mismatch" };

function isValidSignal(value: number): value is GovernanceSignal {
  return value === -1 || value === 0 || value === 1;
}

export async function upsertGovernanceSignal(
  prisma: PrismaClient,
  {
    membershipId,
    groupId,
    category,
    signal,
  }: {
    membershipId: string;
    groupId: string;
    category: string;
    signal: number;
  },
): Promise<UpsertSignalResult> {
  if (!isGovernanceCategory(category)) {
    return { ok: false, reason: "invalid_category" };
  }
  if (!isValidSignal(signal)) {
    return { ok: false, reason: "invalid_signal" };
  }

  // Validate membershipId belongs to groupId
  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true },
  });
  if (!membership || membership.groupId !== groupId) {
    return { ok: false, reason: "membership_group_mismatch" };
  }

  const existing = await prisma.memberGovernanceSignal.findUnique({
    where: { membershipId_category: { membershipId, category } },
  });

  if (existing) {
    // Idempotent: no cooldown if signal unchanged
    if (existing.signal === signal) {
      return { ok: true };
    }
    const cooldownMs = SIGNAL_CHANGE_COOLDOWN_HOURS * 60 * 60 * 1000;
    const elapsed = Date.now() - existing.updatedAt.getTime();
    if (elapsed < cooldownMs) {
      const retryAfter = new Date(existing.updatedAt.getTime() + cooldownMs);
      return { ok: false, reason: "cooldown", retryAfter };
    }
  }

  await prisma.memberGovernanceSignal.upsert({
    where: { membershipId_category: { membershipId, category } },
    update: { signal, groupId },
    create: { membershipId, groupId, category, signal },
  });

  return { ok: true };
}

export async function clearGovernanceSignal(
  prisma: PrismaClient,
  { membershipId, category }: { membershipId: string; category: string },
): Promise<UpsertSignalResult> {
  const existing = await prisma.memberGovernanceSignal.findUnique({
    where: { membershipId_category: { membershipId, category } },
    select: { groupId: true, signal: true, updatedAt: true },
  });

  if (!existing) return { ok: true };

  return upsertGovernanceSignal(prisma, {
    membershipId,
    groupId: existing.groupId,
    category,
    signal: 0,
  });
}

export async function computeGroupTemperature(
  prisma: PrismaClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<number> {
  // Fetch all active+quiet memberships for the group (eligible population)
  const eligibleMemberships = await prisma.groupMembership.findMany({
    where: {
      groupId,
      status: "active",
      participationStatus: { in: ["active", "quiet"] },
    },
    select: { id: true, participationStatus: true },
  });

  if (eligibleMemberships.length === 0) return 0;

  // Compute maximumPossibleWeight (Active=1.0, Quiet=0.5)
  let maximumPossibleWeight = 0;
  const weightByMembershipId = new Map<string, number>();
  for (const m of eligibleMemberships) {
    const weight = m.participationStatus === "active" ? 1.0 : 0.5;
    weightByMembershipId.set(m.id, weight);
    maximumPossibleWeight += weight;
  }

  if (maximumPossibleWeight === 0) return 0;

  // Fetch signals only for eligible members
  const eligibleIds = Array.from(weightByMembershipId.keys());
  const signals = await prisma.memberGovernanceSignal.findMany({
    where: {
      membershipId: { in: eligibleIds },
      category,
    },
    select: { membershipId: true, signal: true },
  });

  // weightedSignalSum = sum(signal × weight) for members with a signal record
  // Members without a record contribute 0 (absent = neutral by design)
  let weightedSignalSum = 0;
  for (const s of signals) {
    const weight = weightByMembershipId.get(s.membershipId) ?? 0;
    weightedSignalSum += s.signal * weight;
  }

  const raw = weightedSignalSum / maximumPossibleWeight;
  // Round to 3 decimal places and clamp to [-1, +1]
  return Math.max(-1, Math.min(1, Math.round(raw * 1000) / 1000));
}
