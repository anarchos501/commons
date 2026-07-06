"use client";

import { useState } from "react";
import { FormWithNotice } from "./FormWithNotice";
import { SubmitButton } from "./SubmitButton";
import type { FormState } from "./form-state";

type Audience = { audienceType: string; audienceId: string; label: string };

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  allowMeeting: boolean;
  audiences: Audience[];
};

const defaultTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

// The full IANA timezone list, so members pick from a dropdown rather than free-typing.
// Node 22 / modern browsers support Intl.supportedValuesOf; fall back to an empty list
// (the form then shows just the detected default) if the API is ever unavailable.
const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

const FIELD = "field-input w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm";

export function EventForm({ action, allowMeeting, audiences }: Props) {
  const [category, setCategory] = useState<"workshop" | "meeting">("workshop");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [timezone, setTimezone] = useState(defaultTz);
  const [visibility, setVisibility] = useState<"host_only" | "audience" | "public">("host_only");
  const [audienceCount, setAudienceCount] = useState(0);

  const startIso = startLocal ? new Date(startLocal).toISOString() : "";
  const endIso = endLocal ? new Date(endLocal).toISOString() : "";
  const needsPetition = category === "meeting" || audienceCount > 0;

  return (
    <details className="group/eventform border border-[var(--border)] bg-[var(--subtle)] p-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-[var(--soft-text)] select-none">
        + Schedule an event
      </summary>
      <FormWithNotice action={action} className="mt-3 space-y-3">
        {allowMeeting && (
          <div className="flex gap-4 text-sm">
            {(["workshop", "meeting"] as const).map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="category"
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                />
                <span className="capitalize">{c}</span>
              </label>
            ))}
          </div>
        )}
        {!allowMeeting && <input type="hidden" name="category" value="workshop" />}

        <label className="block">
          <span className="field-label text-xs text-[var(--muted)]">Title</span>
          <input name="title" type="text" required maxLength={200} className={FIELD} />
        </label>

        <label className="block">
          <span className="field-label text-xs text-[var(--muted)]">Description</span>
          <textarea name="description" rows={3} className={FIELD} placeholder="Purpose, agenda, materials, meeting link…" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label text-xs text-[var(--muted)]">Start</span>
            <input type="datetime-local" required value={startLocal} onChange={(e) => setStartLocal(e.target.value)} className={FIELD} />
            <input type="hidden" name="startTimeIso" value={startIso} />
          </label>
          <label className="block">
            <span className="field-label text-xs text-[var(--muted)]">End</span>
            <input type="datetime-local" required value={endLocal} onChange={(e) => setEndLocal(e.target.value)} className={FIELD} />
            <input type="hidden" name="endTimeIso" value={endIso} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label text-xs text-[var(--muted)]">Timezone</span>
            <select name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={FIELD}>
              {(TIMEZONES.length ? TIMEZONES : [timezone]).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label text-xs text-[var(--muted)]">Location (optional)</span>
            <input name="location" type="text" className={FIELD} placeholder="Address or link" />
          </label>
        </div>

        <fieldset className="space-y-1">
          <legend className="field-label text-xs text-[var(--muted)]">Who can see this</legend>
          {(
            [
              { v: "public", l: "Public" },
              { v: "host_only", l: "Host Entity Only" },
              { v: "audience", l: "Host & Selected Audience" },
            ] as const
          ).map((o) => (
            <label key={o.v} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="visibility"
                value={o.v}
                checked={visibility === o.v}
                onChange={() => {
                  setVisibility(o.v);
                  // The audience picker unmounts when leaving "audience", clearing its
                  // checkboxes — keep the count (and needsPetition) in sync.
                  if (o.v !== "audience") setAudienceCount(0);
                }}
              />
              <span>{o.l}</span>
            </label>
          ))}
        </fieldset>

        {visibility === "audience" &&
          (audiences.length > 0 ? (
            <fieldset className="space-y-1">
              <legend className="field-label text-xs text-[var(--muted)]">Audience spaces</legend>
              <p className="text-xs text-[var(--muted)]">
                The event will also appear on these spaces&rsquo; calendars. Sharing with another space requires
                collective authorization.
              </p>
              {audiences.map((a) => (
                <label key={`${a.audienceType}:${a.audienceId}`} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="audience"
                    value={`${a.audienceType}:${a.audienceId}`}
                    onChange={(e) => setAudienceCount((n) => n + (e.target.checked ? 1 : -1))}
                  />
                  <span>{a.label} <span className="text-[var(--muted)]">({a.audienceType})</span></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-xs text-[var(--muted)]">This space has no connected spaces to share the event with.</p>
          ))}

        {needsPetition && (
          <p className="text-xs text-[var(--muted)]">
            This {category === "meeting" ? "meeting" : "workshop reaches beyond its host, so it"} requires
            collective authorization — submitting opens a petition rather than creating the event directly.
          </p>
        )}

        <SubmitButton variant="secondary">{needsPetition ? "Propose event" : "Create workshop"}</SubmitButton>
      </FormWithNotice>
    </details>
  );
}
