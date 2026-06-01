# RFC: Emergent Accountability Review

## Status

Accepted

## Purpose

Commons requires a structured way for communities to respond when someone believes harm, misconduct, failure, abuse, or unresolved problems have occurred.

This RFC establishes the accountability review framework.

It intentionally separates:

* concerns
* reviews
* findings
* accountability proposals
* governance decisions

Accountability exists to restore community function, understanding, and trust — not to punish people.

---

# Accountability Layers

Commons separates accountability into five distinct layers.

| Layer | Question |
| --- | --- |
| Concern | Something may be wrong? |
| Review | What happened? |
| Finding | What do reviewers conclude? |
| Action Proposal | What response is recommended? |
| Governance Decision | What response does the community approve? |

These layers are intentionally separate.

A concern is not a finding.

A finding is not an action.

A proposed action is not an approved action.

---

# Group Scope

Concerns are group-scoped.

A concern belongs to exactly one group.

Concerns may reference:

* projects
* support requests
* petitions
* memberships
* responsibilities

Review and accountability occur within the governance framework of the group that owns the concern.

---

# Non-Punitive Defaults

Commons intentionally separates accountability stages.

The following are always true:

* Concern ≠ Finding
* Finding ≠ Action
* Action Proposal ≠ Approved Action

Submitting a concern does not automatically:

* reduce trust
* revoke membership
* suspend responsibilities
* alter governance influence
* trigger penalties

Every accountability action requires a separate review and governance process.

Reporter visibility must be preserved.

Private accountability context must eventually expire according to retention policy.

---

# Concern Layer

A concern is a request for community attention regarding a problem, harm, failure, misconduct, or unresolved issue.

Examples include:

* abusive behavior
* harassment
* misuse of resources
* failure to fulfill responsibilities
* fraud
* process failures
* abuse of Commons systems

Submitting a concern creates a Concern Packet.

---

# Concern Packet

A Concern Packet contains:

* reporter identity
* subject identity or identities
* narrative description
* evidence and attachments
* timestamps
* related entities
* review history

Reporter identity is retained for audit purposes.

Reporter identity is private by default.

---

# Concern Lifecycle

## Submitted

Concern has been created.

---

## Acknowledged

Concern has been received and is visible to eligible reviewers.

Reviewer assignment is not required.

---

## Under Review

An eligible reviewer has actively begun review.

---

## Findings Issued

One or more findings have been recorded.

Findings are outputs of review.

They are not lifecycle states.

---

## Action Proposed

A reviewer has attached a proposed accountability response.

---

## Closed

Concern has reached a valid closure condition.

Every closure requires a recorded reason.

---

# Reviewer Eligibility

An eligible reviewer must satisfy all of the following:

* Active Membership Status
* Active Participation Status
* Unended, unexpired Reviewer Responsibility assignment
* No Direct Involvement
* No Active Conflict

## Direct Involvement

A reviewer may not review a concern if they are:

* the reporter
* the subject
* a participant in a referenced support request
* a participant in a referenced project action
* the proposer of a referenced governance action
* otherwise directly implicated

Future RFCs may refine this definition.

---

# Review Layer

Reviewers gather information, evaluate evidence, and document findings.

Reviewers do not unilaterally impose consequences.

Their responsibility is investigative and facilitative.

Reviewer conclusions are recommendations, not verdicts.

Reviewer selection mechanics are deferred to Design Gate C.

---

# Findings Layer

Possible findings include:

* Substantiated
* Partially Substantiated
* Unsubstantiated
* Insufficient Information
* Withdrawn

Findings describe reviewer conclusions.

They do not create consequences on their own.

## Finding Paths

### May Proceed to Action Proposal

* Substantiated
* Partially Substantiated

### Normally Proceed to Closure

* Unsubstantiated
* Withdrawn

### Closure with Reopen Potential

* Insufficient Information

Concerns closed due to insufficient information may be reopened if new evidence becomes available. Reopening requires submission by the reporter or request by an eligible reviewer.

---

# Withdrawn Concerns

A concern may be withdrawn by the reporter.

