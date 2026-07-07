import { headers } from "next/headers";
import type { PrismaClient } from "../generated/prisma/client";

function isLocalHostAlias(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    // RFC 6761 reserves *.localhost for loopback — the two-node federation
    // dev harness relies on it (node-a.localhost / node-b.localhost).
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

// Normalizes the incoming Host header. Shared by node lookup and first-run
// node creation so both agree on what "this domain" means.
export function normalizeRequestHost(rawHost: string | null | undefined): string {
  const trimmed = rawHost?.trim().toLowerCase() ?? "";
  if (!trimmed) return "";

  const bracketedIpv6 = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) {
    return /^[0-9a-f:.]+$/.test(bracketedIpv6[1]) ? bracketedIpv6[1] : "";
  }

  const withoutPort = trimmed.replace(/:\d+$/, "");
  if (
    withoutPort.length > 253 ||
    withoutPort.includes("..") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(withoutPort)
  ) {
    return "";
  }
  return withoutPort;
}

export async function currentRequestHost(): Promise<string> {
  return normalizeRequestHost((await headers()).get("host"));
}

// Federation extension point: to support federated request links, accept a
// nodeDomain param and look up a remote node record instead of the current one.
export async function resolveCurrentNode(prisma: PrismaClient) {
  const host = await currentRequestHost();
  const byDomain = await prisma.node.findUnique({ where: { domain: host } });
  if (byDomain) return byDomain;

  const localNode = await prisma.node.findUnique({ where: { domain: "localhost" } });
  if (localNode && (!host || isLocalHostAlias(host))) return localNode;
  if (localNode) return localNode;

  return prisma.node.findFirst({ orderBy: { createdAt: "asc" } });
}

// Returns the public base origin (scheme + host, no trailing slash) for links shared
// OUTSIDE the app (guest request links, invite links). Prefers the node's own canonical
// `domain` — the multi-tenant identity — over the request Host header, which a reverse
// proxy can mangle to `localhost:3000`. Falls back to the request host (which carries the
// dev :port) only when the node domain is a localhost alias, so links stay clickable in
// local development.
export function resolvePublicBaseUrl(
  nodeDomain: string | null | undefined,
  requestHost: string | null | undefined,
): string {
  const domain = normalizeRequestHost(nodeDomain);
  if (domain && !isLocalHostAlias(domain)) {
    return `https://${domain}`;
  }
  const host = (requestHost ?? "").trim() || (nodeDomain ?? "").trim() || "localhost:3000";
  const proto = isLocalHostAlias(host.split(":")[0]) ? "http" : "https";
  return `${proto}://${host}`;
}

// Convenience: full absolute URL for a path, built on resolvePublicBaseUrl.
export function absoluteUrl(
  nodeDomain: string | null | undefined,
  requestHost: string | null | undefined,
  path: string,
): string {
  return `${resolvePublicBaseUrl(nodeDomain, requestHost)}${path.startsWith("/") ? path : `/${path}`}`;
}
