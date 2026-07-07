import type { FederatedNode, Prisma, PrismaClient } from "../generated/prisma/client";
type DbClient = Prisma.TransactionClient | PrismaClient;

// Loopback detection for peer addresses, including the RFC 6761 *.localhost
// TLD the two-node dev harness uses (node-a.localhost / node-b.localhost).
// Deliberately not imported from node-context.ts: that module pulls in
// next/headers, which lib code exercised by node:test must not depend on.
export function isLoopbackPeerAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/:\d+$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

// Peer addresses are https-only; plain http is permitted for loopback
// addresses only, mirroring resolvePublicBaseUrl's dev allowance.
export function peerBaseUrl(address: string): string {
  return `${isLoopbackPeerAddress(address) ? "http" : "https"}://${address}`;
}

export type WellKnownCommons = {
  commons: true;
  version: number;
  node: { name: string; domain: string };
  publicKey: string;
  keyId: string;
  federation: string;
  endpoints: { inbox: string };
};

function parseWellKnownCommons(value: unknown): WellKnownCommons | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const node = record.node as Record<string, unknown> | undefined;
  const endpoints = record.endpoints as Record<string, unknown> | undefined;
  if (
    record.commons !== true ||
    typeof record.version !== "number" ||
    typeof node?.name !== "string" ||
    typeof node?.domain !== "string" ||
    !node.domain ||
    typeof record.publicKey !== "string" ||
    !record.publicKey.includes("BEGIN PUBLIC KEY") ||
    typeof record.keyId !== "string" ||
    typeof record.federation !== "string" ||
    typeof endpoints?.inbox !== "string" ||
    !endpoints.inbox
  ) {
    return null;
  }
  return {
    commons: true,
    version: record.version,
    node: { name: node.name, domain: node.domain },
    publicKey: record.publicKey,
    keyId: record.keyId,
    federation: record.federation,
    endpoints: { inbox: endpoints.inbox },
  };
}

export type PinPeerResult =
  | { ok: true; peer: FederatedNode; wellKnown: WellKnownCommons }
  | { ok: false; reason: "unreachable" | "invalid_response" | "key_mismatch" };

// register F-4: inboxUrl is UNTRUSTED routing metadata, self-reported by the
// peer in its well-known response. Only domain + the pinned key authenticate;
// nothing security-relevant may ever key off the delivery address. A peer
// pointing inboxUrl elsewhere can at worst misdeliver its own traffic — it
// can never redirect trust or impersonate, because envelopes are verified
// against the key pinned to the origin DOMAIN, not to the address.

// TOFU pinning (register F-3): first contact stores the peer's key; any later
// response presenting a different key is refused rather than silently repinned.
// Key rotation gets an explicit, countersigned path in F5 — never this one.
export async function pinPeer(
  prisma: PrismaClient,
  address: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<PinPeerResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let body: unknown;
  try {
    const response = await fetchImpl(`${peerBaseUrl(address)}/.well-known/commons`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ok: false, reason: "unreachable" };
    body = await response.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  const wellKnown = parseWellKnownCommons(body);
  if (!wellKnown) return { ok: false, reason: "invalid_response" };

  const domain = wellKnown.node.domain.toLowerCase();
  const existing = await prisma.federatedNode.findUnique({ where: { domain } });
  if (existing) {
    if (existing.publicKey !== wellKnown.publicKey) {
      return { ok: false, reason: "key_mismatch" };
    }
    const peer = await prisma.federatedNode.update({
      where: { id: existing.id },
      data: {
        displayName: wellKnown.node.name,
        inboxUrl: wellKnown.endpoints.inbox,
        policySnapshot: { federation: wellKnown.federation } as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
    });
    return { ok: true, peer, wellKnown };
  }

  const peer = await prisma.federatedNode.create({
    data: {
      domain,
      displayName: wellKnown.node.name,
      publicKey: wellKnown.publicKey,
      inboxUrl: wellKnown.endpoints.inbox,
      policySnapshot: { federation: wellKnown.federation } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, peer, wellKnown };
}

export async function getPeerByDomain(prisma: DbClient, domain: string): Promise<FederatedNode | null> {
  return prisma.federatedNode.findUnique({ where: { domain: domain.toLowerCase() } });
}

// A minimal Node row for a known peer. The spine designed presences and
// accounts to reference Node rows (LinkedNodePresence.nodeId,
// Account.homeNodeId), so a remote node this DB must describe gets one —
// identity metadata only; peering state and the pinned key stay on
// FederatedNode. Inert for local resolution: resolveCurrentNode matches the
// request host or falls back to the OLDEST node, and the local node always
// predates any peer row.
export async function ensurePeerNodeRow(
  prisma: DbClient,
  input: { domain: string; name?: string | null },
): Promise<{ id: string }> {
  const domain = input.domain.toLowerCase();
  const existing = await prisma.node.findUnique({ where: { domain }, select: { id: true } });
  if (existing) return existing;
  try {
    return await prisma.node.create({
      data: { domain, name: input.name?.trim() || domain },
      select: { id: true },
    });
  } catch (error) {
    const raced = await prisma.node.findUnique({ where: { domain }, select: { id: true } });
    if (raced) return raced;
    throw error;
  }
}

export async function touchPeerLastSeen(prisma: PrismaClient, peerId: string): Promise<void> {
  await prisma.federatedNode.update({ where: { id: peerId }, data: { lastSeenAt: new Date() } });
}
