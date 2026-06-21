import type { ModuleTier } from "../../lib/disclosure-view-core";
import { setDisclosureOverrideAction, setRevealAllAction } from "../../app/(app)/_shared/disclosure-actions";

// The always-visible orientation panel: every capability a surface can offer, present or not, each
// one switch away. Disclosure foregrounds; it never hides existence — so the doors to power and any
// latent authority always live here. Scope-generic: the group workspace renders it with collective
// copy (scope="group"), the person-centric home with home copy (scope="home"). The switches are
// plain <form action> posts (no client JS) to the shared scope-aware disclosure actions.

export type CapabilityMapCard = { id: string; label: string; tier: ModuleTier; present: boolean; transient: boolean };

export function CapabilityMap({
  cards,
  revealAll,
  scope,
  scopeId,
  eyebrow,
  heading,
  intro,
}: {
  cards: CapabilityMapCard[];
  revealAll: boolean;
  scope: "group" | "home";
  scopeId: string;
  eyebrow: string;
  heading: string;
  intro: string;
}) {
  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{eyebrow}</span>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-[var(--text)]">{heading}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{intro}</p>
        </div>
        <form action={setRevealAllAction} className="shrink-0">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="scopeId" value={scopeId} />
          <input type="hidden" name="revealAll" value={revealAll ? "false" : "true"} />
          <button type="submit" className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-1.5 text-xs font-medium text-[var(--soft-text)] transition hover:bg-[var(--hover)]">
            {revealAll ? "Minimal view" : "Show every section"}
          </button>
        </form>
      </div>
      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.id} className="flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
            <div className="min-w-0">
              <a href={`#${card.id}`} className="text-sm text-[var(--text)] hover:text-[var(--accent)]">{card.label}</a>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">{card.tier}</span>
              {card.transient && (
                <p className="mt-0.5 text-[11px] leading-4 text-amber-700">Hidden in your settings — shown via a link. Keep showing?</p>
              )}
            </div>
            <form action={setDisclosureOverrideAction} className="shrink-0">
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="scopeId" value={scopeId} />
              <input type="hidden" name="moduleId" value={card.id} />
              <input type="hidden" name="value" value={card.present && !card.transient ? "hide" : "show"} />
              <button type="submit" className="border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--soft-text)] transition hover:bg-[var(--hover)]">
                {card.transient ? "Keep showing" : card.present ? "Hide" : "Show"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
