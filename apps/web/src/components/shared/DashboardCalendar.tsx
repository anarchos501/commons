import { CollapsibleSection } from "./CollapsibleSection";
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

/** The aggregated personal calendar on the dashboard. Collapsible like the other cards. */
export function DashboardCalendar(props: Props) {
  return (
    <CollapsibleSection id="calendar" title="Calendar" eyebrow="Across your spaces" storageKey="dashboard:calendar">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--soft-text)]">
          Events from your collectives, projects, responsibilities, coalitions, and personal plans.
        </p>

        <CalendarFilterControls action={props.filterAction} current={props.filters} />

        <EventForm action={props.submitAction} allowMeeting={false} audiences={[]} />

        <CalendarView
          events={props.events}
          myInterests={props.myInterests}
          interestAction={props.interestAction}
          cancelAction={props.cancelAction}
          currentAccountId={props.currentAccountId}
        />
      </div>
    </CollapsibleSection>
  );
}
