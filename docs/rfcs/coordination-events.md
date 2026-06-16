# RFC-008: Coordination Events & Shared Calendars

## Status

Draft

## Purpose

Commons spaces (Collectives, Projects, Responsibilities, Coalitions) and member dashboards have
no way to surface scheduled coordination — members must visit each space individually to learn
what is happening. This RFC defines a shared calendar and event system that operates across all
coordination spaces and personal dashboards, so a member can open their dashboard and
immediately answer:

- What decisions are being discussed?
- What opportunities are available?
- What am I interested in attending?
- What is happening across my collectives, projects, responsibilities, and coalitions?

The calendar exists to make coordination easier while preserving autonomy, privacy, and
collective self-governance.

---

## Constitutional Principle

**People should be free to organize activities. Collectives should consent before speaking or
acting as a collective body.**

Commons recognizes two categories of event:

### Meeting

A Meeting is defined as a gathering recognized by Commons as a legitimate decision-making venue
for a collective body. Because recognition itself grants procedural legitimacy, Meetings always
require authorization.

This is the reason a Meeting requires a petition even when it is informal: the answer to "why
does a Meeting need a petition when a Workshop doesn't?" is **not** "because meetings are
special." It is "because meetings are recognized as decision-making bodies, and that recognition
is what must be consented to." The petition authorizes the gathering itself — not any future
decisions made during it.

### Workshop

A Workshop is any voluntary coordination, education, training, discussion, planning, social, or
work-session event that carries no such recognition and therefore exercises no collective
authority on its own.

Examples: skill shares, training sessions, presentations, community discussions, volunteer work
sessions, social gatherings.

---

## Goals

- Make coordination opportunities easy to discover.
- Provide calendars for all collaboration spaces and a unified personal calendar.
- Distinguish governance events (Meetings) from coordination events (Workshops).
- Respect existing governance structures and privacy/visibility rules.
- Avoid attendance tracking, participation scoring, or managerial oversight.

## Non-Goals

Productivity monitoring, attendance enforcement, participation rankings, managerial oversight
tools, mandatory third-party calendar integrations.

---

## Authorization model

Authorization is triggered not merely by the Meeting/Workshop label, but by **whether the host
space is acting as a body** — modeled via **cross-space audience scope**. A petition in the host
space is required when:

- the event is a **Meeting** — *always* (a recognized decision-making venue, per the principle
  above); **or**
- it is a **Workshop hosted by a space whose audience includes a space other than the host
  itself** — e.g. a Collective hosting a workshop *for one of its coalitions*, or a Project
  hosting a workshop *for its collective*. Here the collective/project acts as a body toward
  another connected space, so that space's members must consent.

A petition is **not** required (direct creation) when:

- the event is **personal** (account-hosted by the creator); or
- it is a **Workshop hosted by a space with no external audience** — purely internal
  coordination an individual organizes within a space they belong to.

Concretely, the trigger is: `category === "meeting"` OR (`hostType !== "account"` AND the event
has ≥1 audience space that is not the host itself). The petition is always opened **in the host
space**.

```text
Meeting Proposal / cross-space Workshop Proposal
↓
Petition(s) in the host space
↓
All approve
↓
Calendar Event
```

This reuses the existing petition mechanism. An authorized member of a space may create an
internal workshop directly.

### Coalition events

Coalitions have no single voting electorate; coalition decisions are made by each member group
through its own petition. A coalition-hosted event that needs authorization therefore opens
**one petition per active member group** (an `EventProposal` with one `EventProposalPetition`
per group, mirroring `CoalitionProposal`). The event is created only when **all** member groups
approve; if any rejects, withdraws, or times out, the proposal fails and no event is created.

---

## Event fields

```text
Title · Description · Start Time · End Time · Timezone · Location
Visibility · Host Space · Audience Scope · Created By · Created At
```

The description carries purpose, agenda, materials, meeting links, and additional context. The
distinction between Meeting and Workshop is the only event categorization; no further event
types are required.

Times are stored in UTC; the timezone (an IANA identifier) is retained for display, and each
viewer sees times rendered in their own locale and timezone.

