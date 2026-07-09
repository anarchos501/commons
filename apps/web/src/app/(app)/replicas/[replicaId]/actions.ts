"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { openTakeoverChallenge } from "../../../../lib/continuity-lease";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { requiredString } from "../../../../lib/support-form";
import type { FormState } from "../../../../components/shared/form-state";

// Tier-2 annex actions (register F-8, log-only): any authenticated local
// account may post or record a join intent while a takeover is active. The
// action appends to the signed log — nothing materializes locally.
export async function performTakeoverActionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const replicaId = requiredString(formData, "replicaId");
  const actionType = requiredString(formData, "actionType");
  const body = formData.get("body");
  const prisma = createPrismaClient();
  try {
    const { performTakeoverAction } = await import("../../../../lib/continuity-takeover");
    const selfNode = await prisma.node.findFirst({ orderBy: { createdAt: "asc" }, select: { domain: true } });
    const result = await performTakeoverAction(prisma, {
      replicaId,
      actionType,
      action: typeof body === "string" && body.length > 0 ? { body } : {},
      actorLabel: `${session.displayName} @ ${selfNode?.domain ?? "this node"}`,
      actorAccountId: session.accountId,
    });
    if (!result.ok) {
      return {
        kind: "error",
        message:
          result.reason === "not_takeover_active"
            ? "This replica is not in failover — actions go to the community's home node."
            : "This action could not be recorded.",
      };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/replicas/${replicaId}`);
  return { kind: "success", message: "Recorded in the failover log. It will replay at the home node when it returns." };
}

// Any authenticated local account may pull the alarm (register F-9): the
// button reports unreachability; it never activates anything by itself.
export async function openTakeoverChallengeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const replicaId = requiredString(formData, "replicaId");
  const prisma = createPrismaClient();
  try {
    const result = await openTakeoverChallenge(prisma, { replicaId });
    if (!result.ok) {
      switch (result.reason) {
        case "cooldown":
          return { kind: "error", message: "A challenge was opened less than an hour ago. Give the last one time to travel." };
        case "replica_not_active":
          return { kind: "error", message: "This replica is not in a state that can be challenged." };
        default:
          return { kind: "error", message: "The challenge could not be opened." };
      }
    }
    if (result.alreadyOpen) {
      return { kind: "success", message: "A challenge is already open — the home node has until the failover window closes to prove life." };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/replicas/${replicaId}`);
  return { kind: "success", message: "Challenge opened. The home node — directly or through any peer — can cancel it by proving life." };
}
