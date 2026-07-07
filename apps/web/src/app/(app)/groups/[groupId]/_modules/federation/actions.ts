"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { proposeFederatedVisibility } from "../../../../../../lib/federated-visibility";
import type { FormState } from "../../../../../../components/shared/form-state";
import { requireMembership } from "../_shared/guards";

function stanceFailureMessage(reason: string): string {
  switch (reason) {
    case "invalid_stance": return "Choose a valid stance.";
    case "not_found": return "This collective could not be found.";
    case "private_group_not_grantable":
      return "Private collectives cannot hold a stance toward a peer node. A private collective is exposed cross-node only through deliberate shared acts (joining a cross-node coalition, co-hosting a project), scoped to that shared entity.";
    case "peer_not_found": return "That federated node could not be found.";
    case "already_set": return "This collective already holds that stance toward the node.";
    case "petition_already_open": return "A stance petition toward that node is already open.";
    case "creator_not_eligible": return "An active member must open this petition.";
    default: return "This stance change could not be proposed.";
  }
}

export async function proposeFederatedStanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const peerNodeId = requiredString(formData, "peerNodeId");
  const target = requiredString(formData, "target");

  const membership = await requireMembership(session.accountId, groupId);
  const prisma = createPrismaClient();
  try {
    const result = await proposeFederatedVisibility(prisma, {
      groupId,
      peerNodeId,
      target,
      createdByMembershipId: membership.id,
    });
    if (!result.ok) {
      return { kind: "error", message: stanceFailureMessage(result.reason) };
    }
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
  return { kind: "success", message: "Stance petition opened." };
}
