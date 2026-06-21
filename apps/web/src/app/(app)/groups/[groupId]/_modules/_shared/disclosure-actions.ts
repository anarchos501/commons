"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { isModuleId } from "../../../../../../lib/group-modules";
import { setModuleOverride, setUiDisclosurePreference, type DisclosureValue } from "../../../../../../lib/ui-disclosure";

// Progressive-disclosure switches for the RoomsMap. formData-driven so they can be wired to plain
// <form action> posts (no client JS). Each revalidates the group page so a toggled card
// mounts/unmounts — and its slice loads — without a manual reload.

export async function setDisclosureOverrideAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  const moduleId = formData.get("moduleId") as string;
  const scope = formData.get("scope") === "global" ? "global" : "group";
  const valueRaw = formData.get("value");
  if (!groupId || !moduleId || !isModuleId(moduleId)) return;
  const value: DisclosureValue | null =
    valueRaw === "show" ? "show" : valueRaw === "hide" ? "hide" : null; // anything else ("clear") clears the override
  const scopeKey = scope === "global" ? "global" : groupId;
  const prisma = createPrismaClient();
  try {
    await setModuleOverride(prisma, session.accountId, scopeKey, moduleId, value);
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}

export async function setRevealAllAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = formData.get("groupId") as string;
  if (!groupId) return;
  const revealAll = formData.get("revealAll") === "true";
  const prisma = createPrismaClient();
  try {
    await setUiDisclosurePreference(prisma, session.accountId, { revealAll });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/groups/${groupId}`);
}
