import type { PrismaClient, RequestRoute } from "../generated/prisma/client";
import type { ServiceCapabilityStatus } from "../generated/prisma/enums";
import { logAction } from "./action-log";
import {
  buildContributionPrivacyEnvelope,
  buildRouteNotificationPayload,
  isSensitiveSupportRequest,
  parsePreferences,
  resolveEffectivePrivacy,
  resolveSupportRequestPrivacy,
} from "./privacy-resolver";
import { markSupportRequestRouted } from "./request-lifecycle";

export type TrustRequirementValue = "lightweight" | "elevated";
export type VisibilityLevelValue = "private" | "group" | "project" | "public";
export type RouteDecision = "accepted" | "declined";

export type SimpleAvailability = {
  days?: string[];
  windows?: string[];
  availableNow?: boolean;
  preference?: "unavailable" | "available" | "limited" | "time-sensitive-capable";
};

export type DeclareServiceCapabilityInput = {
  accountId: string;
  serviceType: string;
  description?: string;
  availability?: SimpleAvailability;
  visibility?: VisibilityLevelValue;
  trustRequirement?: TrustRequirementValue;
  // Optional link to a community-governed ContributionCategory. When set, category-based routing
  // (which matches ServiceCapability by categoryId) can find this offer. Without it, only the
  // legacy string (serviceType) routing path matches.
  categoryId?: string;
};

export type RequestedServiceInput = {
  serviceType: string;
  // Optional: ID of a community-governed ContributionCategory.
  // When set, drives category-based routing instead of string-based routing.
  categoryId?: string;
  trustRequirement?: TrustRequirementValue;
};

export type CreateSupportRequestInput = {
  id?: string;
  submittedByAccountId?: string | null;
  guestRequestId?: string;
  groupId: string;
  projectId?: string | null;
  requestType: string;
  requestedServices: RequestedServiceInput[];
  description: string;
  // For custom requests: the free-text need, stored separately from `description` so it can be
  // shown to potential helpers without exposing the contact note.
  customNeed?: string | null;
  urgency?: "low" | "normal" | "high" | "urgent";
  privacyLevel?: "private" | "group" | "project" | "public";
  expiresAt?: Date | null;
};

export type RouteSupportRequestInput = {
  supportRequestId: string;
  now?: Date;
};

export type RouteDecisionInput = {
  routeId: string;
  contributorAccountId: string;
  decision: RouteDecision;
  decisionNote?: string;
  decidedAt?: Date;
};

export type RouteNotification = RequestRoute & { notificationPayload: ReturnType<typeof buildRouteNotificationPayload> };

export type CreateContributionFromRouteInput = {
  routeId: string;
  occurredAt?: Date;
  quantity?: string;
  id?: string;
};

export async function declareServiceCapability(prisma: PrismaClient, input: DeclareServiceCapabilityInput) {
  const trustRequirement = input.trustRequirement ?? "lightweight";
  const visibility = input.visibility ?? "group";
  const approvalStatus = trustRequirement === "lightweight" ? "available" : "petitioned";

  const capability = await prisma.serviceCapability.upsert({
    where: {
      accountId_serviceType_trustRequirement: {
        accountId: input.accountId,
        serviceType: input.serviceType,
        trustRequirement,
      },
    },
    update: {
      description: input.description,
      availability: input.availability,
      visibility,
      approvalStatus,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    },
    create: {
      accountId: input.accountId,
      serviceType: input.serviceType,
      description: input.description,
      availability: input.availability,
      visibility,
      trustRequirement,
      approvalStatus,
      categoryId: input.categoryId ?? null,
    },
  });

  await prisma.contributorAvailability.upsert({
    where: { accountId_serviceType: { accountId: input.accountId, serviceType: input.serviceType } },
    update: {
      serviceCapabilityId: capability.id,
      availability: input.availability ?? {},
      active: true,
    },
    create: {
      accountId: input.accountId,
      serviceCapabilityId: capability.id,
      serviceType: input.serviceType,
      availability: input.availability ?? {},
      active: true,
    },
  });

  return capability;
}

