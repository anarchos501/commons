# RFC-006: Governance & Activation

## Status

Draft

## Purpose

Commons requires a coherent mechanism for communities to express, aggregate, and act on collective governance preferences. Responsibilities need community confirmation. Living documents need revision approval. Archival needs community consent. Emergency coverage needs activation.

This RFC establishes:

- The complete governance loop: preference → temperature → friction → petition → outcome
- Nine canonical governance categories with typed parameter registries
- The distinction between governance categories and proposal families
- Weighted temperature aggregation with Active and Quiet member influence
- How temperatures modify governance parameters (threshold, petition duration)
- The governance temperature resolver architecture
- MemberGovernanceSignal for individual preference recording
- The Petition infrastructure for governance decisions
- Emergency declaration and activation mechanics

---

## Constitutional Principle

**Governance temperatures determine how difficult collective decisions are.**

They do not govern ordinary coordination activities. Governance temperatures configure friction — the amount of collective consent required before a community decision takes effect.

The complete governance loop:

```
Members express preference signals (−1 / 0 / +1)
      ↓
Signals aggregate into a governance temperature (−1.000 to +1.000)
      ↓
Temperature interpolates governance parameters (threshold, petition duration)
      ↓
Parameters govern how petitions open and close
      ↓
Petitions decide outcomes
```

No member, responsibility holder, or responsibility exercises governance authority unilaterally. Temperatures measure collective preference. Parameters shape how petitions work. Petitions decide outcomes.

Governance is scoped to the group. Temperature signals are group-level. Petition decisions are group-level. The governance loop operates entirely within the group.

---

## Governance Categories vs Proposal Families

These are not the same concept.

**Governance categories** determine which temperature settings and parameters apply to a decision.

**Proposal families** describe the specific action being proposed.

| Governance Category | Example Proposal Families |
| --- | --- |
| `membership` | Membership Request |
| `project` | Project Proposal |
| `responsibility` | Responsibility Proposal |
| `accountability` | Concern Action Proposal |
| `living_document` | Living Document Revision |
| `archival` | Archive Proposal |
| `emergency` | Emergency Declaration |
| `support_request` | Collective Support Request |
| `contribution_offer` | Collective Contribution Offer |

A proposal family selects which governance category applies. The category supplies the resolved threshold, petition duration, and other parameters that govern whether the proposal passes.

---

## Governance Temperature

### Signal model

Every member expresses a preference direction. Signal values are limited to:

```
−1  More Restrictive
 0  Neutral (default; no preference expressed)
+1  Less Restrictive
```

Members signal preference direction, not preference intensity. Every member contributes the same potential influence. This prevents strategic weighting.

**No signal record and signal = 0 are intentionally equivalent governance states.** A member who has never set a signal contributes 0 to the weighted sum, the same as a member who explicitly chose neutral. This is by design — the model does not distinguish between "hasn't expressed a preference yet" and "has no preference." Both mean the same thing for aggregation purposes.

### Weighted aggregation

Participation status determines influence weight:

| Participation status | Weight |
| --- | --- |
| Active | 1.0 |
| Quiet | 0.5 |
| Dormant | 0 (excluded) |

Quiet members count toward governance temperature but with half the influence of Active members. This captures that Quiet members remain part of the community and should have voice, while recognizing their reduced engagement. Dormant members have no influence.

Temperature is calculated as:

```
weightedSignalSum    = sum(signal × weight for each eligible member WITH a signal record)
maximumPossibleWeight = sum(weight for each eligible member, signal record or not)
temperature          = weightedSignalSum / maximumPossibleWeight
```

Result: a value in [−1.000, +1.000] to three decimal places.

**Signal absence is equivalent to signal = 0 for aggregation.** Members with no `MemberGovernanceSignal` record contribute 0 to `weightedSignalSum` and their weight to `maximumPossibleWeight` — identical to holding an explicit signal of 0.

**Examples:**

```
100 active members, 1 signals +1, 99 signal 0:
  weightedSignalSum = 1.0
  maximumPossibleWeight = 100.0
  temperature = +0.010

100 active members, 50 quiet members, 1 active signals +1:
  weightedSignalSum = 1.0
  maximumPossibleWeight = 100 × 1.0 + 50 × 0.5 = 125.0
  temperature = +0.008

50 active members all signal +1, 50 quiet members all signal −1:
  weightedSignalSum = (50 × 1.0) + (50 × −0.5) = +25.0
  maximumPossibleWeight = (50 × 1.0) + (50 × 0.5) = 75.0
  temperature = +0.333
```

