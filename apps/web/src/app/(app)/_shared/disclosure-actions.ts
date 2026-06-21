"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import { isModuleId } from "../../../lib/group-modules";
import { isHomeModuleId } from "../../../lib/home-modules";
import { setModuleOverride, setUiDisclosurePreference, type DisclosureValue } from "../../../lib/ui-disclosure";

// Scope-aware progressive-disclosure switches, shared by the group workspace (CapabilityMap with
// scope="group") and the person-centric home (scope="home"). formData-driven so they wire to plain
// <form action> posts (no client JS). Each revalidates the right surface so a toggled card
// mounts/unmounts — and its slice loads — without a manual reload.
//
// Fields: scope ("group" | "home" | "global"), scopeId (the groupId for scope="group"), moduleId,
// and value ("show" | "hide" | anything-else-clears) / revealAll ("true" | "false").

function scopeKeyFor(scope: string, scopeId: string | null): string | null {
  if (scope === "global") return "global";
  if (scope === "home") return "home";
  if (scope === "group" && scopeId) return scopeId;
  return null;
}

// Where to revalidate so the toggled surface re-renders. A global toggle can affect either surface,
// so refresh the home plus the originating group page if one was supplied.
function revalidateTargets(scope: string, scopeId: string | null): string[] {
  if (scope === "home") return ["/dashboard"];
  if (scope === "group" && scopeId) return [`/groups/${scopeId}`];
  if (scope === "global") return scopeId ? ["/dashboard", `/groups/${scopeId}`] : ["/dashboard"];
  return [];
}

export async function setDisclosureOverrideAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const scope = (formData.get("scope") as string) || "group";
  const scopeId = (formData.get("scopeId") as string) || null;
  const moduleId = formData.get("moduleId") as string;
  const valueRaw = formData.get("value");
  const scopeKey = scopeKeyFor(scope, scopeId);
  if (!scopeKey || !moduleId || !(isModuleId(moduleId) || isHomeModuleId(moduleId))) return;
  const value: DisclosureValue | null =
    valueRaw === "show" ? "show" : valueRaw === "hide" ? "hide" : null; // anything else ("clear") clears the override
  const prisma = createPrismaClient();
  try {
    await setModuleOverride(prisma, session.accountId, scopeKey, moduleId, value);
  } finally {
    await prisma.$disconnect();
  }
  for (const path of revalidateTargets(scope, scopeId)) revalidatePath(path);
}

export async function setRevealAllAction(formData: FormData) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const scope = (formData.get("scope") as string) || "group";
  const scopeId = (formData.get("scopeId") as string) || null;
  const revealAll = formData.get("revealAll") === "true";
  const prisma = createPrismaClient();
  try {
    await setUiDisclosurePreference(prisma, session.accountId, { revealAll });
  } finally {
    await prisma.$disconnect();
  }
  for (const path of revalidateTargets(scope, scopeId)) revalidatePath(path);
}
