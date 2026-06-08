import type { PrismaClient } from "../generated/prisma/client";
import type { GovernanceCategory } from "./governance-categories";
import { CATEGORY_REGISTRY, isGovernanceCategory, isGovernanceParameter, resolveAllParametersWithIndividualTemps } from "./governance-categories";
import { SIGNAL_CHANGE_COOLDOWN_HOURS } from "./governance-temperature";

type ParticipationStatus = "active" | "quiet" | "dormant";
type GovernanceSignal = -1 | 0 | 1;

export type NodeGovernanceEligibility = {
  accountId: string;
  participationStatus: ParticipationStatus;
};

export type UpsertNodeSignalResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfter: Date }
  | { ok: false; reason: "invalid_signal" }
  | { ok: false; reason: "invalid_category" }
  | { ok: false; reason: "invalid_parameter" }
  | { ok: false; reason: "not_eligible" };

function isValidSignal(value: number): value is GovernanceSignal {
  return value === -1 || value === 0 || value === 1;
}

function strongestStatus(statuses: string[]): ParticipationStatus {
  if (statuses.includes("active")) return "active";
  if (statuses.includes("quiet")) return "quiet";
  return "dormant";
}

function participationWeight(status: ParticipationStatus): number {
  return status === "active" ? 1 : status === "quiet" ? 0.5 : 0;
}

function computeWeightedTemperature(
  eligibleAccounts: NodeGovernanceEligibility[],
  effectiveSignalByAccountId: Map<string, number>,
): number {
  let maximumPossibleWeight = 0;
  let weightedSignalSum = 0;
  for (const account of eligibleAccounts) {
    const weight = participationWeight(account.participationStatus);
    maximumPossibleWeight += weight;
    weightedSignalSum += (effectiveSignalByAccountId.get(account.accountId) ?? 0) * weight;
  }
  if (maximumPossibleWeight === 0) return 0;
  const raw = weightedSignalSum / maximumPossibleWeight;
  return Math.max(-1, Math.min(1, Math.round(raw * 1000) / 1000));
}

export async function getNodeGovernanceEligibility(
  prisma: PrismaClient,
  nodeId: string,
): Promise<NodeGovernanceEligibility[]> {
  const memberships = await prisma.groupMembership.findMany({
    where: {
      status: "active",
      group: { nodeId },
    },
    select: { accountId: true, participationStatus: true },
  });
  const statusesByAccount = new Map<string, string[]>();
  for (const membership of memberships) {
    const statuses = statusesByAccount.get(membership.accountId) ?? [];
    statuses.push(membership.participationStatus);
    statusesByAccount.set(membership.accountId, statuses);
  }
  return [...statusesByAccount.entries()].map(([accountId, statuses]) => ({
    accountId,
    participationStatus: strongestStatus(statuses),
  }));
}

export async function getNodeParticipationStatus(
  prisma: PrismaClient,
  nodeId: string,
  accountId: string,
): Promise<ParticipationStatus | null> {
  const eligibility = await getNodeGovernanceEligibility(prisma, nodeId);
  return eligibility.find((entry) => entry.accountId === accountId)?.participationStatus ?? null;
}

export async function requireActiveNodeUser(
  prisma: PrismaClient,
  nodeId: string,
  accountId: string,
): Promise<void> {
  const status = await getNodeParticipationStatus(prisma, nodeId, accountId);
  if (status !== "active") throw new Error("Active node participation is required.");
}

export async function getActiveNodeVoterCount(prisma: PrismaClient, nodeId: string): Promise<number> {
  const eligibility = await getNodeGovernanceEligibility(prisma, nodeId);
  return eligibility.filter((entry) => entry.participationStatus === "active").length;
}

export async function activeNodeHostExists(
  prisma: PrismaClient,
  nodeId: string,
  accountId: string,
): Promise<boolean> {
  const count = await prisma.nodeHost.count({
    where: { nodeId, accountId, revokedAt: null },
  });
  return count > 0;
}

export async function requireActiveNodeHost(
  prisma: PrismaClient,
  nodeId: string,
  accountId: string,
): Promise<void> {
  if (!(await activeNodeHostExists(prisma, nodeId, accountId))) {
    throw new Error("Active node host status is required.");
  }
}

