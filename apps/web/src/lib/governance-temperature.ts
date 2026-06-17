import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { GovernanceCategory } from "./governance-categories";
import { CATEGORY_REGISTRY, isGovernanceCategory, isGovernanceParameter } from "./governance-categories";

export const SIGNAL_CHANGE_COOLDOWN_HOURS = 1;
type GovernanceSignal = -1 | 0 | 1;

export type UpsertSignalResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfter: Date }
  | { ok: false; reason: "invalid_signal" }
  | { ok: false; reason: "invalid_category" }
  | { ok: false; reason: "invalid_parameter" }
  | { ok: false; reason: "membership_group_mismatch" };

function isValidSignal(value: number): value is GovernanceSignal {
  return value === -1 || value === 0 || value === 1;
}

type EligibleMembership = { id: string; participationStatus: string };

function computeWeightedTemperature(
  eligibleMemberships: EligibleMembership[],
  effectiveSignalByMembershipId: Map<string, number>,
): number {
  if (eligibleMemberships.length === 0) return 0;

  let maximumPossibleWeight = 0;
  let weightedSignalSum = 0;

  for (const membership of eligibleMemberships) {
    const weight = membership.participationStatus === "active" ? 1.0 : 0.5;
    maximumPossibleWeight += weight;
    weightedSignalSum += (effectiveSignalByMembershipId.get(membership.id) ?? 0) * weight;
  }

  if (maximumPossibleWeight === 0) return 0;

  const raw = weightedSignalSum / maximumPossibleWeight;
  return Math.max(-1, Math.min(1, Math.round(raw * 1000) / 1000));
}

export async function upsertGovernanceSignal(
  prisma: PrismaClient,
  {
    membershipId,
    groupId,
    category,
    parameter = "_",
    signal,
  }: {
    membershipId: string;
    groupId: string;
    category: string;
    parameter?: string;
    signal: number;
  },
): Promise<UpsertSignalResult> {
  if (!isGovernanceCategory(category)) {
    return { ok: false, reason: "invalid_category" };
  }
  if (!isValidSignal(signal)) {
    return { ok: false, reason: "invalid_signal" };
  }
  if (!isGovernanceParameter(category, parameter)) {
    return { ok: false, reason: "invalid_parameter" };
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { id: membershipId },
    select: { groupId: true },
  });
  if (!membership || membership.groupId !== groupId) {
    return { ok: false, reason: "membership_group_mismatch" };
  }

  const existing = await prisma.memberGovernanceSignal.findUnique({
    where: { membershipId_category_parameter: { membershipId, category, parameter } },
  });

  if (existing) {
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
    where: { membershipId_category_parameter: { membershipId, category, parameter } },
    update: { signal, groupId },
    create: { membershipId, groupId, category, parameter, signal },
  });

  return { ok: true };
}

export async function clearGovernanceSignal(
  prisma: PrismaClient,
  { membershipId, category, parameter = "_" }: { membershipId: string; category: string; parameter?: string },
): Promise<UpsertSignalResult> {
  if (!isGovernanceCategory(category)) {
    return { ok: false, reason: "invalid_category" };
  }
  if (!isGovernanceParameter(category, parameter)) {
    return { ok: false, reason: "invalid_parameter" };
  }

  const existing = await prisma.memberGovernanceSignal.findUnique({
    where: { membershipId_category_parameter: { membershipId, category, parameter } },
    select: { groupId: true },
  });

  if (!existing) return { ok: true };

  return upsertGovernanceSignal(prisma, {
    membershipId,
    groupId: existing.groupId,
    category,
    parameter,
    signal: 0,
  });
}

export async function computeGroupTemperature(
  prisma: PrismaClient,
  groupId: string,
  category: GovernanceCategory,
  parameter = "_",
): Promise<number> {
  if (!isGovernanceParameter(category, parameter)) {
    throw new Error(`Unknown governance parameter "${parameter}" for category "${category}"`);
  }

  const eligibleMemberships = await prisma.groupMembership.findMany({
    where: {
      groupId,
      status: "active",
      participationStatus: { in: ["active", "quiet"] },
    },
    select: { id: true, participationStatus: true },
  });

  if (eligibleMemberships.length === 0) return 0;

  const eligibleIds = eligibleMemberships.map((membership) => membership.id);
  const signals = await prisma.memberGovernanceSignal.findMany({
    where: {
      membershipId: { in: eligibleIds },
      category,
      parameter: parameter === "_" ? "_" : { in: ["_", parameter] },
    },
    select: { membershipId: true, parameter: true, signal: true },
  });

  const categorySignals = new Map<string, number>();
  const parameterSignals = new Map<string, number>();
  for (const signal of signals) {
    if (signal.parameter === "_") {
      categorySignals.set(signal.membershipId, signal.signal);
    } else if (signal.parameter === parameter) {
      parameterSignals.set(signal.membershipId, signal.signal);
    }
  }

  const effectiveSignals = new Map<string, number>();
  for (const membershipId of eligibleIds) {
    effectiveSignals.set(membershipId, parameterSignals.get(membershipId) ?? categorySignals.get(membershipId) ?? 0);
  }

  return computeWeightedTemperature(eligibleMemberships, effectiveSignals);
}

export async function computeAllParameterTemperatures(
  prisma: Prisma.TransactionClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<Map<string, number>> {
  const eligibleMemberships = await prisma.groupMembership.findMany({
    where: {
      groupId,
      status: "active",
      participationStatus: { in: ["active", "quiet"] },
    },
    select: { id: true, participationStatus: true },
  });

  const result = new Map<string, number>();
  if (eligibleMemberships.length === 0) {
    result.set("_", 0);
    for (const parameter of Object.keys(CATEGORY_REGISTRY[category])) result.set(parameter, 0);
    return result;
  }

  const eligibleIds = eligibleMemberships.map((membership) => membership.id);
  const signals = await prisma.memberGovernanceSignal.findMany({
    where: {
      membershipId: { in: eligibleIds },
      category,
    },
    select: { membershipId: true, parameter: true, signal: true },
  });

  const signalsByParameter = new Map<string, Map<string, number>>();
  for (const signal of signals) {
    const signalsByMembership = signalsByParameter.get(signal.parameter) ?? new Map<string, number>();
    signalsByMembership.set(signal.membershipId, signal.signal);
    signalsByParameter.set(signal.parameter, signalsByMembership);
  }

  const categorySignals = signalsByParameter.get("_") ?? new Map<string, number>();
  result.set("_", computeWeightedTemperature(eligibleMemberships, categorySignals));

  for (const parameter of Object.keys(CATEGORY_REGISTRY[category])) {
    const parameterSignals = signalsByParameter.get(parameter) ?? new Map<string, number>();
    const effectiveSignals = new Map<string, number>();
    for (const membershipId of eligibleIds) {
      effectiveSignals.set(membershipId, parameterSignals.get(membershipId) ?? categorySignals.get(membershipId) ?? 0);
    }
    result.set(parameter, computeWeightedTemperature(eligibleMemberships, effectiveSignals));
  }

  return result;
}
