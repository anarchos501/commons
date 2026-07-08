import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { requireActiveNodeUser } from "./node-governance";
import { openNodePetition, requireApprovedPetition, type OpenPetitionResult } from "./petitions";

// F3.5 Phase 0 (C0 core pulled forward): who may join the node is
// constitutional — like the node's name — so mode changes are node-wide
// petitions in both directions (never a delegated operational act). This does
// not conflict with "node-wide is for stopping", which governs federation
// acts under the steward mandate (register F-5).
//
// The mode feeds TWO consumers: registration legibility (gating itself ships
// with Workstream C0) and backup-hosting consent (register F-10). Until C0
// ships the gate, every node is honestly `open` — C0 flips the creation
// default to invite_only in the same commit that makes the label true.

const REGISTRATION_MODES = ["open", "invite_only"] as const;
export type RegistrationModeValue = (typeof REGISTRATION_MODES)[number];

export function isRegistrationMode(value: string): value is RegistrationModeValue {
  return (REGISTRATION_MODES as readonly string[]).includes(value);
}

export type ProposeRegistrationModeResult =
  | OpenPetitionResult
  | { ok: false; reason: "invalid_mode" | "already_set" | "not_eligible" };

export async function proposeRegistrationModeChange(
  prisma: PrismaClient,
  { nodeId, target, requestedByAccountId }: { nodeId: string; target: string; requestedByAccountId: string },
): Promise<ProposeRegistrationModeResult> {
  if (!isRegistrationMode(target)) return { ok: false, reason: "invalid_mode" };
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { registrationMode: true } });
  if (!node) return { ok: false, reason: "not_eligible" };
  if (node.registrationMode === target) return { ok: false, reason: "already_set" };
  try {
    await requireActiveNodeUser(prisma, nodeId, requestedByAccountId);
  } catch {
    return { ok: false, reason: "not_eligible" };
  }
  return openNodePetition(prisma, {
    nodeId,
    category: "node_stewardship",
    subjectType: "registration_mode_change",
    subjectId: `${nodeId}:${target}`,
  });
}

export async function applyRegistrationModeFromPetition(
  tx: Prisma.TransactionClient,
  petitionId: string,
): Promise<void> {
  const petition = await requireApprovedPetition(tx, petitionId, "registration_mode_change");
  const [nodeId, target] = petition.subjectId.split(":");
  if (!nodeId || !isRegistrationMode(target ?? "")) return;
  await tx.node.update({
    where: { id: nodeId },
    data: { registrationMode: target as RegistrationModeValue },
  });
}
