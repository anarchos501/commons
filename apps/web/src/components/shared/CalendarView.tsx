"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LocalTime } from "./LocalTime";
import { EmptyState } from "./EmptyState";
import { EventInterestButtons } from "./EventInterestButtons";
import type { CalendarEventClientView } from "../../lib/events";

type Props = {
  events: CalendarEventClientView[];
  myInterests: Record<string, string>;
  interestAction: (formData: FormData) => Promise<void>;
  cancelAction?: (formData: FormData) => Promise<void>;
  currentAccountId: string | null;
};

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function CategoryBadge({ category }: { category: string }) {
  const isMeeting = category === "meeting";
  return (
    <span
      className={
        "inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (isMeeting
          ? "bg-[var(--accent)] text-[var(--accent-text)]"
          : "border border-[var(--border-strong)] text-[var(--muted)]")
      }
    >
      {isMeeting ? "Meeting" : "Workshop"}
    </span>
  );
}

function EventRow({
  event,
  current,
  interestAction,
  cancelAction,
  canCancel,
}: {
  event: CalendarEventClientView;
  current: string | undefined;
  interestAction: (formData: FormData) => Promise<void>;
  cancelAction?: (formData: FormData) => Promise<void>;
  canCancel: boolean;
}) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CategoryBadge category={event.category} />
            <Link href={`/events/${event.id}`} className="font-semibold text-[var(--text)] hover:underline">
              {event.title}
            </Link>
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            <LocalTime value={event.startTime} options={TIME_OPTS} />
            {" – "}
            <LocalTime value={event.endTime} options={TIME_OPTS} />
            {" · "}
            <span>{event.hostLabel}</span>
            {event.location ? <span> · {event.location}</span> : null}
          </div>
        </div>
        {canCancel && cancelAction ? (
          <form action={cancelAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <button type="submit" className="text-xs text-red-600 hover:underline">Cancel</button>
          </form>
        ) : null}
      </div>
      {event.description ? (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--soft-text)]">{event.description}</p>
      ) : null}
      <div className="mt-2">
        <EventInterestButtons eventId={event.id} current={current} counts={event.interestCounts} action={interestAction} />
      </div>
    </div>
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function AgendaView({ events, ...rest }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEventClientView[]>();
    for (const e of events) {
      const key = dayKey(e.startTime);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [events]);

  if (events.length === 0) return <EmptyState text="No upcoming events." />;

  return (
    <div className="space-y-5">
      {groups.map(([key, dayEvents]) => (
        <div key={key}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <LocalTime value={dayEvents[0].startTime} options={{ weekday: "short", month: "short", day: "numeric" }} />
          </h4>
          <div className="space-y-2">
            {dayEvents.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                current={rest.myInterests[e.id]}
                interestAction={rest.interestAction}
                cancelAction={rest.cancelAction}
                canCancel={rest.currentAccountId === e.createdByAccountId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function MonthView({ events }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarEventClientView[]>();
    for (const e of events) {
      const d = new Date(e.startTime);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const arr = map.get(d.getDate()) ?? [];
        arr.push(e);
        map.set(d.getDate(), arr);
      }
    }
    return map;
  }, [events, year, month]);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const step = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} className="min-h-9 px-2 py-1 text-sm text-[var(--soft-text)] hover:bg-[var(--hover)]">←</button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <button type="button" onClick={() => step(1)} className="min-h-9 px-2 py-1 text-sm text-[var(--soft-text)] hover:bg-[var(--hover)]">→</button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-[var(--border)] text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-[var(--subtle)] p-1 text-center font-semibold text-[var(--muted)]">{w}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="min-h-16 bg-[var(--surface)] p-1 align-top">
            {d !== null && (
              <>
                <div className="text-[10px] text-[var(--muted)]">{d}</div>
                <div className="space-y-0.5">
                  {(byDay.get(d) ?? []).map((e) => (
                    <Link
                      key={e.id}
                      href={`/events/${e.id}`}
                      title={e.title}
                      className={
                        "block truncate px-1 py-0.5 text-[10px] " +
                        (e.category === "meeting"
                          ? "bg-[var(--accent)] text-[var(--accent-text)]"
                          : "bg-[var(--subtle)] text-[var(--soft-text)]")
                      }
                    >
                      {e.title}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarView(props: Props) {
  const [view, setView] = useState<"list" | "month">("list");
  return (
    <div>
      <div className="mb-3 inline-flex border border-[var(--border-strong)]">
        {(["list", "month"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={
              "min-h-9 px-3 py-1 text-xs font-medium " +
              (view === v ? "bg-[var(--accent)] text-[var(--accent-text)]" : "bg-[var(--surface)] text-[var(--soft-text)] hover:bg-[var(--hover)]")
            }
          >
            {v === "list" ? "List" : "Month"}
          </button>
        ))}
      </div>
      {view === "list" ? <AgendaView {...props} /> : <MonthView {...props} />}
    </div>
  );
}
