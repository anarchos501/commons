/**
 * A small horizontal gauge showing where a group's aggregated governance preference
 * ("temperature", -1 careful → +1 permissive) sits on a restrictive↔permissive scale.
 * Pure/presentational — rendered above each governance characteristic.
 */
export function GovernanceMeter({ temperature }: { temperature: number }) {
  const clamped = Math.max(-1, Math.min(1, temperature));
  const pct = ((clamped + 1) / 2) * 100;
  const label =
    clamped > 0.2 ? "Group leans permissive" : clamped < -0.2 ? "Group leans careful" : "Group is balanced";

  return (
    <div className="mt-0.5" role="img" aria-label={label}>
      <div className="relative h-1.5 w-full max-w-[15rem] rounded-full bg-gradient-to-r from-blue-200 via-[var(--subtle)] to-green-200">
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--surface)] bg-[var(--text)] shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 flex max-w-[15rem] justify-between text-[10px] text-[var(--muted)]">
        <span>Restrictive</span>
        <span>Permissive</span>
      </div>
    </div>
  );
}
