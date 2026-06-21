import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";
import { LocalTime } from "../../../../components/shared/LocalTime";
import { PetitionDetails } from "../../../../components/shared/PetitionDetails";

// Petitions you're party to (created/supported). Each row states HOW you're involved (feedback #6)
// and expands to the full details (feedback #5).
export type MyPetition = {
  id: string;
  label: string;
  groupName: string | null;
  href: string;
  closesAtIso: string;
  involvement: string | null; // "You proposed" | "You support" | null
  outcome: string;
  proposer: string | null;
  detailFields: { label: string; value: string }[];
};

export function MyPetitions({ petitions }: { petitions: MyPetition[] }) {
  return (
    <CollapsibleSection id="my-petitions" title="My petitions" eyebrow="Petitions you're party to" storageKey="dashboard:my-petitions" className="bg-[var(--surface)] p-5 sm:p-6">
      {petitions.length ? (
        <ul className="space-y-2">
          {petitions.map((p) => (
            <li key={p.id} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a href={p.href} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{p.label}</a>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {p.groupName ? <>{p.groupName} · </> : null}closes <LocalTime value={p.closesAtIso} options={{ month: "short", day: "numeric" }} />
                  </p>
                </div>
                {p.involvement && (
                  <span className="shrink-0 whitespace-nowrap border border-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                    {p.involvement}
                  </span>
                )}
              </div>
              <PetitionDetails outcome={p.outcome} proposer={p.proposer} fields={p.detailFields} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="You're not party to any open petition." />
      )}
    </CollapsibleSection>
  );
}