Withdrawal does not delete the concern.

Withdrawal does not remove review history.

Withdrawal does not remove ActionLog history.

A withdrawn concern remains part of the community accountability record.

Withdrawal normally results in closure without a proposed action.

However, withdrawal does not automatically prevent continued review if reviewers determine that an immediate safety, governance, or accountability issue remains unresolved.

In such cases:

* the withdrawal request is recorded
* the concern is marked Withdrawn
* review may continue if justified by community safety or accountability needs

Commons distinguishes between withdrawing a concern and deleting a concern.

Only the former is supported by this RFC.

---

# Action Proposal Layer

Reviewers may attach proposed accountability responses.

Examples include:

* warning
* restitution request
* responsibility suspension
* responsibility removal
* membership review
* process change recommendation
* no action

A proposal is a recommendation.

It does not take effect automatically.

---

# Proposal Iteration

Any eligible reviewer may submit a revised proposal after rejection.

Proposal history remains:

* visible
* permanent
* auditable

This prevents accountability deadlock if the original reviewer becomes unavailable.

---

# Governance Decision Layer

Communities decide whether proposed actions are adopted.

Reviewers recommend.

Communities approve.

The mechanism for approval is deferred to future governance RFCs.

---

# Coverage

Communities must be able to see whether review coverage exists.

Examples:

```
Review Coverage: Available
```

or

```
Review Coverage: Unavailable
```

If no eligible reviewer exists:

* concern remains visible
* concern remains open
* Commons displays a coverage warning

The concern never disappears because coverage is unavailable.

---

# Closure Authority

Every closure requires a recorded reason.

Valid closure reasons:

* Reporter Withdrawal
* Review Complete (No Action Proposed)
* Action Accepted and Implemented
* Action Rejected (No Further Proposal)
* Administrative Closure

All closures generate ActionLog entries.

No silent closure is permitted.

## Administrative Closure

Administrative Closure exists solely to resolve concerns that cannot reasonably proceed through the normal accountability process.

Administrative Closure is valid only for:

* duplicate concerns
* spam or test records
* malformed or non-actionable submissions
* reporter unreachable after a defined contact period
* legal or safety requirements that prevent ordinary review

Administrative Closure must:

* include a recorded reason
* generate ActionLog entries
* preserve concern history
* preserve review history

Administrative Closure is performed by the holder of the Reviewer responsibility. RFC-004 removed the legacy `coordinator` value and unified administrative closure authority under reviewer responsibility (see RFC-004: Responsibilities, Recall, and Coverage). Administrative Closure remains subject to future accountability review.

Administrative Closure is not a substitute for ordinary concern review.

---

# Reporter Identity

Reporter identity is visible only to:

* reporter
* active reviewers
* future appeal or accountability processes

Reporter identity is not visible to:

* general membership
* action voters
* concern subjects by default

## Reporter Identity Retention

Reporter identity should not remain routinely accessible forever.

After closure and a retention period:

* reviewer access expires
* routine visibility expires
* access narrows to future appeals and accountability processes

This should follow the same privacy lifecycle principles used elsewhere in Commons.

---

# Deferred Topics

This RFC intentionally defers:

* reviewer selection mechanisms
* reviewer removal
* reviewer trust requirements
* governance thresholds
* trust score effects
* membership sanctions
* federation accountability

These topics belong to later design gates.

---

# Phase 4 Planning Notes

The existing Report model (ReportStatus: open, under\_review, resolved, dismissed) is insufficient for this structure.

Phase 4 should introduce separate concepts for:

* ConcernReview
* ConcernFinding
* ConcernActionProposal

rather than stretching ReportStatus to represent the entire accountability process.

Acknowledged being defined as "received and visible to eligible reviewers" removes reviewer-assignment dependencies and allows Phase 4 to ship before Design Gate C.

ConcernActionProposal may integrate with existing Proposal mechanisms where appropriate.

Reporter identity expiration should follow the same pattern used by support-request privacy cleanup.

Phase 4 explicitly defers:

* reviewer selection
* reviewer removal
* petition thresholds
* trust score effects