Temperature is a **derived value** — it is never stored. It is computed on demand from current signals, the same way `getResponsibilityCoverage()` is computed from assignment records.

### Signal mutability and cooldown

Governance temperature signals reflect evolving preference, not permanent votes. Members may change their signal for a category at any time, subject to a rate limit.

A signal change is rejected if the member changed that category's signal within the last **1 hour**. This prevents mechanical gaming (scripts, bots, rapid toggling) without locking members out when the community experiences events that prompt genuine reconsideration.

The cooldown applies **independently to each category** — a member can update their `membership` signal and their `emergency` signal in the same hour without conflict, but cannot update the same category twice within one hour. The duration is **globally fixed at one hour** and is not configurable via governance preferences. Its purpose is operational stability, not governance design.

Properties:
- Signals are mutable
- Each category's cooldown is tracked independently; duration is fixed at 1 hour globally
- Dormant members are excluded from aggregation
- Quiet members are half-weighted (0.5)

### Temperature scale

```
Restrictive ←————————————————————————→ Permissive
  −1.000              0              +1.000
  high threshold     default         low threshold
  long petition      default         short petition
```

A group may run permissive on membership (low threshold, short windows) and restrictive on emergency (high threshold for declaration).

---

## How Temperature Affects Governance Parameters

Temperature modifies governance parameters through linear interpolation between three anchor values defined per parameter:

| Anchor | Temperature | Meaning |
| --- | --- | --- |
| Restrictive extreme | −1.000 | Value applied when community strongly prefers higher friction |
| Default | 0.000 | Value applied at neutral temperature |
| Permissive extreme | +1.000 | Value applied when community strongly prefers lower friction |

Interpolation formula (piecewise linear):

```
if temperature >= 0:
  effectiveValue = lerp(default, permissiveExtreme, temperature)
else:
  effectiveValue = lerp(restrictiveExtreme, default, temperature + 1)

where lerp(a, b, t) = a + (b − a) × t
```

At temperature = 0, the effective value equals the defined default. Temperature never directly approves or rejects a proposal — it adjusts the parameters that petitions use.

---

## Governance Categories

Nine canonical governance categories. Each governs a distinct class of collective community decision.

**Individual support requests and individual contribution offers are outside governance.** The `support_request` and `contribution_offer` categories apply only when a Group or Project acts collectively.

**Responsibility confirmation is governed by the `responsibility` category, not the `membership` category.** Responsibility confirmation determines whether someone can hold a community function (coverage). Membership admission determines whether someone belongs to the group. These are distinct decisions: a member can belong to a group without holding any responsibilities, and confirming a responsibility holder does not change their membership status.

**The `membership` category governs admission decisions, not membership persistence.** Project membership lifecycle (Quiet members remaining project members, Dormant members losing project membership, membership tied to host-group participation) is governed by RFC-005 and RFC-001 participation rules, not by the `membership` governance category.

| Category | Governs |
| --- | --- |
| `membership` | Member admission to groups and projects |
| `project` | Project lifecycle decisions — creation, completion, host withdrawal, retirement |
| `responsibility` | Responsibility confirmation and reconfirmation |
| `accountability` | Concern action proposal acceptance |
| `living_document` | Living document revision acceptance |
| `archival` | Archival of bulletins, publications, and living documents |
| `support_request` | Support requests made on behalf of a Group or Project as a collective |
| `contribution_offer` | Contribution offers made on behalf of a Group or Project as a collective |
| `emergency` | Emergency declaration and duration |

---

## The Governance Contract

RFC-006 separates concerns cleanly across three layers:

```
Registry (TypeScript constants):    category definitions, anchor values, parameter types, value bounds
Database (MemberGovernanceSignal):  who signaled, which group, which category, signal value (−1|0|+1)
Resolver (service code):            signals → temperature → anchor interpolation → effective petition parameters
```

**Category anchors are fixed in the TypeScript registry. Groups do not customize anchor values.**

