import { CalendarView } from "./CalendarView";
import { CalendarFilterControls } from "./CalendarFilterControls";
import { EventForm } from "./EventForm";
import type { CalendarEventClientView, ResolvedCalendarFilters } from "../../lib/events";
import type { FormState } from "./form-state";

type Props = {
  events: CalendarEventClientView[];
  myInterests: Record<string, string>;
  filters: ResolvedCalendarFilters;
  currentAccountId: string;
  submitAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  interestAction: (fd: FormData) => Promise<void>;
  cancelAction: (fd: FormData) => Promise<void>;
  filterAction: (prev: FormState, fd: FormData) => Promise<FormState>;
};

/** The aggregated personal calendar on the dashboard. */
export function DashboardCalendar(props: Props) {
  return (
    <section id="calendar" className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Across your spaces</span>
      <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)]">Calendar</h2>
      <p className="mt-1 mb-4 text-sm leading-6 text-[var(--soft-text)]">
        Events from your collectives, projects, responsibilities, coalitions, and personal plans.
      </p>

      <CalendarFilterControls action={props.filterAction} current={props.filters} />

      <div className="mb-4">
        <EventForm action={props.submitAction} allowMeeting={false} audiences={[]} />
      </div>

      <CalendarView
        events={props.events}
        myInterests={props.myInterests}
        interestAction={props.interestAction}
        cancelAction={props.cancelAction}
        currentAccountId={props.currentAccountId}
      />
    </section>
  );
}
