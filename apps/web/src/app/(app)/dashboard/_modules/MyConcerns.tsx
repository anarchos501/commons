import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { LocalTime } from "../../../../components/shared/LocalTime";

// Concerns you filed, as a navigable list into each group's concern process. Self-facing only —
// these are reports YOU authored (reportedByAccountId), so there's no audience leak.
export type MyConcern = { id: string; subject: string; status: string; href: string; createdAtIso: string };

export function MyConcerns({ concerns }: { concerns: MyConcern[] }) {
  return (
    <CollapsibleSection id="my-concerns" title="My concerns" eyebrow="Concerns you filed" storageKey="dashboard:my-concerns" className="bg-[var(--surface)] p-5 sm:p-6">
      {concerns.length ? (
        <ul className="space-y-2">
          {concerns.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="min-w-0">
                <a href={c.href} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{c.subject}</a>
                <p className="mt-0.5 text-xs text-[var(--muted)]">filed <LocalTime value={c.createdAtIso} options={{ month: "short", day: "numeric" }} /></p>
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">{c.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="You haven't filed any concern." />
      )}
    </CollapsibleSection>
  );
}