Groups influence effective governance parameters exclusively through member temperature signals. If members think a category is too restrictive or too permissive, they change their signals. The community's aggregate signal shifts the temperature, and the temperature shifts the effective parameter via fixed-anchor interpolation.

There is no second meta-governance layer for setting anchor values. This keeps the governance loop simple:

```
Signal → temperature → fixed-anchor interpolation → petition parameters → outcome
```

The `GovernancePreference` model and existing JSON blobs (`Group.governancePreferences`, `Node.constitutionalPreferences`) remain in the schema. RFC-006 does not use them for governance temperature calculation or parameter configuration. They remain available for future federation or other purposes not addressed in this RFC.

---

## Category Parameter Registry

Each parameter defines three anchor values: restrictive extreme, default, and permissive extreme. The resolver interpolates between them based on the current group temperature for that category. Anchor values are fixed in the TypeScript registry.

### membership

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.80 | 0.60 | 0.40 |
| `petitionDuration` (days) | 14 | 7 | 3 |

### project

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.80 | 0.60 | 0.40 |
| `petitionDuration` (days) | 28 | 14 | 7 |

### responsibility

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.70 | 0.50 | 0.30 |
| `petitionDuration` (days) | 14 | 7 | 3 |
| `reconfirmationPeriod` (days) | 90 | 365 | 730 |

Restrictive communities require more frequent reconfirmation (90 days) — more oversight, more democratic review. Permissive communities trust their holders and allow longer terms (730 days). The default (365 days) matches the current `Responsibility.termDays` constant.

`reconfirmationPeriod` has global bounds enforced in the registry: **minimum 30 days, maximum 730 days**. This preserves the RFC-004 constitutional principle that responsibilities are temporary.

> **Note for implementers:** Without a constitutional lower bound, communities could set reconfirmation periods of many years, creating effectively permanent responsibilities. The 730-day maximum is the global ceiling enforced by the registry. Node-level tightening of these bounds is deferred.

### accountability

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.85 | 0.70 | 0.55 |
| `petitionDuration` (days) | 21 | 14 | 7 |

### living_document

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.80 | 0.60 | 0.40 |
| `petitionDuration` (days) | 21 | 14 | 7 |

### archival

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.80 | 0.60 | 0.40 |
| `petitionDuration` (days) | 14 | 7 | 3 |

### support_request

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.70 | 0.50 | 0.30 |
| `petitionDuration` (days) | 14 | 7 | 3 |

### contribution_offer

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.70 | 0.50 | 0.30 |
| `petitionDuration` (days) | 14 | 7 | 3 |

### emergency

| Parameter | Restrictive (−1) | Default (0) | Permissive (+1) |
| --- | --- | --- | --- |
| `threshold` | 0.90 | 0.80 | 0.65 |
| `petitionDuration` (days) | 5 | 3 | 1 |
| `duration` (days) | 14 | 30 | 60 |

Restrictive communities use shorter emergency periods (14 days) — high friction governance prefers temporary conditions that resolve quickly. Permissive communities allow longer periods (60 days).

> **Note for implementers:** Temporary stewardship (RFC-004 `declareTempStewardship()`) is treated as an emergency governance mechanism. Its duration is governed by the same `emergency.duration` parameter. The connection is intentional: an unplanned coverage failure activates emergency-style coverage, and its duration should follow the same governance configuration as a declared emergency. The 30-day default is the current hardcoded constant.

---

## Data Model

### MemberGovernanceSignal

Records an individual member's current governance temperature signal per category. One record per member per category per group. Signal is replaced (not appended) when a member updates their preference. Signal values are constrained to `−1 | 0 | +1`.

```
MemberGovernanceSignal
  id
  membershipId    — FK to GroupMembership (group-scoped, not account-scoped)
  groupId         — denormalized for query efficiency
  category        — GovernanceCategory key string, validated by registry
  signal          — Int, constrained to −1 | 0 | +1
  updatedAt
  createdAt

  @@unique([membershipId, category])
  @@index([groupId, category])
```

### GovernancePreference (not used by RFC-006 temperature resolver)

The existing `GovernancePreference` model remains in the schema unchanged. RFC-006's governance temperature resolver does not read from it. Anchor values come from the TypeScript registry; temperature values come from `MemberGovernanceSignal`.

### ProposalFamily (TypeScript union)