export async function createSupportRequest(prisma: PrismaClient, input: CreateSupportRequestInput) {
  const requestedServices = input.requestedServices.map((service) => ({
    serviceType: service.serviceType,
    categoryId: service.categoryId?.trim() || null,
    trustRequirement: service.trustRequirement ?? "lightweight",
  }));

  const [group, project] = await Promise.all([
    prisma.group.findUnique({ where: { id: input.groupId }, include: { node: true } }),
    input.projectId ? prisma.project.findUnique({ where: { id: input.projectId } }) : Promise.resolve(null),
  ]);
  const sensitive = isSensitiveSupportRequest({ requestType: input.requestType, requestedServices });
  const privacyResolution = resolveEffectivePrivacy({
    dataClass: "support_request",
    requestedPrivacy: input.privacyLevel,
    requestedVisibility: input.privacyLevel,
    groupPreferences: parsePreferences(group?.privacyPreferences),
    projectPreferences: parsePreferences(project?.privacyPreferences),
    nodeConstraints: parsePreferences(group?.node.constitutionalPreferences),
    sensitive,
  });

  const supportRequest = await prisma.supportRequest.create({
    data: {
      id: input.id,
      submittedByAccountId: input.submittedByAccountId ?? null,
      guestRequestId: input.guestRequestId ?? null,
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      requestType: input.requestType,
      requestedServices,
      description: input.description,
      customNeed: input.customNeed ?? null,
      urgency: input.urgency ?? "normal",
      privacyLevel: privacyResolution.privacyLevel,
      status: "open",
      expiresAt: input.expiresAt ?? null,
    },
  });

  await prisma.privacyEnvelope.upsert({
    where: { targetType_targetId: { targetType: "SupportRequest", targetId: supportRequest.id } },
    update: {
      level: privacyResolution.privacyLevel,
      rules: {
        dataClass: "support_request",
        visibility: privacyResolution.visibility,
        federationAllowed: privacyResolution.federationAllowed,
        p2pAllowed: privacyResolution.p2pAllowed,
        retentionDays: privacyResolution.retentionDays,
        requiresEncryption: privacyResolution.requiresEncryption,
        explanation: privacyResolution.explanation,
      },
      createdBy: input.submittedByAccountId ?? null,
    },
    create: {
      targetType: "SupportRequest",
      targetId: supportRequest.id,
      level: privacyResolution.privacyLevel,
      rules: {
        dataClass: "support_request",
        visibility: privacyResolution.visibility,
        federationAllowed: privacyResolution.federationAllowed,
        p2pAllowed: privacyResolution.p2pAllowed,
        retentionDays: privacyResolution.retentionDays,
        requiresEncryption: privacyResolution.requiresEncryption,
        explanation: privacyResolution.explanation,
      },
      createdBy: input.submittedByAccountId ?? null,
    },
  });

  for (const service of requestedServices) {
    await prisma.supportRequestService.create({
      data: {
        supportRequestId: supportRequest.id,
        serviceType: service.serviceType,
        trustRequirement: service.trustRequirement,
        categoryId: service.categoryId,
      },
    });
  }

  await logAction(prisma, {
    actorAccountId: input.submittedByAccountId ?? null,
    groupId: input.groupId,
    projectId: input.projectId ?? null,
    action: "request.created",
    targetType: "support_request",
    targetId: supportRequest.id,
  });

  return supportRequest;
}

