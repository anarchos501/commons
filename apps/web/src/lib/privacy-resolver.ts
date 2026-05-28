import type { PrismaClient } from "../generated/prisma/client";
import type { PrivacyLevel, VisibilityLevel } from "../generated/prisma/enums";
import type { DataClass, ReplicationPolicy } from "./replication-policies";
import { getDefaultReplicationPolicy } from "./replication-policies";

export type PrivacyScopePreferences = {
  privacyLevel?: PrivacyLevel;
  visibility?: VisibilityLevel;
  federationAllowed?: boolean;
  p2pAllowed?: boolean;
  retentionDays?: number | null;
  requiresEncryption?: boolean;
};

export type PrivacyResolutionInput = {
  dataClass: DataClass;
  requestedPrivacy?: PrivacyLevel;
  requestedVisibility?: VisibilityLevel;
  accountPreferences?: PrivacyScopePreferences | null;
  groupPreferences?: PrivacyScopePreferences | null;
  projectPreferences?: PrivacyScopePreferences | null;
  nodeConstraints?: PrivacyScopePreferences | null;
  replicationPolicy?: ReplicationPolicy | null;
  sensitive?: boolean;
};

export type EffectivePrivacyResolution = {
  privacyLevel: PrivacyLevel;
  visibility: VisibilityLevel;
  federationAllowed: boolean;
  p2pAllowed: boolean;
  retentionDays: number | null;
  requiresEncryption: boolean;
  explanation: string[];
};

export type SupportRequestPrivacyContext = {
  id: string;
  requestedServices: Array<{ serviceType: string; trustRequirement: "lightweight" | "elevated" }>;
  requestType: string;
  urgency: string;
  privacyLevel: PrivacyLevel;
  description: string;
  submittedByAccountId?: string | null;
  group?: { privacyPreferences?: unknown; node?: { constitutionalPreferences?: unknown } } | null;
  project?: { privacyPreferences?: unknown } | null;
};

const privacyRank: Record<PrivacyLevel, number> = {
  private: 0,
  project: 1,
  group: 2,
  public: 3,
};

const visibilityRank: Record<VisibilityLevel, number> = {
  private: 0,
  project: 1,
  group: 2,
  public: 3,
};

const sensitiveServiceTerms = ["childcare", "medical", "legal", "crisis", "housing", "shelter", "rides", "ride"];

export function resolveEffectivePrivacy(input: PrivacyResolutionInput): EffectivePrivacyResolution {
  const defaultPolicy = input.replicationPolicy ?? getDefaultReplicationPolicy(input.dataClass) ?? null;
  const privacyCandidates = [
    { source: "request", value: input.requestedPrivacy },
    { source: "account", value: input.accountPreferences?.privacyLevel },
    { source: "project", value: input.projectPreferences?.privacyLevel },
    { source: "group", value: input.groupPreferences?.privacyLevel },
    { source: "node", value: input.nodeConstraints?.privacyLevel },
    { source: "sensitive-default", value: input.sensitive ? "private" : undefined },
  ].filter((candidate): candidate is { source: string; value: PrivacyLevel } => Boolean(candidate.value));

  const visibilityCandidates = [
    { source: "request", value: input.requestedVisibility },
    { source: "account", value: input.accountPreferences?.visibility },
    { source: "project", value: input.projectPreferences?.visibility },
    { source: "group", value: input.groupPreferences?.visibility },
    { source: "node", value: input.nodeConstraints?.visibility },
    { source: "sensitive-default", value: input.sensitive ? "private" : undefined },
  ].filter((candidate): candidate is { source: string; value: VisibilityLevel } => Boolean(candidate.value));

  const privacyWinner = mostRestrictive(privacyCandidates, privacyRank) ?? { source: "default", value: "private" as PrivacyLevel };
  const visibilityWinner = mostRestrictive(visibilityCandidates, visibilityRank) ?? { source: "default", value: privacyToVisibility(privacyWinner.value) };
  const federationAllowed = Boolean(defaultPolicy?.federationAllowed) && allAllow([input.accountPreferences, input.projectPreferences, input.groupPreferences, input.nodeConstraints], "federationAllowed");
  const p2pAllowed = Boolean(defaultPolicy?.p2pAllowed) && allAllow([input.accountPreferences, input.projectPreferences, input.groupPreferences, input.nodeConstraints], "p2pAllowed");
  const retentionDays = minimumRetention([
    defaultPolicy?.retentionDays,
    input.accountPreferences?.retentionDays,
    input.projectPreferences?.retentionDays,
    input.groupPreferences?.retentionDays,
    input.nodeConstraints?.retentionDays,
  ]);
  const requiresEncryption = Boolean(defaultPolicy?.requiresEncryption || input.sensitive || input.accountPreferences?.requiresEncryption || input.projectPreferences?.requiresEncryption || input.groupPreferences?.requiresEncryption || input.nodeConstraints?.requiresEncryption);

  return {
    privacyLevel: privacyWinner.value,
    visibility: visibilityWinner.value,
    federationAllowed,
    p2pAllowed,
    retentionDays,
    requiresEncryption,
    explanation: [
      `privacy:${privacyWinner.value} from ${privacyWinner.source}`,
      `visibility:${visibilityWinner.value} from ${visibilityWinner.source}`,
      `federation:${federationAllowed ? "allowed" : "blocked"}`,
      `p2p:${p2pAllowed ? "allowed" : "blocked"}`,
      `retention:${retentionDays ?? "unspecified"}`,
      `encryption:${requiresEncryption ? "required" : "not-required"}`,
    ],
  };
}

