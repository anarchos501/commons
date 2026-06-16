import type { AudienceInput, SubmitEventInput } from "./events";
import type { EventCategory, EventHostType, EventVisibility } from "../generated/prisma/enums";

const HOST_TYPES: EventHostType[] = ["group", "project", "responsibility", "coalition", "account"];
const VISIBILITIES: EventVisibility[] = ["host_only", "audience", "public"];

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Parses an event-creation form into a SubmitEventInput. Times arrive as ISO instants
 * (`startTimeIso`/`endTimeIso`) that the browser computed from datetime-local inputs in
 * the viewer's timezone; the `timezone` field records the intended display tz. Audience
 * checkboxes are encoded as `audience` values of the form `type:id`.
 */
export function parseEventSubmission(
  formData: FormData,
  base: { accountId: string; hostType: EventHostType; hostId: string },
): SubmitEventInput {
  const category: EventCategory = formData.get("category") === "meeting" ? "meeting" : "workshop";
  const rawVisibility = str(formData, "visibility");
  const visibility: EventVisibility = (VISIBILITIES as string[]).includes(rawVisibility)
    ? (rawVisibility as EventVisibility)
    : "host_only";

  const audiences: AudienceInput[] = [];
  for (const raw of formData.getAll("audience")) {
    if (typeof raw !== "string") continue;
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const type = raw.slice(0, idx);
    const id = raw.slice(idx + 1);
    if ((HOST_TYPES as string[]).includes(type) && id) {
      audiences.push({ audienceType: type as EventHostType, audienceId: id });
    }
  }

  const startIso = str(formData, "startTimeIso");
  const endIso = str(formData, "endTimeIso");

  return {
    accountId: base.accountId,
    category,
    hostType: base.hostType,
    hostId: base.hostId,
    title: str(formData, "title"),
    description: str(formData, "description") || null,
    startTime: new Date(startIso),
    endTime: new Date(endIso),
    timezone: str(formData, "timezone") || "UTC",
    location: str(formData, "location") || null,
    visibility,
    audiences,
  };
}

export function submitEventFailureMessage(reason: string): string {
  switch (reason) {
    case "missing_title": return "Give this event a title.";
    case "invalid_start":
    case "invalid_end": return "Choose a valid start and end time.";
    case "invalid_time_range": return "The event must end after it starts.";
    case "invalid_timezone": return "Choose a valid timezone.";
    case "requires_authorization": return "This event reaches beyond its host and needs a petition — it was not created directly.";
    case "no_authorization_needed": return "This event does not require authorization.";
    case "audience_not_connected": return "One of the chosen audiences is not connected to this space.";
    case "meeting_requires_collective": return "Meetings must be hosted by a collective body, not a personal account.";
    case "coalition_has_no_members": return "This coalition has no active member groups to authorize the event.";
    case "creator_not_eligible": return "You are not eligible to schedule this event.";
    case "petition_already_open": return "A matching petition is already open.";
    default: return "This event could not be scheduled.";
  }
}
