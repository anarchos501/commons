import { headers } from "next/headers";
import type { PrismaClient } from "../generated/prisma/client";

// Federation extension point: to support federated request links, accept a
// nodeDomain param and look up a remote node record instead of the current one.
export async function resolveCurrentNode(prisma: PrismaClient) {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const byDomain = await prisma.node.findUnique({ where: { domain: host } });
  if (byDomain) return byDomain;
  return prisma.node.findFirst({ orderBy: { createdAt: "asc" } });
}