`Petition.subjectType` is constrained to a registered `ProposalFamily` union — not a free string. Each proposal family maps to exactly one governance category.

```typescript
type ProposalFamily =
  | "membership_request"            // category: membership
  | "project_proposal"              // category: project
  | "responsibility_proposal"       // category: responsibility
  | "accountability_action"         // category: accountability
  | "living_document_revision"      // category: living_document
  | "archive_proposal"              // category: archival
  | "emergency_declaration"         // category: emergency
  | "collective_support_request"    // category: support_request
  | "collective_contribution_offer" // category: contribution_offer
```

### Petition

```
Petition
  id
  groupId
  category              — GovernanceCategory key string (validated by registry)
  subjectType           — ProposalFamily (validated by TypeScript registry)
  subjectId             — id of the entity being decided on
  competitionKey        String?
    — groups competing proposals targeting the same decision
    — format: "{subjectType}:{subjectId}" e.g. "living_document_revision:docId"
    — null for non-competing types (emergency declarations, responsibility confirmations)
    — derived from the governed subject by openPetition(); never accepted as user input
  status                — open | approved | rejected | withdrawn | superseded
  governanceSnapshot    Json  — resolved effective parameters at petition open time
  opensAt
  closesAt              — opensAt + governanceSnapshot.petitionDuration
  resolvedAt
  createdByMembershipId

  @@index([groupId, status])
  @@index([category])
  @@index([competitionKey])
  @@index([subjectType, subjectId])
```

`governanceSnapshot` captures the fully resolved effective parameter values (after temperature interpolation) at the moment the petition opens.

**Constitutional Invariant: governance parameter changes made after a petition opens cannot alter its outcome.**

Without this invariant, a governance exploit is possible: open a petition, change the community temperature, change the interpolated threshold, alter the outcome. The snapshot closes that vector. Whatever threshold and petition duration were in effect at `opensAt` are the values that govern the petition to close — regardless of what the resolver returns afterward.

### PetitionSupport

A support record means the member currently supports this petition. Members who change their position withdraw their support record.

```
PetitionSupport
  id
  petitionId
  membershipId
  createdAt
  updatedAt

  @@unique([petitionId, membershipId])
  @@index([petitionId])
```

### EmergencyPeriod

```
EmergencyPeriod
  id
  groupId
  petitionId           — FK to the Petition that activated it
  startedAt
  expiresAt            — startedAt + petition.governanceSnapshot.duration
  endedAt
  endedByPetitionId    — FK to the deactivation Petition, if ended early

  @@index([groupId])
```

---

## Preference Resolver

The governance preference resolver returns the effective parameter value for a `{category}.{parameter}` pair, given the group's current temperature for that category.

Resolution steps:

1. Validate `category` against the registered `GovernanceCategory` union
2. Validate `parameter` against the category's registered parameter list
3. Compute current temperature via weighted aggregation of `MemberGovernanceSignal` rows
4. Read anchor values from the TypeScript category registry (not from the database)
5. Apply piecewise linear interpolation between anchors at the computed temperature
6. Return a typed value matching the parameter's registered type
7. At petition open time: snapshot the full resolved set into `Petition.governanceSnapshot`

The resolver has no database reads for anchors — only for temperature signals. This makes it fast and deterministic.

---

## Petition Flow

Petitions remain open until the petition period expires. Support may be added or withdrawn during the open period. **Reaching the threshold does not close a petition early** — the community retains the ability to adjust its position until the period ends.

```
Member initiates governance action
      ↓
Petition created (status: open)
  → governanceSnapshot captured (frozen at open time — Constitutional Invariant)
  → closesAt = opensAt + governanceSnapshot.petitionDuration
      ↓
Members may add or withdraw PetitionSupport during the open period
      ↓
At closesAt:
  → eligible = getActiveParticipantCount(groupId)
  → if eligible = 0: petition blocked (cannot evaluate without active members)
  → supportCount = count PetitionSupport WHERE petitionId = ?
  → if supportCount / eligible >= governanceSnapshot.threshold: approved
  → otherwise: rejected
      ↓
Petition also closes if initiator withdraws (status: withdrawn)
or if the subject entity is withdrawn (status: superseded)

Volunteer withdrawal (responsibility confirmation): if a volunteer withdraws their
candidacy while a confirmation petition is open, the petition closes as withdrawn.
The volunteer is the subject; their withdrawal is the subject-withdrawal case.
      ↓
Approved petitions trigger category-specific execution
```

