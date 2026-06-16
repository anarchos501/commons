import { CollapsibleSection } from "./CollapsibleSection";
import { CalendarView } from "./CalendarView";
import { EventForm } from "./EventForm";
import type { CalendarEventClientView } from "../../lib/events";
import type { ConnectableAudience } from "../../lib/calendar-data";
import type { FormState } from "./form-state";

type Props = {
  sectionId: string;
  storageKey: string;
  events: CalendarEventClientView[];
  myInterests: Record<string, string>;
  audiences: ConnectableAudience[];
  canCreate: boolean;
  allowMeeting: boolean;
  currentAccountId: string | null;
  submitAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  interestAction: (fd: FormData) => Promise<void>;
  cancelAction: (fd: FormData) => Promise<void>;
};

/** The calendar section embedded on a space page (collective / project / responsibility / coalition). */
export function SpaceCalendar(props: Props) {
  return (
    <CollapsibleSection
      id={props.sectionId}
      title="Calendar"
      eyebrow="Coordination events"
      storageKey={props.storageKey}
      className="bg-[var(--surface)] p-5 sm:p-6"
    >
      <div className="space-y-4">
        {props.canCreate && (
          <EventForm action={props.submitAction} allowMeeting={props.allowMeeting} audiences={props.audiences} />
        )}
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
