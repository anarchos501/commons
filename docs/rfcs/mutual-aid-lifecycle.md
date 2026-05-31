# RFC-003: Mutual Aid Lifecycle

## Status

Accepted

Target file: `docs/rfcs/mutual-aid-lifecycle.md`

---

# Purpose

Commons exists to help communities coordinate mutual aid while protecting dignity, privacy, accountability, and consent.

This RFC defines the lifecycle of support requests from creation through fulfillment, accountability review, retention, and eventual redaction.

The purpose of this RFC is to preserve constitutional decisions already implemented in Commons and establish clear boundaries for future development.

---

# Core Principles

## Mutual Aid Is Consent-Based

The requester decides whether assistance was received.

The contributor decides whether they are willing to provide assistance.

Commons coordinates those decisions but does not override them.

This principle is foundational to the request lifecycle. It is why:

* fulfillment requires requester confirmation
* contributor activity does not determine fulfillment
* accountability windows begin at the requester's acknowledgment

---

## Guest and Member Equality

Support requests submitted by guests and members have equal standing.

Guest status does not reduce:

* visibility
* routing eligibility
* accountability rights
* concern rights
* review priority

Commons evaluates requests based on need and community context, not account status.

---

## Requester Agency

The requester determines whether their need has been met.

Contributors may record help provided.

Contributors do not determine fulfillment.

---

## Accountability Before Erasure

Information required for accountability review should remain available during the accountability period.

Privacy and accountability must coexist.

Commons therefore delays redaction until accountability opportunities have reasonably expired.

---

## Data Minimization

Commons preserves only the information required for coordination, accountability, and historical recordkeeping.

Sensitive personal information should not remain accessible indefinitely.

---

# Lifecycle Overview

Support requests move through a defined lifecycle.

```text
Submitted
→ Routed
→ Matched
→ Fulfilled
→ Accountability Window
→ Redacted
```

Additional paths exist for:

* deletion
* expiration
* concern review

---

# Lifecycle State vs Need Outcome

Commons tracks coordination state, not certainty about people's lives.

| Lifecycle Outcome | Meaning |
| --- | --- |
| Fulfilled | Requester confirmed assistance received |
| Expired | Request lifecycle ended without fulfillment |
| Deleted | Request removed from active coordination |

None of these outcomes automatically answer:

> Was the underlying need actually solved?

Commons records coordination decisions. It does not claim to represent a complete picture of people's circumstances.

---

# Request Creation

Requests may be created by:

* members
* guests

Requests may include:

* description of need
* service category
* language information
* contact information
* timing information
* routing information

Commons should collect only the information necessary to coordinate assistance.

---

# Guest Access

Guest requests generate private access tokens.

Guest access exists to provide:

* status visibility
* fulfillment confirmation
* concern submission
* request deletion

Guest access should remain narrowly scoped.

Guest tokens are:

* random
* individually generated
* revocable
* time-limited

Guest tokens do not create membership.

## Guest Access and Participation Status

Guest access does not create:

* membership
* governance rights
* participation status
* group presence

Visiting a guest request page is not a Group Presence Event as defined by RFC-001: Participation Status.

Guest access must never refresh Participation Status.

Guest access must never affect governance calculations.

---

# Routing

Routing exists to identify potential contributors capable of assisting.

Routing should consider:

* capability
* availability
* participation status
* trust requirements
* group context

Routing is a coordination function.

Routing is not a reputation system.

Routing should minimize unnecessary disclosure of requester information.

---

# Matching

A request becomes matched when a contributor accepts responsibility for helping.

Matching indicates:

```text
Someone intends to help.
```

Matching does not indicate:

```text
Help has been received.
```

---

# Contribution Recording

Contributors may record contributions they provide.

Examples:

* transportation
* food delivery
* housing assistance
* technical help
* resource contribution

## Contribution Records Are Independent

Contribution records are independent historical records.

A contribution record exists regardless of whether:

* the request is fulfilled
* the request expires
* the requester confirms receipt
* a concern is later submitted

Contribution records preserve community memory and coordination history.

The existence of a contribution record does not imply:

* successful fulfillment
* requester satisfaction
* resolution of need

---

## Constitutional Rule

```text
Contribution Recorded
≠
Request Fulfilled
```

Contributors may record assistance.

Only requesters determine whether their need has been met.

Accountability windows, concern review, retention policy, and fulfillment state all depend on this distinction.

Changing this principle would require explicit reconsideration of Commons' mutual aid model.

---

# Fulfillment

A request becomes fulfilled only when the requester confirms that assistance has been received.

