import { headers } from "next/headers";
import type { PrismaClient } from "../generated/prisma/client";

function isLocalHostAlias(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

// Federation extension point: to support federated request links, accept a
// nodeDomain param and look up a remote node record instead of the current one.
export async function resolveCurrentNode(prisma: PrismaClient) {
  const rawHost = (await headers()).get("host") ?? "";
  const host = rawHost.replace(/^\[|\]$/g, "").split(":")[0].toLowerCase();
  const byDomain = await prisma.node.findUnique({ where: { domain: host } });
  if (byDomain) return byDomain;

  const localNode = await prisma.node.findUnique({ where: { domain: "localhost" } });
  if (localNode && (!host || isLocalHostAlias(host))) return localNode;
  if (localNode) return localNode;

  return prisma.node.findFirst({ orderBy: { createdAt: "asc" } });
}