export async function computeNodeTemperature(
  prisma: PrismaClient,
  nodeId: string,
  category: GovernanceCategory,
  parameter = "_",
): Promise<number> {
  if (!isGovernanceParameter(category, parameter)) {
    throw new Error(`Unknown governance parameter "${parameter}" for category "${category}"`);
  }
  const eligibleAccounts = (await getNodeGovernanceEligibility(prisma, nodeId)).filter(
    (entry) => entry.participationStatus === "active" || entry.participationStatus === "quiet",
  );
  if (eligibleAccounts.length === 0) return 0;
  const accountIds = eligibleAccounts.map((entry) => entry.accountId);
  const signals = await prisma.nodeGovernanceSignal.findMany({
    where: {
      nodeId,
      accountId: { in: accountIds },
      category,
      parameter: parameter === "_" ? "_" : { in: ["_", parameter] },
    },
    select: { accountId: true, parameter: true, signal: true },
  });
  const categorySignals = new Map<string, number>();
  const parameterSignals = new Map<string, number>();
  for (const signal of signals) {
    if (signal.parameter === "_") categorySignals.set(signal.accountId, signal.signal);
    else if (signal.parameter === parameter) parameterSignals.set(signal.accountId, signal.signal);
  }
  const effectiveSignals = new Map<string, number>();
  for (const accountId of accountIds) {
    effectiveSignals.set(accountId, parameterSignals.get(accountId) ?? categorySignals.get(accountId) ?? 0);
  }
  return computeWeightedTemperature(eligibleAccounts, effectiveSignals);
}

export async function computeAllNodeParameterTemperatures(
  prisma: PrismaClient,
  nodeId: string,
  category: GovernanceCategory,
): Promise<Map<string, number>> {
  const eligibleAccounts = (await getNodeGovernanceEligibility(prisma, nodeId)).filter(
    (entry) => entry.participationStatus === "active" || entry.participationStatus === "quiet",
  );
  const result = new Map<string, number>();
  if (eligibleAccounts.length === 0) {
    result.set("_", 0);
    for (const parameter of Object.keys(CATEGORY_REGISTRY[category])) result.set(parameter, 0);
    return result;
  }
  const accountIds = eligibleAccounts.map((entry) => entry.accountId);
  const signals = await prisma.nodeGovernanceSignal.findMany({
    where: { nodeId, accountId: { in: accountIds }, category },
    select: { accountId: true, parameter: true, signal: true },
  });
  const signalsByParameter = new Map<string, Map<string, number>>();
  for (const signal of signals) {
    const signalsByAccount = signalsByParameter.get(signal.parameter) ?? new Map<string, number>();
    signalsByAccount.set(signal.accountId, signal.signal);
    signalsByParameter.set(signal.parameter, signalsByAccount);
  }
  const categorySignals = signalsByParameter.get("_") ?? new Map<string, number>();
  result.set("_", computeWeightedTemperature(eligibleAccounts, categorySignals));
  for (const parameter of Object.keys(CATEGORY_REGISTRY[category])) {
    const parameterSignals = signalsByParameter.get(parameter) ?? new Map<string, number>();
    const effectiveSignals = new Map<string, number>();
    for (const accountId of accountIds) {
      effectiveSignals.set(accountId, parameterSignals.get(accountId) ?? categorySignals.get(accountId) ?? 0);
    }
    result.set(parameter, computeWeightedTemperature(eligibleAccounts, effectiveSignals));
  }
  return result;
}

export async function resolveNodeGovernanceParams(
  prisma: PrismaClient,
  nodeId: string,
  category: GovernanceCategory,
) {
  if (!isGovernanceCategory(category)) throw new Error(`Unknown governance category: "${category}"`);
  const temperatures = await computeAllNodeParameterTemperatures(prisma, nodeId, category);
  return resolveAllParametersWithIndividualTemps(category, temperatures);
}

export async function upsertNodeGovernanceSignal(
  prisma: PrismaClient,
  {
    nodeId,
    accountId,
    category,
    parameter = "_",
    signal,
  }: {
    nodeId: string;
    accountId: string;
    category: string;
    parameter?: string;
    signal: number;
  },
): Promise<UpsertNodeSignalResult> {
  if (!isGovernanceCategory(category)) return { ok: false, reason: "invalid_category" };
  if (!isValidSignal(signal)) return { ok: false, reason: "invalid_signal" };
  if (!isGovernanceParameter(category, parameter)) return { ok: false, reason: "invalid_parameter" };
  const status = await getNodeParticipationStatus(prisma, nodeId, accountId);
  if (status !== "active" && status !== "quiet") return { ok: false, reason: "not_eligible" };

  const existing = await prisma.nodeGovernanceSignal.findUnique({
    where: { accountId_nodeId_category_parameter: { accountId, nodeId, category, parameter } },
  });
  if (existing && existing.signal !== signal) {
    const cooldownMs = SIGNAL_CHANGE_COOLDOWN_HOURS * 60 * 60 * 1000;
    const elapsed = Date.now() - existing.updatedAt.getTime();
    if (elapsed < cooldownMs) {
      return { ok: false, reason: "cooldown", retryAfter: new Date(existing.updatedAt.getTime() + cooldownMs) };
    }
  }
  await prisma.nodeGovernanceSignal.upsert({
    where: { accountId_nodeId_category_parameter: { accountId, nodeId, category, parameter } },
    update: { signal },
    create: { accountId, nodeId, category, parameter, signal },
  });
  return { ok: true };
}
