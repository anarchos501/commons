import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { LocalTime } from "../../../../components/shared/LocalTime";

// Responsibilities / seats you hold across spaces, as a navigable list into each group's
// responsibilities. Capitalizes the role type for display.
export type MySeat = { id: string; type: string; groupName: string; href: string; expiresAtIso: string };

function label(type: string): string {
  return type.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MySeats({ seats }: { seats: MySeat[] }) {
  return (
    <CollapsibleSection id="my-seats" title="My seats" eyebrow="Responsibilities you hold" storageKey="dashboard:my-seats" className="bg-[var(--surface)] p-5 sm:p-6">
      {seats.length ? (
        <ul className="space-y-2">
          {seats.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-2 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="min-w-0">
                <a href={s.href} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{label(s.type)}</a>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{s.groupName}</p>
              </div>
              <span className="shrink-0 text-[10px] text-[var(--muted)]">until <LocalTime value={s.expiresAtIso} options={{ month: "short", day: "numeric" }} /></span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="You don't hold any responsibility right now." />
      )}
    </CollapsibleSection>
  );
}
