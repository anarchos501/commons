# RFC: Participation Status

## Status

Approved

## Purpose

Commons requires a way to distinguish between membership and participation.

A person may remain a member of a group while no longer actively participating in that group's ongoing life. Without this distinction, governance calculations, petition thresholds, service availability, and future trust aggregation can become distorted by large numbers of inactive members.

This RFC introduces **Participation Status** as a separate concept from **Membership Status**.

Participation Status exists to describe whether a member is currently present within a specific group, not to evaluate their worth, trustworthiness, or standing.

---

# Core Principle

> Membership is a relationship. Participation is a current condition.

Membership describes whether someone belongs to a group.

Participation describes whether Commons can reasonably assume that someone remains present enough to influence or support that group.

These concepts must remain separate.

---

# Group-Scoped Participation

Participation Status is attached to a group membership, not an account.

A member may be:

* Active in Group A
* Quiet in Group B
* Dormant in Group C

simultaneously.

This allows Commons to accurately reflect where someone is currently present.

---

## Global Login Is Not Participation

Logging into Commons does not automatically refresh participation status across all groups.

A member may log into Commons every day while only interacting with one of several groups.

Automatically marking them Active everywhere would allow inactive members to continue influencing groups they no longer follow.

---

## Group Presence Determines Participation

Participation Status is refreshed by visiting a group's pages.

Commons treats group presence as sufficient evidence that a member remains aware of that group's activity.

Members should not be required to perform artificial actions merely to maintain participation status.

---

## Group Presence Event

A Group Presence Event occurs when a logged-in member accesses a group-scoped Commons surface.

Examples include:

* Group dashboard
* Group page
* Project page belonging to the group
* Petition page belonging to the group
* Group-scoped request page

A global Commons login does not create Group Presence Events for all groups.

Group presence is scoped to the specific group whose surface was accessed.

Guest access through a private request link does not create a Group Presence Event, because guest requesters do not have a group membership to refresh.

A Group Presence Event refreshes that membership's lastSeenAt and may reactivate Participation Status according to the status transition rules.

---

# Non-Goals

Participation Status is not:

* A disciplinary system
* A trust system
* A reputation system
* A contribution score
* A measure of personal value
* A measure of political influence

Participation Status exists solely to distinguish currently present members from absent members.

---

# Membership Status vs Participation Status

## Membership Status

Examples:

* Pending
* Active
* Inactive
* Revoked

Membership changes are governance decisions.

Participation Status must never automatically change Membership Status.

---

## Participation Status

Participation Status changes automatically based on presence and absence.

Participation Status is descriptive, not disciplinary.

---

# Participation Statuses

## Active

The member has recently visited the group and is considered currently present.

Commons may reasonably assume:

* They are aware of ongoing activity
* They may participate in petitions
* They may participate in governance
* They may respond to responsibilities
* They may provide offered services

Active members:

* Count toward petition denominators
* Count toward governance preference aggregation
* Count toward participation-based calculations
* Remain available for capability routing
* Retain active responsibilities
* Retain active contribution offers

---

## Quiet

The member has been absent long enough that Commons should no longer assume operational availability.

Quiet members remain part of the community.

They continue to:

* Count toward governance preference aggregation
* Retain membership
* Retain trust history
* Retain contribution history
* Retain project history

However Commons no longer assumes they are available for operational participation.

Quiet members:

* Do not count toward petition denominators
* Are excluded from capability routing
* Have contribution offers marked inactive
* Have service availability marked inactive
* Have responsibility assignments ended under RFC-004

The purpose of Quiet status is not to reduce influence.

The purpose is to prevent communities from relying on people who may no longer be monitoring Commons.

---

## Dormant

The member has been absent long enough that Commons should no longer assume participation in governance.

Dormant members:

* Remain members
* Retain trust history
* Retain contribution history
* Retain project history
* Retain membership history

However they no longer:

* Count toward petition denominators
* Count toward governance preference aggregation
* Count toward participation-based calculations
* Participate in capability routing
* Hold active contribution offers
* Hold active responsibility assignments

Dormancy is not punishment.

It simply reflects prolonged absence.

---

# Status Transitions

## Default Thresholds

Initial defaults:

### Active → Quiet

Three months without visiting the group.

### Quiet → Dormant

Twelve months without visiting the group.

