/**
 * A small horizontal gauge showing where a group's aggregated governance preference
 * ("temperature", -1 → +1) sits between the two factual extremes of a characteristic.
 * The ends are labelled with the actual values at each extreme (e.g. "95%" ↔ "5%",
 * "7d" ↔ "1d") rather than value-laden words like "restrictive"/"permissive", so the
 * gauge informs without implying that either end is better. Pure/presentational.
 */
export function GovernanceMeter({
  temperature,
  minLabel,
  maxLabel,
}: {
  temperature: number;
  // Value at the left (−1) end and the right (+1) end. Optional so the meter degrades
  // gracefully if a caller has no anchors to show.
  minLabel?: string;
  maxLabel?: string;
}) {
  const clamped = Math.max(-1, Math.min(1, temperature));
  const pct = ((clamped + 1) / 2) * 100;
  const ariaLabel =
    minLabel && maxLabel
      ? `Group setting sits between ${minLabel} and ${maxLabel}`
      : "Group setting on its range";

  return (
    <div className="mt-0.5" role="img" aria-label={ariaLabel}>
      <div className="relative h-1.5 w-full max-w-[15rem] rounded-full bg-gradient-to-r from-blue-200 via-[var(--subtle)] to-green-200">
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--surface)] bg-[var(--text)] shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      {minLabel && maxLabel && (
        <div className="mt-0.5 flex max-w-[15rem] justify-between text-[10px] text-[var(--muted)]">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
