import { resolveEffectiveVisibility, type UiDisclosurePrefs } from "./ui-disclosure";

// Shared core for the disclosure resolvers. Both the group workspace (resolveGroupView) and the
// person-centric home (resolveHomeView) compute "which capability cards are present" and "the card
// list for the map" the same way — the only differences are the module-id set, the scope key, the
// labels, and the tier function. Extracting this keeps the two resolvers from diverging and lets the
// group-page change be behavior-preserving (its unit tests pin it). The domain-specific part — the
// *foreground* rules — stays in each resolver, since that's where group vs home genuinely differ.

export type ModuleTier = "baseline" | "contextual";

export type DisclosureCard<Id extends string> = {
  id: Id;
  label: string;
  tier: ModuleTier;
  present: boolean;
};

/**
 * Given a module-id set, the computed foreground, the user's prefs, and the scope/section signals,
 * resolve the present set (effective visibility === "show") and the full card list for the map.
 * Pure — no I/O. `section` presents a targeted card transiently (handled in resolveEffectiveVisibility).
 */
export function computePresentAndCards<Id extends string>(
  moduleIds: readonly Id[],
  scopeKey: string,
  foreground: ReadonlySet<Id>,
  prefs: UiDisclosurePrefs,
  section: string | null | undefined,
  labels: Record<Id, string>,
  tierFn: (id: Id) => ModuleTier,
): { present: Set<Id>; cards: DisclosureCard<Id>[] } {
  const present = new Set<Id>();
  for (const id of moduleIds) {
    if (resolveEffectiveVisibility(id, scopeKey, foreground, prefs, section ?? null) === "show") {
      present.add(id);
    }
  }
  const cards: DisclosureCard<Id>[] = moduleIds.map((id) => ({
    id,
    label: labels[id],
    tier: tierFn(id),
    present: present.has(id),
  }));
  return { present, cards };
}
