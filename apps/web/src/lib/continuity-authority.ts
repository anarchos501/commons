import type { Prisma, PrismaClient } from "../generated/prisma/client";

// F3.5 — the lease clock's AUTHORITY PREDICATE, alone in this module so the
// petition engine can import it without a dependency cycle (register F-9):
// petitions → continuity-authority, while the heartbeat side of continuity
// pulls in establishment/federations which pull in petitions.

export type WriteAuthority = "writable" | "read_only" | "unverified";

export function latestContact(peers: Array<{ lastSeenAt: Date | null; lastOutboundOkAt: Date | null }>): Date | null {
  let latest: Date | null = null;
  for (const peer of peers) {
    for (const stamp of [peer.lastSeenAt, peer.lastOutboundOkAt]) {
      if (stamp && (!latest || stamp > latest)) latest = stamp;
    }
  }
  return latest;
}

export async function resolveWriteAuthority(
  client: Prisma.TransactionClient | PrismaClient,
  ref: { entityType: string; entityId: string },
  options: { now?: Date } = {},
): Promise<WriteAuthority> {
  // State 1 (home-no-backup): one indexed miss, zero machinery.
  const backup = await client.entityBackup.findUnique({
    where: { entityType_entityId: { entityType: ref.entityType, entityId: ref.entityId } },
    select: { status: true, windowHours: true, verifiedAt: true, takeoverState: true },
  });
  if (!backup || backup.status !== "active") return "writable";

  // Quiet-boot (register F-9): verifiedAt NULL means this node cannot yet
  // trust its own DB about what happened while it was down.
  if (!backup.verifiedAt) return "unverified";

  // A known remote takeover (or cede in progress) is read-only until caught up.
  if (backup.takeoverState !== "none") return "read_only";

  // Mirror self-demotion: federation-isolated past W ⇒ read-only by our own
  // clock, regardless of what the backup is doing.
  const now = options.now ?? new Date();
  const peers = await client.federatedNode.findMany({
    where: { status: "active" },
    select: { lastSeenAt: true, lastOutboundOkAt: true },
  });
  const contact = latestContact(peers);
  if (!contact) return "read_only";
  const ageMs = now.getTime() - contact.getTime();
  return ageMs > backup.windowHours * 3_600_000 ? "read_only" : "writable";
}

