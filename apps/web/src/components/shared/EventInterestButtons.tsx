"use client";

type Counts = { planning_to_attend: number; interested: number };

type Props = {
  eventId: string;
  current: string | undefined;
  counts: Counts;
  action: (formData: FormData) => Promise<void>;
};

/**
 * Two lightweight planning toggles showing aggregate totals only. The form submits the
 * caller's own choice (or withdraws it); the server never returns who responded.
 */
export function EventInterestButtons({ eventId, current, counts, action }: Props) {
  const button = (level: "planning_to_attend" | "interested", label: string, count: number) => {
    const active = current === level;
    return (
      <form action={action}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="level" value={active ? "none" : level} />
        <button
          type="submit"
          aria-pressed={active}
          className={
            "min-h-9 px-2.5 py-1 text-xs font-medium border " +
            (active
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
              : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--soft-text)] hover:bg-[var(--hover)]")
          }
        >
          {label} · {count}
        </button>
      </form>
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      {button("planning_to_attend", "Planning to attend", counts.planning_to_attend)}
      {button("interested", "Interested", counts.interested)}
    </div>
  );
}