export async function routeSupportRequest(prisma: PrismaClient, input: RouteSupportRequestInput) {
  const now = input.now ?? new Date();
  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: input.supportRequestId },
    include: { group: true, services: true },
  });

  if (!supportRequest || !["open", "routed"].includes(supportRequest.status)) {
    return [];
  }

  if (supportRequest.expiresAt && supportRequest.expiresAt <= now) {
    return [];
  }

  const privacyResolution = await resolveSupportRequestPrivacy(prisma, supportRequest.id);
  const routePayloadRequest = {
    id: supportRequest.id,
    requestType: supportRequest.requestType,
    requestedServices: supportRequest.services.map((service) => ({ serviceType: service.serviceType, trustRequirement: service.trustRequirement })),
    urgency: supportRequest.urgency,
    privacyLevel: supportRequest.privacyLevel,
    description: supportRequest.description,
    submittedByAccountId: supportRequest.submittedByAccountId,
  };
  const routes = [];

  for (const requestedService of supportRequest.services) {
    // Category-based routing path: when a ContributionCategory is linked
    if (requestedService.categoryId) {
      const categoryRoutes = await routeByCategory(prisma, {
        supportRequest,
        requestedService,
        routePayloadRequest,
        privacyResolution,
      });
      routes.push(...categoryRoutes);
      continue;
    }

    // Custom (free-text) request path: no category, no capability. Route to the group's active
    // members — only for PUBLIC groups that opted in to accepting custom requests.
    if (requestedService.serviceType === "custom") {
      if (!supportRequest.group.acceptsCustomRequests || supportRequest.group.visibility !== "public") {
        continue;
      }
      // Consent-based routing: free-text custom requests reach only members who opted in to
      // accepting custom requests for THIS collective (per-collective consent), not everyone.
      const members = await prisma.groupMembership.findMany({
        where: {
          groupId: supportRequest.groupId,
          status: "active",
          participationStatus: "active",
          customAvailable: true,
          accountId: supportRequest.submittedByAccountId ? { not: supportRequest.submittedByAccountId } : undefined,
        },
        select: { accountId: true, customAvailability: true },
        orderBy: { accountId: "asc" },
      });
      for (const member of members) {
        if (!isCapabilityAvailable(member.customAvailability, [])) continue;
        const routeKey = {
          supportRequestId_contributorAccountId_serviceType_trustRequirement: {
            supportRequestId: supportRequest.id,
            contributorAccountId: member.accountId,
            serviceType: "custom",
            trustRequirement: requestedService.trustRequirement,
          },
        };
        const existingRoute = await prisma.requestRoute.findUnique({ where: routeKey });
        if (existingRoute?.status === "declined") continue;
        const route = await prisma.requestRoute.upsert({
          where: routeKey,
          update: existingRoute ? {} : { status: "notified" },
          create: {
            supportRequestId: supportRequest.id,
            contributorAccountId: member.accountId,
            serviceCapabilityId: null,
            serviceType: "custom",
            trustRequirement: requestedService.trustRequirement,
            status: "notified",
          },
        });
        if (!existingRoute) {
          await logAction(prisma, {
            groupId: supportRequest.groupId,
            action: "request.routed",
            targetType: "request_route",
            targetId: route.id,
            metadata: { supportRequestId: supportRequest.id, serviceType: "custom" },
          });
        }
        routes.push({ ...route, notificationPayload: buildRouteNotificationPayload(routePayloadRequest, privacyResolution) });
      }
      continue;
    }

    // String-based routing path (legacy / backward-compatible)
    const offering = await prisma.groupServiceOffering.findUnique({
      where: { groupId_serviceType: { groupId: supportRequest.groupId, serviceType: requestedService.serviceType } },
    });

    if (!offering || offering.status !== "active") {
      continue;
    }

    const effectiveTrust = resolveTrustThreshold(requestedService.trustRequirement, offering.minimumContributorTrust);
    const capabilityStatuses: ServiceCapabilityStatus[] = effectiveTrust === "lightweight" ? ["available", "approved"] : ["approved"];
    const capabilities = await prisma.serviceCapability.findMany({
      where: {
        serviceType: requestedService.serviceType,
        trustRequirement: effectiveTrust,
        approvalStatus: { in: capabilityStatuses },
        account: { groupMemberships: { some: { groupId: supportRequest.groupId, status: "active", participationStatus: "active" } } },
        accountId: supportRequest.submittedByAccountId ? { not: supportRequest.submittedByAccountId } : undefined,
      },
      include: {
        trustedRecords: true,
        availabilityRecords: true,
      },
      orderBy: [{ createdAt: "asc" }, { accountId: "asc" }],
    });

    for (const capability of capabilities) {
      if (!isCapabilityAvailable(capability.availability, capability.availabilityRecords)) {
        continue;
      }

      if (requestedService.trustRequirement === "elevated" && !hasApprovedGroupTrust(capability.trustedRecords, supportRequest.groupId, requestedService.serviceType)) {
        continue;
      }

      const existingRoute = await prisma.requestRoute.findUnique({
        where: {
          supportRequestId_contributorAccountId_serviceType_trustRequirement: {
            supportRequestId: supportRequest.id,
            contributorAccountId: capability.accountId,
            serviceType: requestedService.serviceType,
            trustRequirement: effectiveTrust,
          },
        },
      });

      if (existingRoute?.status === "declined") {
        continue;
      }

      const route = await prisma.requestRoute.upsert({
        where: {
          supportRequestId_contributorAccountId_serviceType_trustRequirement: {
            supportRequestId: supportRequest.id,
            contributorAccountId: capability.accountId,
            serviceType: requestedService.serviceType,
            trustRequirement: effectiveTrust,
          },
        },
        update: existingRoute ? {} : { status: "notified" },
        create: {
          supportRequestId: supportRequest.id,
          contributorAccountId: capability.accountId,
          serviceCapabilityId: capability.id,
          serviceType: requestedService.serviceType,
          trustRequirement: effectiveTrust,
          status: "notified",
        },
      });

      if (!existingRoute) {
        await logAction(prisma, {
          groupId: supportRequest.groupId,
          action: "request.routed",
          targetType: "request_route",
          targetId: route.id,
          metadata: { supportRequestId: supportRequest.id, serviceType: requestedService.serviceType },
        });
      }

      routes.push({
        ...route,
        notificationPayload: buildRouteNotificationPayload(routePayloadRequest, privacyResolution),
      });
    }
  }

  if (routes.length > 0 && supportRequest.status === "open") {
    await markSupportRequestRouted(prisma, supportRequest.id);
  }

  return routes.sort((left, right) => {
    if (left.createdAt.getTime() !== right.createdAt.getTime()) {
      return left.createdAt.getTime() - right.createdAt.getTime();
    }

    return left.contributorAccountId.localeCompare(right.contributorAccountId);
  });
}

