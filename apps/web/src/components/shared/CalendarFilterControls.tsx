"use client";

import { FormWithNotice } from "./FormWithNotice";
import { SubmitButton } from "./SubmitButton";
import type { FormState } from "./form-state";

type Current = {
  showGroupEvents: boolean;
  showProjectEvents: boolean;
  showResponsibilityEvents: boolean;
  showCoalitionEvents: boolean;
  showPersonalEvents: boolean;
};

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  current: Current;
};

const OPTIONS: { name: keyof Current; label: string }[] = [
  { name: "showGroupEvents", label: "Collectives" },
  { name: "showProjectEvents", label: "Projects" },
  { name: "showResponsibilityEvents", label: "Responsibilities" },
  { name: "showCoalitionEvents", label: "Coalitions" },
  { name: "showPersonalEvents", label: "Personal" },
];

export function CalendarFilterControls({ action, current }: Props) {
  return (
    <FormWithNotice action={action} className="mb-4 border-b border-[var(--border)] pb-3">
      <div className="flex flex-wrap items-center gap-3">
        {OPTIONS.map((o) => (
          <label key={o.name} className="flex items-center gap-1.5 text-xs text-[var(--soft-text)] cursor-pointer select-none">
            <input type="checkbox" name={o.name} defaultChecked={current[o.name]} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            {o.label}
          </label>
        ))}
        <SubmitButton variant="secondary">Apply</SubmitButton>
      </div>
    </FormWithNotice>
  );
}
