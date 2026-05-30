import { createHash, randomBytes } from "node:crypto";
import type { GuestAccessToken, SupportRequest } from "../generated/prisma/client";
import type { PrismaClient } from "../generated/prisma/client";

export const DEFAULT_ACCOUNTABILITY_DAYS = 30;

// Status labels for UI surfaces. Both guest and member pages use this map.
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Submitted — looking for help",
  routed: "Looking for someone to help",
  matched: "A volunteer has accepted",
  fulfilled: "Help completed",
  expired: "Expired",
  deleted: "Removed",
};

// Concern reporting eligibility differs by how the request ended.
// Fulfilled requests anchor to accountabilityEndsAt; expired/deleted anchor to token.expiresAt.
export function concernWindowEndsAt(
  request: Pick<SupportRequest, "status" | "accountabilityEndsAt">,
  token: Pick<GuestAccessToken, "expiresAt"> | null,
): Date | null {
  if (request.status === "fulfilled" && request.accountabilityEndsAt) {
    return request.accountabilityEndsAt;
  }
  return token?.expiresAt ?? null;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function generateGuestAccessToken(
  prisma: PrismaClient,
  supportRequestId: string,
): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);

  await prisma.guestAccessToken.create({
    data: { tokenHash, supportRequestId },
  });

  return rawToken;
}

export async function validateGuestAccessToken(
  prisma: PrismaClient,
  rawToken: string,
): Promise<{ supportRequest: SupportRequest; token: GuestAccessToken }> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.guestAccessToken.findUnique({
    where: { tokenHash },
    include: { supportRequest: true },
  });

  if (!token || token.revokedAt !== null) {
    throw new Error("Access token is invalid or has been revoked.");
  }

  const now = new Date();
  if (token.expiresAt !== null && token.expiresAt <= now) {
    throw new Error("Access token has expired.");
  }

  return { supportRequest: token.supportRequest, token };
}

// Canonical state transition functions. These are the only callers of
// prisma.supportRequest.update({ data: { status: ... } }). All server actions
// must go through these functions to keep transition rules, side effects, and
// invariants in one place.

export async function markSupportRequestRouted(
  prisma: PrismaClient,
  supportRequestId: string,
): Promise<void> {
  await prisma.supportRequest.updateMany({
    where: { id: supportRequestId, status: "open" },
    data: { status: "routed" },
  });
}

export async function fulfillSupportRequest(
  prisma: PrismaClient,
  {
    supportRequestId,
    actorAccountId,
    rawToken,
  }: {
    supportRequestId: string;
    actorAccountId?: string | null;
    rawToken?: string | null;
  },
): Promise<void> {
  const request = await prisma.supportRequest.findUnique({
    where: { id: supportRequestId },
    include: { guestAccessToken: true },
  });

  if (!request) throw new Error("Support request not found.");
  if (request.status === "fulfilled") return; // idempotent

  // Validate actor: must be the submitting account or hold a valid token for this request
  if (actorAccountId) {
    if (request.submittedByAccountId !== actorAccountId) {
      throw new Error("Only the requester may mark this request as fulfilled.");
    }
  } else if (rawToken) {
    const tokenHash = hashToken(rawToken);
    if (!request.guestAccessToken || request.guestAccessToken.tokenHash !== tokenHash) {
      throw new Error("Access token does not match this request.");
    }
    if (request.guestAccessToken.revokedAt !== null) {
      throw new Error("Access token has been revoked.");
    }
  } else {
    throw new Error("Actor identity is required to fulfill a request.");
  }

  const accountabilityEndsAt = new Date();
  accountabilityEndsAt.setDate(accountabilityEndsAt.getDate() + DEFAULT_ACCOUNTABILITY_DAYS);

  await prisma.supportRequest.update({
    where: { id: supportRequestId },
    data: { status: "fulfilled", accountabilityEndsAt },
  });

  if (request.guestAccessToken) {
    await prisma.guestAccessToken.update({
      where: { id: request.guestAccessToken.id },
      data: { expiresAt: accountabilityEndsAt },
    });
  }
}

export async function deleteSupportRequest(
  prisma: PrismaClient,
  {
    supportRequestId,
    actorAccountId,
    rawToken,
  }: {
    supportRequestId: string;
    actorAccountId?: string | null;
    rawToken?: string | null;
  },
): Promise<void> {
  const request = await prisma.supportRequest.findUnique({
    where: { id: supportRequestId },
    include: { guestAccessToken: true },
  });

  if (!request) throw new Error("Support request not found.");
  if (request.status === "deleted") return; // idempotent

  if (actorAccountId) {
    if (request.submittedByAccountId !== actorAccountId) {
      throw new Error("Only the requester may delete this request.");
    }
  } else if (rawToken) {
    const tokenHash = hashToken(rawToken);
    if (!request.guestAccessToken || request.guestAccessToken.tokenHash !== tokenHash) {
      throw new Error("Access token does not match this request.");
    }
    if (request.guestAccessToken.revokedAt !== null) {
      throw new Error("Access token has been revoked.");
    }
  } else {
    throw new Error("Actor identity is required to delete a request.");
  }

  // status = deleted removes the request from all normal UI surfaces immediately.
  // Description and contact details are NOT cleared here — they remain available
  // for concern review during the accountability window. Vulnerable content is
  // removed by a separate privacy-cleanup pass after the accountability window closes.
  await prisma.supportRequest.update({
    where: { id: supportRequestId },
    data: { status: "deleted" },
  });

  if (request.guestAccessToken) {
    await prisma.guestAccessToken.update({
      where: { id: request.guestAccessToken.id },
      data: { revokedAt: new Date() },
    });
  }
}
