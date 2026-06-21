// Single source of truth for the petition "Details" disclosure — the outcome line,
// "Proposed by", and the type-specific fields. Shared by the collective PetitionCard
// and the dashboard's MyPetitions / ActiveThreads so the three never drift. Server
// component: native <details>, no client JS.
export function PetitionDetails({
  outcome,
  proposer,
  fields,
}: {
  outcome: string;
  proposer: string | null;
  fields: { label: string; value: string }[];
}) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-[var(--accent)] hover:underline">Details</summary>
      <dl className="mt-2 grid gap-1 text-[var(--soft-text)]">
        <div><p className="text-[var(--text)]">{outcome}</p></div>
        {proposer && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-[var(--muted)]">Proposed by</dt>
            <dd>{proposer}</dd>
          </div>
        )}
        {fields.map((field) => (
          <div key={field.label} className="flex gap-2">
            <dt className="shrink-0 text-[var(--muted)]">{field.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{field.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