export async function decideRequestRoute(prisma: PrismaClient, input: RouteDecisionInput) {
  const route = await prisma.requestRoute.findUnique({
    where: { id: input.routeId },
    include: { supportRequest: { select: { groupId: true } } },
  });

  if (!route || route.contributorAccountId !== input.contributorAccountId) {
    throw new Error("Only the routed contributor can decide this route.");
  }

  if (route.status !== "notified") {
    throw new Error(`Route cannot be decided from status ${route.status}.`);
  }

  const status = input.decision === "accepted" ? "accepted" : "declined";

  const updatedRoute = await prisma.requestRoute.update({
    where: { id: route.id },
    data: {
      status,
      decisionNote: input.decisionNote,
      decidedAt: input.decidedAt ?? new Date(),
    },
  });

  if (status === "accepted") {
    await prisma.supportRequest.update({
      where: { id: route.supportRequestId },
      data: { status: "matched" },
    });
  }

  await logAction(prisma, {
    actorAccountId: input.contributorAccountId,
    groupId: route.supportRequest?.groupId ?? null,
    action: status === "accepted" ? "route.accepted" : "route.declined",
    targetType: "request_route",
    targetId: route.id,
    metadata: { serviceType: route.serviceType, decisionNote: input.decisionNote },
  });

  return updatedRoute;
}

export async function createContributionFromAcceptedRoute(prisma: PrismaClient, input: CreateContributionFromRouteInput) {
  const route = await prisma.requestRoute.findUnique({
    where: { id: input.routeId },
    include: {
      contributor: true,
      supportRequest: true,
    },
  });

  if (!route || route.status !== "accepted") {
    throw new Error("A contribution can only be created from an accepted route.");
  }

  const contribution = await prisma.contribution.create({
    data: {
      id: input.id,
      contributorAccountId: route.contributorAccountId,
      groupId: route.supportRequest.groupId,
      projectId: route.supportRequest.projectId,
      contributionType: route.serviceType,
      description: `${route.contributor.displayName} provided ${route.serviceType} support.`,
      quantity: input.quantity ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      visibility: "group",
      privacyEnvelope: buildContributionPrivacyEnvelope(route.id),
    },
  });

  // Request remains "matched" — fulfillment requires explicit requester confirmation
  // via fulfillSupportRequest() in request-lifecycle.ts.
  return contribution;
}

type AvailabilityRecord = {
  active: boolean;
  availability: unknown;
};

export function isCapabilityAvailable(capabilityAvailability: unknown, availabilityRecords: AvailabilityRecord[]): boolean {
  if (availabilityHasAvailableNowFalse(capabilityAvailability)) {
    return false;
  }

  return !availabilityRecords.some((record) => record.active && availabilityHasAvailableNowFalse(record.availability));
}

function availabilityHasAvailableNowFalse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "availableNow" in value && (value as { availableNow?: unknown }).availableNow === false);
}

function hasApprovedGroupTrust(records: Array<{ groupId: string; trustContext: string; status: string }>, groupId: string, trustContext: string): boolean {
  return records.some((record) => record.groupId === groupId && record.trustContext === trustContext && record.status === "approved");
}

function resolveTrustThreshold(requesterPreference: string, groupMinimum: string): TrustRequirementValue {
  if (requesterPreference === "elevated" || groupMinimum === "elevated") {
    return "elevated";
  }
  return "lightweight";
}