These values are intentionally conservative.

Communities should not lose participation influence because of short-term absences.

---

# Reactivation

Participation Status must reactivate automatically.

No approval process is required.

No petition is required.

No moderator action is required.

Examples:

### Quiet → Active

Occurs immediately upon visiting the group.

### Dormant → Active

Occurs immediately upon visiting the group.

Commons should assume good faith and welcome returning participants without friction.

Returning to Active restores participation status only. It does not restore prior responsibility assignments. A returning member must volunteer again under the responsibility process defined in RFC-004.

---

# Operational Availability

A core purpose of Participation Status is managing assumptions about availability.

When a member becomes Quiet:

## Capability Routing

Their service capabilities become inactive.

Commons should not route requests to members who may no longer be monitoring the group.

## Contribution Offers

Their contribution offers become inactive.

Commons should not advertise support that may no longer be available.

## Responsibilities

Their responsibility assignments end.

The community should not assume they can:

* Coordinate services
* Respond to requests
* Review concerns
* Fulfill assigned responsibilities

Historical records remain visible.

Only the active assignment ends. Historical responsibility records remain visible, and returning to Active does not restore the prior assignment.

## Responsibility Coverage

When members become Quiet, responsibility coverage may fail.

RFC-004 defines coverage as a derived value. A responsibility is covered only when at least one active participant holds an unended, unexpired assignment for that responsibility.

Commons intentionally prioritizes accurate availability assumptions over preserving active responsibility assignments.

Future responsibility-management policies may provide:

* Coverage warnings
* Group notifications
* Reassignment workflows
* Minimum coverage requirements
* Responsibility reactivation rules

This RFC establishes responsibility inactivity, but does not define responsibility-management workflows.

Design Gate B should account for minimum accountability coverage, especially cases where the only available concern reviewer becomes Quiet.

---

# Governance Effects

## Petition Readiness

Petitions represent active community decisions.

Examples:

* Project activation
* Membership approvals
* Accountability actions
* Resource allocation decisions

Because petitions directly affect ongoing group activity, Quiet and Dormant members are excluded from petition denominator calculations.

Example:

* 100 members
* 20 Quiet
* 10 Dormant

Petition calculations use:

* 70 currently present members

rather than:

* 100 historical members

This ensures petitions reflect the will of members who remain actively present within the group.

---

## Governance Preference Aggregation

Governance preferences represent longer-term community values.

Examples:

* Membership openness
* Privacy defaults
* Trust requirements
* Accountability strictness

Quiet members continue to count toward governance preference aggregation.

Dormant members do not.

This reflects the distinction between:

### Quiet

Present enough to influence long-term direction.

### Dormant

Absent long enough that Commons should no longer assume ongoing participation.

---

# Future Systems

Participation Status may eventually inform:

* Trust aggregation
* Participation metrics
* Project governance calculations
* Responsibility assignment recommendations
* Project participation status

Such integrations require separate RFCs.

This RFC only establishes Participation Status itself.

---

# Governance Temperature Hook

Future governance temperatures may allow groups to adjust Participation Status thresholds within bounded ranges.

### Quiet Threshold

Range:

* 1–12 months

Default:

* 3 months

### Dormant Threshold

Range:

* 3–36 months

Default:

* 12 months

Governance temperatures may adjust timing but must not change the meaning of Participation Status.

The semantic definitions of:

* Active
* Quiet
* Dormant

remain consistent across Commons.

---

# Design Principles

## Absence Is Not Misconduct

Participation Status must never imply wrongdoing.

A dormant member is not a bad member.

A quiet member is not a failing member.

Commons recognizes that people leave, return, become busy, experience hardship, relocate, or simply step away.

Participation Status reflects presence, not character.

---

## Preserve Community Memory

Members retain:

* Membership history
* Contribution history
* Trust history
* Project history

even while Dormant.

Commons should remember contributions without requiring perpetual participation.

---

## Favor Return Over Requalification

Returning participants should not face barriers.

Reactivation is automatic.

Commons should make returning easier than leaving.

---

# Deferred Questions

The following topics are intentionally excluded from this RFC:

* Responsibility assignment workflows
* Responsibility reactivation workflows
* Trust systems
* Accountability review permissions
* Project participation status
* Federation implications

These topics will be addressed in future design gates.