export async function resolveSupportRequestPrivacy(prisma: PrismaClient, supportRequestId: string) {
  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: supportRequestId },
    include: {
      services: true,
      group: { include: { node: true } },
      project: true,
    },
  });

  if (!supportRequest) {
    throw new Error(`Support request ${supportRequestId} was not found.`);
  }

  return resolveEffectivePrivacy({
    dataClass: "support_request",
    requestedPrivacy: supportRequest.privacyLevel,
    requestedVisibility: privacyToVisibility(supportRequest.privacyLevel),
    groupPreferences: parsePreferences(supportRequest.group.privacyPreferences),
    projectPreferences: parsePreferences(supportRequest.project?.privacyPreferences),
    nodeConstraints: parsePreferences(supportRequest.group.node.constitutionalPreferences),
    sensitive: isSensitiveSupportRequest({
      requestType: supportRequest.requestType,
      requestedServices: supportRequest.services.map((service) => ({ serviceType: service.serviceType, trustRequirement: service.trustRequirement })),
    }),
  });
}

export function isSensitiveSupportRequest(request: Pick<SupportRequestPrivacyContext, "requestType" | "requestedServices">): boolean {
  return request.requestedServices.some((service) => service.trustRequirement === "elevated" || sensitiveServiceTerms.some((term) => service.serviceType.toLowerCase().includes(term))) || sensitiveServiceTerms.some((term) => request.requestType.toLowerCase().includes(term));
}

export function buildRouteNotificationPayload(request: SupportRequestPrivacyContext, resolution: EffectivePrivacyResolution) {
  return {
    supportRequestId: request.id,
    requestType: request.requestType,
    requestedServices: request.requestedServices,
    urgency: request.urgency,
    privacyLevel: resolution.privacyLevel,
    visibility: resolution.visibility,
    sensitiveDetailsIncluded: false,
  };
}

export function buildSupportRequestEventPayload(request: SupportRequestPrivacyContext, resolution: EffectivePrivacyResolution) {
  return {
    supportRequestId: request.id,
    requestType: request.requestType,
    requestedServices: request.requestedServices.map((service) => ({
      serviceType: service.serviceType,
      trustRequirement: service.trustRequirement,
    })),
    privacyLevel: resolution.privacyLevel,
    federationAllowed: resolution.federationAllowed,
    sensitiveDetailsIncluded: false,
  };
}

export function buildContributionPrivacyEnvelope(routeId: string) {
  return {
    excludesRecipientIdentity: true,
    source: "accepted_request_route",
    requestRouteId: routeId,
  };
}

export function parsePreferences(value: unknown): PrivacyScopePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    privacyLevel: asPrivacyLevel(record.privacyLevel ?? record.supportRequests),
    visibility: asVisibilityLevel(record.visibility ?? record.contributionVisibility),
    federationAllowed: typeof record.federationAllowed === "boolean" ? record.federationAllowed : undefined,
    p2pAllowed: typeof record.p2pAllowed === "boolean" ? record.p2pAllowed : undefined,
    retentionDays: typeof record.retentionDays === "number" ? record.retentionDays : typeof record.supportRequestRetentionDays === "number" ? record.supportRequestRetentionDays : undefined,
    requiresEncryption: typeof record.requiresEncryption === "boolean" ? record.requiresEncryption : undefined,
  };
}

function mostRestrictive<T extends string>(candidates: Array<{ source: string; value: T }>, rank: Record<T, number>) {
  return candidates.reduce<{ source: string; value: T } | undefined>((winner, candidate) => {
    if (!winner || rank[candidate.value] < rank[winner.value]) {
      return candidate;
    }

    return winner;
  }, undefined);
}

function allAllow(preferences: Array<PrivacyScopePreferences | null | undefined>, key: "federationAllowed" | "p2pAllowed") {
  return preferences.every((preference) => preference?.[key] !== false);
}

function minimumRetention(values: Array<number | null | undefined>) {
  const concreteValues = values.filter((value): value is number => typeof value === "number");
  return concreteValues.length > 0 ? Math.min(...concreteValues) : null;
}

function privacyToVisibility(privacy: PrivacyLevel): VisibilityLevel {
  return privacy;
}

function asPrivacyLevel(value: unknown): PrivacyLevel | undefined {
  return value === "private" || value === "project" || value === "group" || value === "public" ? value : undefined;
}

function asVisibilityLevel(value: unknown): VisibilityLevel | undefined {
  return value === "private" || value === "project" || value === "group" || value === "public" ? value : undefined;
}