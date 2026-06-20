import type { PrismaClient } from "../generated/prisma/client";
import { logAction } from "./action-log";

// Audit action recorded when an accepting helper reveals a requester's contact info through Commons.
// The log row stores only IDs — never the contact itself — so the access trail outlives the data
// without becoming a shadow copy of it.
export const CONTACT_VIEWED_ACTION = "request.contact_viewed";

/**
 * Logs that `actorAccountId` viewed the contact for `supportRequestId` — once per helper per
 * request (first reveal). Refreshing the detail page does not add rows, so the ledger answers
 * "who saw this person's contact, and when (first)" cleanly rather than counting page loads.
 */
export async function logContactViewedOnce(
  prisma: PrismaClient,
  { actorAccountId, groupId, supportRequestId, routeId }: { actorAccountId: string; groupId: string; supportRequestId: string; routeId: string },
): Promise<void> {
  const existing = await prisma.actionLog.findFirst({
    where: { actorAccountId, action: CONTACT_VIEWED_ACTION, targetId: supportRequestId },
    select: { id: true },
  });
  if (existing) return;
  await logAction(prisma, {
    actorAccountId,
    groupId,
    action: CONTACT_VIEWED_ACTION,
    targetType: "support_request",
    targetId: supportRequestId,
    metadata: { routeId },
  });
}

export type ContactAccessEntry = { accessorName: string; viewedAt: Date };

/**
 * The requester-facing ledger: who viewed this request's contact through Commons, and when.
 * NOTE: this reflects access through Commons only — it cannot show a node operator reading the
 * database directly. Surfaces must frame it precisely.
 */
export async function getContactAccessLog(
  prisma: PrismaClient,
  supportRequestId: string,
): Promise<ContactAccessEntry[]> {
  const rows = await prisma.actionLog.findMany({
    where: { action: CONTACT_VIEWED_ACTION, targetId: supportRequestId },
    select: { createdAt: true, actor: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ accessorName: r.actor?.displayName ?? "A helper", viewedAt: r.createdAt }));
}
