import type { PrismaClient } from "../generated/prisma/client";
import {
  type GovernanceCategory,
  type ResolvedCategoryParams,
  isGovernanceCategory,
  resolveAllParameters,
} from "./governance-categories";
import { computeGroupTemperature } from "./governance-temperature";

export async function resolveGovernanceParams(
  prisma: PrismaClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<ResolvedCategoryParams> {
  if (!isGovernanceCategory(category)) {
    throw new Error(`Unknown governance category: "${category}"`);
  }
  const temperature = await computeGroupTemperature(prisma, groupId, category);
  return resolveAllParameters(category, temperature);
}

// Convenience: resolves all parameters for a category and returns them as a
// plain JSON-serializable snapshot suitable for Petition.governanceSnapshot.
export async function snapshotGovernanceParams(
  prisma: PrismaClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<ResolvedCategoryParams> {
  return resolveGovernanceParams(prisma, groupId, category);
}