---

## Event ownership & host

Every event belongs to a single originating space — the **host**. A host is one of:

```text
Collective (group) · Project · Responsibility · Coalition · Account (personal)
```

Personal events are hosted by an Account and are visible only to their creator.

## Audience scope

An event may additionally be shown on the calendars of spaces the host is **legitimately
connected to** — and only those:

- **Collective** → a project it actively hosts, a responsibility it owns, a coalition it is an
  active member of.
- **Project** → its active host collectives.
- **Responsibility** → its owning collective.
- **Coalition** → any active participant collective.
- **Account (personal)** → no audience.

A project cannot schedule events for unrelated collectives; an individual cannot schedule events
for spaces they are not part of. These connectivity rules reuse the same joins as the existing
coordination-space ownership checks (`ProjectHosting`, `Responsibility.groupId`,
`CoalitionMembership`).

---

## Shared calendars

Every coordination space has a calendar containing all events it hosts plus events targeted to
it via audience scope. Each account has a **personal dashboard calendar** that aggregates events
from its collectives, projects, responsibilities, coalitions, and personal events. The dashboard
is a filtered *view*, not a duplicate — events remain owned by their host space.

### Filtering

Members may customize their dashboard view by event category (collectives / projects /
responsibilities / coalitions / personal) and by specific space. Preferences are stored per
account.

---

## Interest indicators

Commons supports lightweight planning signals. A member may indicate **Planning To Attend** or
**Interested**. Responses are aggregated and **only totals are displayed** (e.g. "23 Planning To
Attend · 11 Interested").

Commons does **not** display who selected which response, does **not** generate attendance
records, and does **not** create participation scores. A member's own selection is stored solely
to enforce one response per account and to let them change or withdraw it; it is never surfaced
to anyone else. The aggregate is read by a count-only query that never selects the responder
identity — the same pattern used for petition support counts.

---

## Privacy

Calendar visibility follows existing Commons visibility rules. A member may see events they are
entitled to view, aggregated interest counts, and event descriptions. A member must not see
private events outside their visibility scope, personal calendar data of others, individual
interest responses, or membership information revealed through event participation.

**Calendar aggregation must never leak private group membership.** The dashboard aggregation
queries only the spaces the viewer already belongs to (derived from the viewer's own
memberships), so it can never reveal that some other private group exists or who is in it. Event
visibility (`host_only` / `audience` / `public`) is enforced per event against the viewer's own
memberships only.

---

## Governance principles

Commons distinguishes:

- **Governance** — Meetings — collective authorization required.
- **Coordination** — Workshops — no collective authorization required (unless the workshop
  reaches beyond its host, per the authorization model above).

This reflects the principle that people should be free to organize activities, while collectives
should consent before acting as a collective body.

---

## Data model summary

- `CalendarEvent` — the canonical event (`category`, `hostType`/`hostId`, times, `timezone`,
  `visibility`, `authorizingPetitionId`, soft-cancel via `canceledAt`).
- `EventAudience` — additional target spaces (a queryable join table; empty = internal event).
- `EventInterest` — one row per account per event; read only as aggregate counts.
- `CalendarFilterPreference` — per-account dashboard filter preferences.
- `EventProposal` + `EventProposalPetition` — an event awaiting authorization and its child
  petition(s) (one per governing group; one for single-host events, one per member group for
  coalition events). Mirrors `CoalitionProposal`.

Governance wiring adds a `coordination` governance category and an `event_authorization`
proposal family; the petition-evaluation dispatcher applies an approved proposal once all its
child petitions pass, creating the `CalendarEvent`.

---

## Future Work

- **Meeting Outcomes / Minutes (future RFC).** The calendar system naturally leads to an event
  lifecycle beyond scheduling: `Event → happened → outcome → follow-up petitions`, especially
  for Meetings (recorded minutes, decisions taken, and petitions spawned from a meeting's
  outcomes). RFC-008 deliberately stops at scheduling and coordination; outcome capture and
  decision provenance are a separate, larger governance design.
- A month-grid is provided alongside the agenda list today; richer recurring-event support is
  out of scope.