type CategoryRoutingContext = {
  supportRequest: {
    id: string;
    groupId: string;
    submittedByAccountId: string | null;
  };
  requestedService: {
    serviceType: string;
    trustRequirement: string;
    categoryId: string | null;
  };
  routePayloadRequest: Parameters<typeof buildRouteNotificationPayload>[0];
  privacyResolution: Parameters<typeof buildRouteNotificationPayload>[1];
};

async function routeByCategory(
  prisma: PrismaClient,
  ctx: CategoryRoutingContext,
): Promise<RouteNotification[]> {
  const { supportRequest, requestedService } = ctx;
  const categoryId = requestedService.categoryId!;
  const trustRequirement = requestedService.trustRequirement as TrustRequirementValue;
  const routes: RouteNotification[] = [];

  if (trustRequirement === "elevated") {
    // Trusted providers only: query TrustedProviderStatus
    const trustedStatuses = await prisma.trustedProviderStatus.findMany({
      where: {
        categoryId,
        groupId: supportRequest.groupId,
        status: "active",
        membership: {
          status: "active",
          participationStatus: "active",
          accountId: supportRequest.submittedByAccountId
            ? { not: supportRequest.submittedByAccountId }
            : undefined,
        },
      },
      include: {
        membership: { select: { accountId: true } },
      },
      orderBy: { grantedAt: "asc" },
    });

    for (const trusted of trustedStatuses) {
      const accountId = trusted.membership.accountId;
      const route = await upsertCategoryRoute(prisma, ctx, accountId, trustRequirement);
      if (route) routes.push(route);
    }
  } else {
    // Any contributor: query ServiceCapability by categoryId
    const capabilities = await prisma.serviceCapability.findMany({
      where: {
        categoryId,
        approvalStatus: { in: ["available", "approved"] },
        account: {
          groupMemberships: {
            some: { groupId: supportRequest.groupId, status: "active", participationStatus: "active" },
          },
        },
        accountId: supportRequest.submittedByAccountId
          ? { not: supportRequest.submittedByAccountId }
          : undefined,
      },
      include: { availabilityRecords: true },
      orderBy: [{ createdAt: "asc" }, { accountId: "asc" }],
    });

    for (const capability of capabilities) {
      if (!isCapabilityAvailable(capability.availability, capability.availabilityRecords)) {
        continue;
      }
      const route = await upsertCategoryRoute(prisma, ctx, capability.accountId, trustRequirement);
      if (route) routes.push(route);
    }
  }

  return routes;
}

async function upsertCategoryRoute(
  prisma: PrismaClient,
  ctx: CategoryRoutingContext,
  contributorAccountId: string,
  trustRequirement: TrustRequirementValue,
): Promise<RouteNotification | null> {
  const { supportRequest, requestedService, routePayloadRequest, privacyResolution } = ctx;

  // Lightweight category routing still uses declared category capabilities.
  // Elevated routing is anchored by TrustedProviderStatus, so a service capability
  // record is optional there.
  const capability = await prisma.serviceCapability.findFirst({
    where: {
      accountId: contributorAccountId,
      categoryId: requestedService.categoryId!,
    },
    select: { id: true },
  });

  const existingRoute = await prisma.requestRoute.findUnique({
    where: {
      supportRequestId_contributorAccountId_serviceType_trustRequirement: {
        supportRequestId: supportRequest.id,
        contributorAccountId,
        serviceType: requestedService.serviceType,
        trustRequirement,
      },
    },
  });

  if (existingRoute?.status === "declined") return null;

  if (!capability && trustRequirement !== "elevated") {
    // No declared capability for this category; skip route creation
    return null;
  }

  const route = await prisma.requestRoute.upsert({
    where: {
      supportRequestId_contributorAccountId_serviceType_trustRequirement: {
        supportRequestId: supportRequest.id,
        contributorAccountId,
        serviceType: requestedService.serviceType,
        trustRequirement,
      },
    },
    update: existingRoute ? {} : { status: "notified" },
    create: {
      supportRequestId: supportRequest.id,
      contributorAccountId,
      serviceCapabilityId: capability?.id ?? null,
      serviceType: requestedService.serviceType,
      trustRequirement,
      status: "notified",
    },
  });

  if (!existingRoute) {
    await logAction(prisma, {
      groupId: supportRequest.groupId,
      action: "request.routed",
      targetType: "request_route",
      targetId: route.id,
      metadata: { supportRequestId: supportRequest.id, serviceType: requestedService.serviceType, categoryId: requestedService.categoryId },
    });
  }

  return { ...route, notificationPayload: buildRouteNotificationPayload(routePayloadRequest, privacyResolution) };
}
