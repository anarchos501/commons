import type { Prisma } from "../generated/prisma/client";
import {
  type GovernanceCategory,
  type ResolvedCategoryParams,
  isGovernanceCategory,
  resolveAllParametersWithIndividualTemps,
} from "./governance-categories";
import { computeAllParameterTemperatures } from "./governance-temperature";

export async function resolveGovernanceParams(
  prisma: Prisma.TransactionClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<ResolvedCategoryParams> {
  if (!isGovernanceCategory(category)) {
    throw new Error(`Unknown governance category: "${category}"`);
  }
  const temperatures = await computeAllParameterTemperatures(prisma, groupId, category);
  return resolveAllParametersWithIndividualTemps(category, temperatures);
}

// Convenience: resolves all parameters for a category and returns them as a
// plain JSON-serializable snapshot suitable for Petition.governanceSnapshot.
export async function snapshotGovernanceParams(
  prisma: Prisma.TransactionClient,
  groupId: string,
  category: GovernanceCategory,
): Promise<ResolvedCategoryParams> {
  return resolveGovernanceParams(prisma, groupId, category);
}
