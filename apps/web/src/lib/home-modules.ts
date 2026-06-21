// Canonical capability-module identifiers for the person-centric home (the /dashboard surface).
// Mirrors group-modules.ts: pure constants/types shared by the disclosure lib and the app-side
// module registry without an app→lib import cycle. The home lifts the same disclosure machinery up
// a level — these ids live under the "home" scope in the shared UiDisclosurePreference store.

export const HOME_MODULE_IDS = [
  "active-threads", // the "Active" strip — your own live commitments (state), always on top
  "catch-up", // "while you were away" digest — what changed since you last visited each space
  "my-projects",
  "my-requests",
  "my-petitions",
  "my-concerns",
  "my-seats",
  "collectives", // your spaces (groups+projects+coalitions) — the drop-into-scoped-lens nav
  "calendar",
  "notifications",
  "request",
  "offer",
  "applications",
] as const;

export type HomeModuleId = (typeof HOME_MODULE_IDS)[number];

export type ModuleTier = "baseline" | "contextual";

// Baseline cluster: the egalitarian floor + the doors to action and navigation. Present by default
// for every account regardless of footprint (never trigger-gated); a user may still hide one via
// their own switch, but it always stays listed in the home map. `collectives` is baseline so a
// dormant member's way back into their spaces is always present (no self-locking doors).
export const HOME_BASELINE_MODULES: readonly HomeModuleId[] = [
  "active-threads",
  "collectives",
  "calendar",
  "notifications",
  "request",
  "offer",
] as const;

export const HOME_CONTEXTUAL_MODULES: readonly HomeModuleId[] = HOME_MODULE_IDS.filter(
  (id) => !HOME_BASELINE_MODULES.includes(id),
);

export function homeModuleTier(id: HomeModuleId): ModuleTier {
  return HOME_BASELINE_MODULES.includes(id) ? "baseline" : "contextual";
}

export function isHomeModuleId(value: string): value is HomeModuleId {
  return (HOME_MODULE_IDS as readonly string[]).includes(value);
}

// Human labels for the home map and module headers. Note: the "Active" strip (id `active-threads`)
// names a STATE — your live commitments — kept distinct in word and meaning from the delta surfaces
// (catch-up and the notification "updates" category). No gamification/obligation wording (guard 4/8).
export const HOME_MODULE_LABELS: Record<HomeModuleId, string> = {
  "active-threads": "Active",
  "catch-up": "Catch up",
  "my-projects": "My projects",
  "my-requests": "My requests",
  "my-petitions": "My petitions",
  "my-concerns": "My concerns",
  "my-seats": "My seats",
  collectives: "My collectives",
  calendar: "Calendar",
  notifications: "Notifications",
  request: "Request support",
  offer: "Offer support",
  applications: "My applications",
};
