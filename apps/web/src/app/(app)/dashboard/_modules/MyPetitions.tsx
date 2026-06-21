import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { LocalTime } from "../../../../components/shared/LocalTime";

// Petitions you're party to (created/supported), as a navigable list into each group's petitions.
export type MyPetition = { id: string; label: string; groupName: string | null; href: string; closesAtIso: string };

export function MyPetitions({ petitions }: { petitions: MyPetition[] }) {
  return (
    <CollapsibleSection id="my-petitions" title="My petitions" eyebrow="Petitions you're party to" storageKey="dashboard:my-petitions" className="bg-[var(--surface)] p-5 sm:p-6">
      {petitions.length ? (
        <ul className="space-y-2">
          {petitions.map((p) => (
            <li key={p.id} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <a href={p.href} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{p.label}</a>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {p.groupName ? <>{p.groupName} · </> : null}closes <LocalTime value={p.closesAtIso} options={{ month: "short", day: "numeric" }} />
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="You're not party to any open petition." />
      )}
    </CollapsibleSection>
  );
}
