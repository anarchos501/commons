# RFC-004: Responsibilities, Recall, and Coverage

## Status

Accepted

## Purpose

Commons requires a way for communities to coordinate ongoing functions — reviewing concerns, stewarding projects, facilitating membership — without creating permanent offices, administrators, or authority roles.

This RFC establishes the Responsibilities, Recall, and Coverage model.

---

## Constitutional Principle

**Responsibilities are not permissions.**

Responsibilities are community-recognized coordination functions. Platform permissions are minimized and exist only where required for accountability, privacy, or safety. Future contributors will naturally drift toward treating responsibilities as permissions; this model is intentionally designed to resist that drift.

The constitutional hierarchy is:

```
Membership       — very durable belonging
    ↓
Participation    — dynamic engagement (active / quiet / dormant)
    ↓
Responsibilities — temporary coordination functions
```

Persistence decreases at each layer. Responsibilities are the least persistent — they expire, they end when participation lapses, and they never automatically restore.

---

## Core Principles

### Membership is durable. Participation is dynamic. Responsibilities are temporary.

These are three separate things.

- **Membership** = belonging to a group
- **Participation** = active / quiet / dormant status
- **Responsibilities** = ongoing coordination work performed by volunteers

### Responsibilities do not grant authority

Responsibilities grant:
- visibility
- operational duties
- proposal authority

Responsibilities do not grant:
- unilateral authority
- coercive power
- permanent status

Communities decide. Responsibilities coordinate.

---

## Responsibility Model

A Responsibility is an ongoing coordination function that a group recognizes and supports.

Examples:
- Reviewer
- Project Steward
- Resource Steward
- Membership Steward

**Reviewer is the only first-class built-in type.** The platform understands the reviewer type and uses it to gate concern review operations. All other responsibility types are custom — created by group governance. Custom responsibilities receive no special platform behavior.

### Multi-Holder by Default

Responsibilities are collaborative. There is no concept of a filled seat.

```
Reviewer
  Alice
  Bob
  Charlie
```

All three hold the responsibility simultaneously. No competition for ownership. Responsibilities accumulate holders through active consent.

### Volunteer Flow

Any active member may volunteer for a responsibility.

```
Volunteer
    ↓
Community confirmation
    ↓
Responsibility assignment
```

The confirmation threshold is determined by Governance Preferences (deferred to governance temperature phase). The volunteer → petition → confirmation flow will share infrastructure with project proposals.

**Phase 5 implementation note:** The current implementation provides only the assignment layer (the third step). The `createAssignment()` function assumes confirmation has already occurred externally. It is an administrative primitive, not a substitute for community confirmation.

### Terms and Expiration

Responsibilities are temporary. Assignments have a term (default: 365 days). At term expiration:

- Assignment ends automatically
- No incumbency
- No automatic renewal
- Former holders may volunteer again

`Responsibility.termDays` is the canonical term definition. `ResponsibilityAssignment.expiresAt` is the derived value computed at assignment time.

**Expiration before reconfirmation:** Phase 5 intentionally ships term expiration before community confirmation workflows exist. Expired coverage falls back to `declareTempStewardship()` until governance confirmation is implemented.

---

## Participation Interaction

When a member transitions to **Quiet**:
- All responsibility assignments end immediately (reason: `quiet`)
- The member remains a member
- The member still counts toward governance preference aggregation
- The member no longer sponsors petitions, participates in quorum, or takes governance actions

When a member transitions to **Dormant**:
- All responsibility assignments end (reason: `dormant`)
- Dormant members remain members but lose governance preference influence

**Returning to Active does not restore responsibilities.** Returning to Active restores participation status only. The member must volunteer again.

---

## Coverage

Coverage answers: *Can this responsibility currently function?*

| State | Meaning |
| --- | --- |
| Covered | At least one active-participation holder exists |
| Coverage Failure | No active holders exist |

Coverage is a **derived value** — it is never stored in the database. It is computed from active assignments on demand.

### Emergency Coverage

During a coverage failure, any active member may declare temporary stewardship:

- Creates a 30-day assignment
- Multiple people may declare (no single-seat competition)
- **Refused when coverage is already present** — prevents bypassing normal confirmation
- After any declaration, coverage is restored; further emergency declarations are refused until that assignment expires or ends

---

## Responsibility Recall

Responsibilities are assigned to people. Membership is not.

Recall affects assignments, not membership. A recall petition targets a `ResponsibilityAssignment`, not the person. Possible outcomes:
- Assignment retained
- Assignment removed
- Assignment expires normally

The member remains in the community regardless of outcome.

**Recall petitions are deferred to a future governance phase.** They require the governance petition infrastructure to be implemented first.

---

## Reviewer Responsibility

Reviewer is the most important built-in responsibility.

Reviewers:
- review concerns
- issue findings
- propose accountability actions
- perform administrative closure

Valid administrative closure reasons:
- `duplicate`
- `spam/test`
- `malformed/non-actionable`
- `reporter unreachable`
- `legal/safety-required`

All closures are logged, visible, auditable, and challengeable.

### Reviewer Eligibility

Holding the reviewer responsibility does not automatically make someone eligible to review every concern. Eligibility for a specific concern requires:

1. Active membership status
2. Active participation status
3. Active reviewer responsibility assignment
4. No direct involvement in the concern (not the reporter)
5. No active conflict specific to the concern (deferred)

Eligibility is concern-scoped. Filing an unrelated concern against a reviewer does not globally disable them.

### Coordinator Type Removed

The previous `coordinator` role type that gated administrative closure has been removed. Administrative closure now belongs to reviewer responsibility, consistent with the principle that reviewer is the coordination function for the accountability system. No coordinator type exists anywhere in the codebase.

---

## Data Model

```
Responsibility
  id
  groupId
  type          — "reviewer" (built-in) or custom group-defined type
  termDays      — default 365

ResponsibilityAssignment
  id
  responsibilityId
  membershipId  — FK to GroupMembership (group-scoped, not account-scoped)
  startedAt
  expiresAt     — derived: startedAt + Responsibility.termDays
  endedAt
  endReason     — expired | quiet | dormant | recall | resigned

AssignmentEndReason (enum)
  expired       — term elapsed
  quiet         — member went quiet
  dormant       — member went dormant
  recall        — community recall petition
  resigned      — voluntary resignation
```

`ResponsibilityAssignment` is anchored to `GroupMembership` rather than `Account` because participation status lives on the membership record and responsibilities are group-scoped. A member can be Active + Reviewer in Group A while being Quiet (and not a reviewer) in Group B.

---

## Phase 5 Scope

**Implemented:**
- `Responsibility` + `ResponsibilityAssignment` schema
- Migration from `Role` model (reviewer migrated; coordinator removed)
- Multi-holder support
- Term expiration (`expireStaleAssignments`)
- Quiet/Dormant assignment ending
- Active return without restoration
- Emergency stewardship (coverage-failure gate enforced)
- Resignation (`resignAssignment`)
- Coverage tracking (`getResponsibilityCoverage` — derived value only)
- Reviewer migration in accountability review and dashboard

**Deferred:**
- Volunteer request records and pending state
- Volunteer → petition → confirmation → assignment flow
- Recall petitions
- Governance temperature integration for confirmation thresholds
- Project-scoped responsibilities (Design Gate D)
- Responsibility templates