**Exception — Emergency declarations:** Emergency petitions activate immediately upon reaching threshold. The emergency period begins when the threshold is crossed, not when the petition window closes.

### Category execution on approval

| Category | Execution |
| --- | --- |
| `membership` | Admit member to group or project |
| `responsibility` | Create `ResponsibilityAssignment` via `confirmResponsibilityAssignment()` |
| `living_document` | Promote existing revision body to `LivingDocument.currentBody`; set `proposalId`, `approvedAt`, `approvedByAccountId` |
| `archival` | Set `archivedAt`, `archivedByAccountId`, `archiveProposalId`, `archiveReason` |
| `accountability` | Accept concern action proposal; advance concern status |
| `project` | Execute project lifecycle decision (create, complete, retire, etc.) |
| `emergency` | Open `EmergencyPeriod` (activates on threshold, not at closesAt) |
| `support_request` | Execute collective support request decision |
| `contribution_offer` | Execute collective contribution offer decision |

### Competing proposals

Members may support multiple proposals simultaneously. Support is not mutually exclusive. When multiple proposals exist for the same subject (same `competitionKey`), the one with the highest support at petition close wins, provided it meets the threshold. All competing petitions resolve atomically in one transaction to prevent double winners.

**Tie behavior:** If two or more competing proposals tie for highest support, all tied proposals are rejected. Members must repropose. Ties require convergence rather than rewarding timing.

---

## Emergency

Emergency is a governance category with mechanics beyond standard petition approval.

### Emergency period

```
Emergency declaration petition opens
  → threshold: resolved emergency.threshold (default 0.80)
  → petition duration: resolved emergency.petitionDuration (default 3 days)
      ↓
Threshold reached (early activation)
  → EmergencyPeriod created
  → expiresAt = now + petition.governanceSnapshot.duration (frozen at petition open time)
  → available_during_emergency abilities activated for holders
      ↓
Emergency ends at expiresAt OR via early deactivation petition
```

### Relationship to temporary stewardship

RFC-004's `declareTempStewardship()` creates a 30-day emergency assignment during a coverage failure. The 30-day constant is the default value of `emergency.duration`. RFC-006 makes it resolver-driven. Both `declareTempStewardship()` and `onEmergencyPetitionApproved()` capture the resolved duration **once at activation time** — they never re-resolve after the emergency period begins.

---

## Relationship to Prior RFCs

**RFC-001:** Quiet member inclusion in governance aggregation follows RFC-001 participation semantics. `getActiveParticipantCount` (petition denominator) and `getParticipatingMemberCount` (temperature aggregation) are reused. Quiet members carry 0.5 weight.

**RFC-002:** Accountability action proposal acceptance becomes an `accountability` category petition. The concern lifecycle advances on petition approval.

**RFC-004:** Responsibility confirmation uses the `responsibility` category petition flow. The volunteer → petition → confirmation → assignment path deferred in RFC-004 is implemented here. Temporary stewardship duration becomes resolver-driven. Recall petitions (deferred in RFC-004) require the petition infrastructure established here.

**RFC-005:** Living document revision approval and archival governance are wired via the `living_document` and `archival` categories. Deferred fields (`archiveProposalId`, `archiveReason`, `archivedByAccountId`, `proposalId`, `approvedAt`, `approvedByAccountId`) noted in the D3 schema comments are added in this RFC's migrations.

---

## Deferred Topics

### Explicitly deferred from initial implementation gates
- **Challenge windows** — removed from RFC-006; Commons allows simultaneous support for multiple proposals; highest support wins; no runner-up or reversal mechanics
- **Node-level anchor constraints and alternate anchor profiles** — anchors are fixed in the TypeScript registry; node-level shaping deferred
- **`GovernancePreference` usage for governance temperature** — model remains in schema for future use; RFC-006 resolver does not use it
- **Governance temperature display in dashboard UI**
- **Per-project governance temperature preferences** — initial implementation is group-level only
- **`SignedEvent` integration for governance preference audit trail**

### Future governance phases
- Recall petitions (infrastructure ready; deferred in RFC-004)
- Cross-group governance coordination
- Federation governance
- Concern-remedy integration for discussion thread closure