Requester confirmation is the canonical fulfillment path.

Fulfillment must occur through the lifecycle system and not through contributor actions.

## Why Requesters Confirm

Contributors may believe help was successfully delivered.

Requesters may experience:

* incomplete assistance
* failed delivery
* misunderstanding
* abuse
* unresolved needs

Commons therefore preserves requester agency regarding fulfillment.

## Automatic Fulfillment

Commons currently requires requester confirmation as the canonical fulfillment path.

Automatic fulfillment is not implemented.

Future versions of Commons may introduce automatic fulfillment mechanisms when:

* contributor activity has been recorded
* a response period has elapsed
* no concern has been submitted
* no accountability review is active

Any future automatic fulfillment mechanism must preserve:

* requester agency
* concern rights
* accountability review rights

Automatic fulfillment may supplement requester confirmation.

Automatic fulfillment may not bypass accountability processes.

---

# Accountability Window

Fulfillment creates an accountability window.

The accountability window exists to allow:

* concern submission
* review initiation
* accountability processes

The accountability window begins when a requester confirms fulfillment.

It does not begin when:

* a contributor records a contribution
* a route is accepted
* a request is matched

This preserves requester agency and ensures accountability opportunities begin only after the requester acknowledges receipt of assistance.

## Default Duration

Commons currently uses a default accountability window of 30 days following fulfillment.

The existence of an accountability window is a constitutional feature of the mutual aid lifecycle.

The specific duration is implementation policy.

Future governance mechanisms, including Governance Temperatures, may adjust accountability window durations without changing the underlying lifecycle model.

---

# Concern Linkage

Support requests may become associated with concerns.

Examples:

* abusive contributor behavior
* harassment
* fraud
* misuse of resources
* failure to deliver promised assistance

Concern review follows RFC-002: Accountability Review.

Request fulfillment does not prevent future concern review during the accountability window.

---

# Expiration

Requests may expire without fulfillment.

Expiration does not indicate:

* assistance occurred
* assistance was successful
* needs were met

```text
Expired ≠ Fulfilled
```

Expired requests remain part of the historical record.

Where accountability mechanisms remain available after expiration, those mechanisms should be governed by the same principles of review, retention, and privacy that apply to fulfilled requests.

---

# Deletion

Requesters may delete requests according to lifecycle rules.

Deletion should prioritize privacy while preserving necessary accountability records.

Deletion does not immediately erase all information.

Information required for:

* accountability review
* audit history
* system integrity

may be retained temporarily according to retention policy.

---

# Retention

Commons separates:

```text
Sensitive Content
```

from:

```text
Structural Metadata
```

Examples of sensitive content:

* descriptions
* contact information
* personal circumstances
* location details

Examples of structural metadata:

* request identifiers
* timestamps
* lifecycle transitions
* accountability references
* fulfillment state

Retention periods should preserve accountability while minimizing unnecessary personal data storage.

---

# Redaction

After the accountability period ends, sensitive request information should be redacted.

Examples include:

* descriptions
* contact information
* sensitive contextual details

Redaction preserves:

* historical record
* audit trail
* accountability references
* lifecycle metadata

while removing unnecessary personal information.

---

# Privacy and Accountability Balance

Commons intentionally balances two values:

```text
Personal Life Private
```

and

```text
Shared Coordination Accountable
```

During active coordination and accountability review:

* information may remain available where necessary

After accountability opportunities have expired:

* information should be minimized
* information should be redacted
* access should be reduced

---

# Participation Status Interaction

Participation Status affects routing eligibility.

Active participants may be routed.

Quiet and Dormant participants are excluded from operational routing assumptions.

Support request visibility and fulfillment rights are not affected by requester participation status.

---

# Relationship to RFC-001 and RFC-002

RFC-001, RFC-002, and RFC-003 form the constitutional foundation for Commons' mutual aid model.

RFC-001: Participation Status defines who is considered an active participant.

RFC-002: Accountability Review defines what happens when something goes wrong.

RFC-003: Mutual Aid Lifecycle defines how mutual aid moves from need → assistance → accountability → privacy-preserving history.

---

# Deferred Topics

This RFC intentionally does not define:

* reviewer selection
* trust scoring
* governance penalties
* proposal thresholds
* federation behavior
* plugin access

These topics are governed by separate RFCs.

---

# Success Criteria

A successful mutual aid lifecycle:

* preserves requester agency
* allows guests and members equal standing
* supports contributor participation
* enables accountability review
* protects sensitive information
* minimizes long-term data retention
* preserves historical accountability

Commons treats mutual aid as a relationship of trust and consent, not merely a transaction.
