import type { PrismaClient } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { MODULE_IDS } from "./group-modules";
import { HOME_MODULE_IDS } from "./home-modules";

// Progressive-disclosure preferences: per-user show/hide switches over capability cards. Pure
// data access + resolution (no server-action side effects here, so it's safe to import from server
// components and from the action wrappers alike).
//
// Scope-generic by design: the same store backs both the group workspace (scope = "<groupId>") and
// the person-centric home (scope = "home"), plus a cross-surface "global" scope. Module ids are
// therefore typed as plain strings at the function boundaries; the runtime sanitizer (below) is the
// validator, whitelisting the union of every known group + home module id.

export type DisclosureValue = "show" | "hide";
export type ScopeOverrides = Partial<Record<string, DisclosureValue>>;
// Keyed by "global" + "<groupId>" + "home".
export type DisclosureOverrides = Record<string, ScopeOverrides>;
export type UiDisclosurePrefs = { revealAll: boolean; overrides: DisclosureOverrides };

// Union of every known module id across surfaces. `calendar` is the one id shared by group + home;
// it dedupes in the Set and is scope-separated in the overrides map, so there is no collision.
const MODULE_ID_SET = new Set<string>([...MODULE_IDS, ...HOME_MODULE_IDS]);

function sanitizeScope(raw: unknown): ScopeOverrides {
  const out: ScopeOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (MODULE_ID_SET.has(k) && (v === "show" || v === "hide")) out[k] = v;
  }
  return out;
}

function sanitizeOverrides(raw: unknown): DisclosureOverrides {
  const out: DisclosureOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [scope, map] of Object.entries(raw as Record<string, unknown>)) {
    const s = sanitizeScope(map);
    if (Object.keys(s).length) out[scope] = s;
  }
  return out;
}

export async function getUiDisclosurePreference(prisma: PrismaClient, accountId: string): Promise<UiDisclosurePrefs> {
  const row = await prisma.uiDisclosurePreference.findUnique({ where: { accountId } });
  if (!row) return { revealAll: false, overrides: {} };
  return { revealAll: row.revealAll, overrides: sanitizeOverrides(row.overrides) };
}

export type SetUiDisclosureInput = { revealAll?: boolean; overrides?: unknown };

export async function setUiDisclosurePreference(prisma: PrismaClient, accountId: string, input: SetUiDisclosureInput): Promise<void> {
  const sanitized = input.overrides !== undefined ? sanitizeOverrides(input.overrides) : undefined;
  const overridesValue =
    sanitized === undefined ? undefined : Object.keys(sanitized).length ? (sanitized as Prisma.InputJsonValue) : Prisma.JsonNull;
  await prisma.uiDisclosurePreference.upsert({
    where: { accountId },
    create: {
      accountId,
      revealAll: input.revealAll ?? false,
      overrides: sanitized && Object.keys(sanitized).length ? (sanitized as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
    update: {
      ...(input.revealAll !== undefined ? { revealAll: input.revealAll } : {}),
      ...(overridesValue !== undefined ? { overrides: overridesValue } : {}),
    },
  });
}

/** Sets/clears one module's override for a scope ("global" or a groupId), merging into existing prefs. */
export async function setModuleOverride(
  prisma: PrismaClient,
  accountId: string,
  scope: string,
  moduleId: string,
  value: DisclosureValue | null,
): Promise<void> {
  const current = await getUiDisclosurePreference(prisma, accountId);
  const overrides: DisclosureOverrides = { ...current.overrides };
  const scopeMap: ScopeOverrides = { ...(overrides[scope] ?? {}) };
  if (value === null) delete scopeMap[moduleId];
  else scopeMap[moduleId] = value;
  if (Object.keys(scopeMap).length) overrides[scope] = scopeMap;
  else delete overrides[scope];
  await setUiDisclosurePreference(prisma, accountId, { overrides });
}

/**
 * Effective presence of a module's card on the page:
 *  1. an explicit `?section=<id>` deep-link presents it transiently (beats a stored hide — a clicked
 *     link never silently no-ops), without changing the stored preference;
 *  2. else a scope-specific override wins (the groupId or "home"), then a global override;
 *  3. else `revealAll` shows everything not explicitly overridden;
 *  4. else the automatic foreground membership.
 */
export function resolveEffectiveVisibility(
  moduleId: string,
  scopeKey: string,
  foreground: ReadonlySet<string>,
  prefs: UiDisclosurePrefs,
  sectionParam?: string | null,
): DisclosureValue {
  if (sectionParam === moduleId) return "show";
  const scopeOv = prefs.overrides[scopeKey]?.[moduleId];
  if (scopeOv) return scopeOv;
  const globalOv = prefs.overrides.global?.[moduleId];
  if (globalOv) return globalOv;
  if (prefs.revealAll) return "show";
  return foreground.has(moduleId) ? "show" : "hide";
}
