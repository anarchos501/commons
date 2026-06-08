# RFC-007: Intra-Node Federation

## Status

Draft

## Purpose

Commons needs a constitutional model for cooperation between autonomous communities on the same node. This RFC defines intra-node federation as cooperation between groups through shared projects, coalitions, node stewardship, and future cross-space relationships.

This RFC is constitutional rather than feature-specific. It establishes the principles and protocol shapes that later implementation phases must follow.

RFC-005 remains operative while this RFC is Draft. If accepted, this RFC amends RFC-005's project-closure rule and clarifies that current project hosting is determined by `ProjectHosting`, not by a project's founding group reference.

---

## Constitutional Principles

### Federation Pattern Reuse

Cooperation scales without inventing new political forms:

```
individuals cooperate -> groups form
groups cooperate through shared projects and may form coalitions
coalitions cooperate -> nodes federate
nodes cooperate -> inter-node federation emerges
```

Projects do not become coalition members. Coalitions are group-to-group federations. Projects are one way groups cooperate.

### Legitimacy Flows From Cooperating Communities

Federation between collectives derives legitimacy from the consent of those collectives.

- Groups consent to hosting projects.
- Groups consent to forming or joining coalitions.
- Groups express node belonging by hosting their community life on a node.

At node scope, participation is exercised directly and individually, one account at a time, but eligibility is derived from group membership on that node. Node governance is not an exception to this principle. It is the principle expressed through existing membership and participation status machinery.

### Right of Exit

No federated relationship may permanently bind a participant against its will.

A group's will is expressed through its own internal governance. Collective exit is not an individual override of group consensus.

Voluntary steward resignation is an exit action by the steward group. It is not a vote of no confidence and does not require an elevated removal threshold. A vote of no confidence removes a steward group against its will and therefore may carry a higher threshold.

---

## Multi-Host Projects

Multi-host projects are already a complete instance of federation. A project may be hosted by multiple groups at once, and no host group owns the project.

Hosting means:

- endorsement
- discoverability
- recruitment access
- support-request access
- contribution-offer access

Hosting does not mean:

- ownership
- governance authority over the project
- operational control
- the right to block another host's exit

Projects are functional and experimental arms of groups. They are vehicles through which communities explore ideas and create value. A project's legitimacy is grounded in group sponsorship, but autonomy means no single host owns the project.

If no group wants to host a project, the project should move toward closure rather than survive indefinitely as an unhosted political entity. This does not prevent people from continuing the work: participants who still believe in the work may form a new group and continue there.

### Current Hosting

Current hosting is determined only by active `ProjectHosting` records.

`Project.groupId` is historical provenance, not current authority. Implementation should rename it to `foundingGroupId`, keep it immutable, and remove every governance or authorization dependency that treats it as the current host.

`ProjectHosting` must preserve hosting history while still allowing Commons to determine active hosts. The recommended implementation is:

- add `ProjectHosting.endedAt DateTime?`
- define active hosting as `endedAt IS NULL`
- replace the current unique constraint on `[projectId, groupId]` with a partial unique index for rows where `endedAt IS NULL`
- create a new historical row when a group hosts the same project again after withdrawing

Deleting `ProjectHosting` rows would lose hosting history. Keeping rows without an active marker would make "no current hosts" impossible to evaluate.

### Host Withdrawal

A host group may withdraw through its own group-scoped governance. The project may not block the host group's exit.

If at least one active host remains after withdrawal, the project continues normally. If the final active host withdraws, Commons evaluates the project according to the pending-closure rules below.

### Project Status, Hosting Condition, and Archival

`ProjectStatus` is not a pure lifecycle enum. It currently mixes participation conditions (`active`, `quiet`, `dormant`) with terminal outcomes (`completed`, `closed`). This RFC does not add a `pending_closure` value to `ProjectStatus`.

Hosting condition is derived separately:

- **Hosted:** at least one active `ProjectHosting` row exists.
- **Pending closure:** no active `ProjectHosting` row exists and `Project.pendingClosureAt` is set.
- **Closed:** `ProjectStatus.closed`.

`pendingClosureAt DateTime?` is the only new project field required for the pending-closure condition.

During the grace period, `ProjectStatus` continues to reflect the project's existing status independently. `active`, `quiet`, and `dormant` continue to describe participation. `completed` remains its own terminal outcome.

`completed` is a one-way exit from the hostless-closure machinery. A project that is already `completed` when it loses its last host does not enter pending closure, does not run an adoption grace period, and is not converted to `closed`. It may be archived through ordinary archival behavior. Reviving a completed project is deferred to a future RFC.

RFC-007 amends the trigger for `closed`: a non-completed project becomes `closed` when 30 days have elapsed since `pendingClosureAt` and no mutually approved successor host exists.

Transitioning a project to `closed` automatically sets `archivedAt` and makes the project read-only. `archivedAt` remains exactly what RFC-005 defines: a discoverability flag that removes the project from active-list views. Closure changes editability and active-list discoverability; it does not change read-access permissions for the historical record.

### Pending Closure

When the final active `ProjectHosting` ends for a non-completed project:

- set `pendingClosureAt`
- open a 30-day grace period
- keep the project readable
- limit governance to the adoption decision
- disallow new unrelated petitions, project membership changes, publications, discussions, documents, and other active-work changes

If a successor host is mutually approved during the grace period, create an active `ProjectHosting`, clear `pendingClosureAt`, and continue the project. If no successor is approved before the deadline, set `ProjectStatus.closed`, set `archivedAt`, and make the project read-only.

### Pending-Closure Electorate

The project-side electorate for successor-host adoption is frozen when `pendingClosureAt` is set.

The frozen electorate is:

```
ProjectMembership.status == active
AND
ProjectMembership.participationStatus == active
```

Quiet members are excluded from petition decisions under RFC-001, and this rule uses the same threshold.

The snapshot is preserved for the duration of the grace period so the project electorate does not vanish merely because the host relationships that supported project membership have ended.

Freezing does not protect against:

- account invalidation
- safety or accountability enforcement
- administrative revocations already authorized before `pendingClosureAt`

Those actions remove the affected account from the frozen electorate when they take effect. Ordinary new membership-change petitions are unavailable during pending closure.

If the frozen electorate is empty, project-side consent is unavailable. A group cannot unilaterally adopt an abandoned project identity or records. The project proceeds to closure if no valid adoption can be completed.

### Project Hosting Proposals

Adoption requires mutual consent:

- the candidate group approves "Should we host this project?"
- the project electorate approves "Should we accept this host?"

These petitions must be linked through a `ProjectHostingProposal`, using the same orchestration pattern as coalition proposals.

A `ProjectHostingProposal` records:

- the project identity
- the candidate group identity
- the frozen project electorate
- immutable proposal content
- the group-side petition
- the project-side petition
- resolution state

Resolution rules:

- both petitions must approve within the proposal lifetime
- rejection, withdrawal, or timeout on either side fails the whole proposal
- when the proposal fails, any still-open child petition is marked `superseded`
- no lone approval can be reused by a later proposal
- a later attempt always creates a fresh `ProjectHostingProposal`
- creating `ProjectHosting` is atomic on both petitions succeeding

---

## Coalitions

Coalitions are voluntary federations of groups. They are intentionally thin.

Coalitions are not large organizations, do not pool individual memberships into a new electorate, and do not have coalition-specific constitutions, councils, governance categories, or admin roles.

Coalitions reuse coordination-space infrastructure for shared discussion, bulletins, publications, living documents, libraries, and activity. Binding coalition decisions are always made through federated group consent.

### Coalition Membership

A coalition member is a group.

Joining, forming, and binding coalition actions require group-level consent. Each group reaches its position through its own internal governance. The coalition layer never pools individuals into a coalition-wide vote.

Ordinary coalition actions require unanimity among participating groups. Any single group rejection fails the action.

### Coalition Proposals

Coalition formation and join actions are coordinated by `CoalitionProposal`, also called `FederatedPetitionBundle`.

A `CoalitionProposal` records:

- immutable proposal content
- an immutable participant snapshot
- references to spawned group-scoped petition rows
- resolution state

Valid states are:

- `open`
- `succeeded`
- `failed-rejected`
- `failed-withdrawn`
- `failed-timeout`

`open` is the only non-terminal state. `superseded` is not a `CoalitionProposal` state. It is a child-petition state used when a bundle has already failed and unfinished child petitions can no longer affect the result.

Resolution rules:

- the bundle succeeds only if every spawned group petition approves
- rejection, withdrawal, or timeout of any one group petition fails the whole bundle
- once the bundle fails, remaining open child petitions are marked `superseded`
- participant changes during an open bundle are treated as withdrawal and fail the bundle
- a later attempt creates a fresh bundle with a fresh snapshot

### Joining a Coalition

Joining an existing coalition uses the same bundle mechanism. It requires approval by:

- the applicant group
- every existing coalition member group

From the coalition's perspective, joining is a re-formation event with an expanded participant list.

### Departing a Coalition

Voluntary departure is governed solely by the departing group's internal process. The coalition cannot prevent or delay it.

### Removing a Coalition Member

Removal acts on another group and is therefore distinct from voluntary departure.

The targeted group does not participate in the removal decision. Every remaining member group must approve removal. Any dissent by a remaining member group blocks removal.

### Coalition Space Participation

Coalition-space content authorization is available to active members of member groups and is deduplicated by account. A person who belongs to multiple member groups acts as one account identity in the shared space.

This is not a coalition-wide vote. Binding decisions still require the federated group-consent bundle.

### Petition Scope

Do not add `coalition` to `Petition.scopeType`.

A coalition has no pooled electorate of its own. Coalition decisions are ordinary group-scoped petitions linked by `CoalitionProposal`.

`coalition` may be added to `CoordinationSpaceType` and `GovernanceScope` for coordination-space and future preference/replication preparation, but those additions do not create coalition-scoped petition authority.

---

## Node Stewardship and Node Governance

A node may operate indefinitely without a steward group. A steward group is optional.

The node host maintains infrastructure. Groups create political legitimacy. These authorities are distinct.

Either a node host or a group may nominate a steward group. Nomination only opens the question. Legitimacy comes from node governance approval.

Appointing a steward group where none exists uses the ordinary node approval threshold. Removing an existing steward through a vote of no confidence may use an elevated threshold. Voluntary steward resignation is an exit action by the steward group and does not require the vote-of-no-confidence threshold.

### Node Host Actor

A Node Host is an account with an active, node-scoped `NodeHost` record.

`NodeHost` status records infrastructure responsibility, not governance authority. A host may nominate a group for steward consideration or initiate a node-wide no-confidence question. Host initiation creates only a question: it does not create a finding, penalty, suspension, temporary removal, appointment, or governance outcome.

Initial host assignment is a bootstrap convenience. When the first group is created on a fresh node, its creator receives the initial `NodeHost` record. This records who initialized the node and grants no authority over that first group, future groups, or the node community.

A node may have multiple host records for operational redundancy. Creating, revoking, or transferring these operational records is controlled by the server owner or operator and is outside community petition governance. Commons petitions cannot appoint or remove a node host.

Host status grants no in-app authority over users or groups, petition overrides, or direct steward appointment or removal. This application-level limit does not prevent a server operator from accessing plaintext data stored on infrastructure they control.

**Invariant:** `NodeHost` status is an operator-controlled infrastructure marker, not a petition-governed role. Community governance appoints, accepts the resignation of, or removes only the steward group. Every binding stewardship outcome requires candidate-group consent, node-wide approval, or current-steward group resignation approval.

### Node Governance Eligibility

A user is eligible for node governance on any node where they hold at least one qualifying membership:

```
GroupMembership.status == active
AND
Group.nodeId == Node.id
```

Eligibility is not gated on `Account.homeNodeId`. `homeNodeId` is account-hosting infrastructure. Node governance eligibility is political standing derived from active membership in groups hosted on that node.

Node participation status is derived from the strongest `participationStatus` among the user's qualifying memberships on that node:

- active outranks quiet
- quiet outranks dormant
- dormant has no petition influence

Example: a user dormant in Group A but active in Group B, both hosted on Node X, has active node participation status on Node X.

Node petitions and node federation-temperature signals are counted once per account per node, regardless of how many qualifying group memberships that account holds there. Existing `PetitionSupport` and `MemberGovernanceSignal` are membership-scoped and would over-count overlapping group members if reused directly.

Implementation requires account-scoped node records such as:

- `NodePetitionSupport`, unique by petition/account/node
- `NodeGovernanceSignal`, unique by account/node/category/parameter

Node governance reuses the active/quiet/dormant effects already defined by participation status. It does not require a new participation philosophy.

---

## Deferred Federation Topics

This RFC establishes the federation pattern through groups, multi-host projects, coalitions, and node governance.

The following topics are explicitly deferred:

- direct Project-to-Project federation
- Project-to-Responsibility cross-group coordination
- Trusted Provider portability
- inter-node federation
- completed-project revival

Future RFCs should reuse the principles established here: mutual consent, federation pattern reuse, legitimacy through cooperating communities, and right of exit.

---

## Data Model Direction

### Project Hosting

Implementation should add or revise:

- `Project.foundingGroupId` as immutable provenance, renamed from `Project.groupId`
- `Project.pendingClosureAt DateTime?`
- `ProjectHosting.endedAt DateTime?`
- a partial unique index for `[projectId, groupId]` where `endedAt IS NULL`
- `ProjectHostingProposal` for two-party host adoption

`ProjectHostingProposal` should include immutable project and candidate-group snapshots, the frozen project electorate, child petition references, and resolution state.

### Coalitions

Implementation should add:

- `Coalition`
- `CoalitionMembership`
- `CoalitionProposal`
- `coalition` in `CoordinationSpaceType`
- optional `coalition` in `GovernanceScope` for future preferences or replication

Do not add `coalition` to `Petition.scopeType`.

### Node Governance

Implementation should add:

- optional steward-group link on `Node`
- node-scoped `NodeHost` records for authenticated host initiation
- node-scoped petition support and governance signal records keyed by account, not membership
- `node` in `Petition.scopeType` only after node-scoped support and eligibility are implemented

### Integration Work

Schema additions alone are not sufficient. Authorization, activity aggregation, UI routing, content APIs, petition creation, petition evaluation, governance ownership checks, and governance resolution currently assume group/project/responsibility scopes in many places and must be updated intentionally.

---

## Phased Implementation Roadmap

### Phase 0: Federation Legibility

Ready now.

- Label project hosting relationships explicitly.
- Surface hosted projects on host group pages.
- State in product language that hosting is endorsement, not ownership.
- Show member group affiliations on project rosters only where privacy preferences permit.

### Phase 1: Multi-Host Project Governance

Implement project hosting as a first-class federated relationship.

- Rename `Project.groupId` to `foundingGroupId` and strip authorization meaning from it.
- Add historical `ProjectHosting` semantics with `endedAt`.
- Add `Project.pendingClosureAt`.
- Implement final-host withdrawal and the 30-day pending-closure window.
- Implement the frozen pending-closure electorate.
- Implement `ProjectHostingProposal`.
- Automatically set `archivedAt` when a non-completed project becomes `closed`.
- Preserve read-access permissions for historical records after closure.

### Phase 2: Coalitions

Implement coalitions as thin group-to-group federations.

- Add `Coalition` and `CoalitionMembership`.
- Add `CoalitionProposal`/`FederatedPetitionBundle`.
- Implement formation, join, departure, and removal flows.
- Mark unfinished child petitions `superseded` on bundle failure.
- Add coalition coordination-space routing and account-deduplicated shared-space authorization.
- Keep binding decisions as linked group-scoped petitions.

### Phase 3: Responsibility Cross-Group Coordination

Deferred.

### Phase 4: Trusted Provider Portability

Deferred.

### Phase 5: Node Stewardship and Node Governance

- add optional steward-group linkage
- implement node host nomination authority
- implement node governance eligibility
- implement account-deduplicated node petition support
- implement account-deduplicated node governance signals
- implement steward appointment, resignation, and vote-of-no-confidence flows

---

## Verification Criteria

An implementation of this RFC should demonstrate:

- current project hosting is derived from active `ProjectHosting` rows, not founding provenance
- host withdrawal cannot be blocked by the project
- last-host withdrawal on a non-completed project sets `pendingClosureAt`
- completed projects do not enter pending closure because of host loss
- frozen pending-closure electorates contain only active project members with active participation at snapshot time
- empty frozen electorates cannot approve adoption
- host adoption requires a successful `ProjectHostingProposal`
- failed host-adoption proposals do not leave reusable lone approvals
- project closure sets `archivedAt`, disables writes, and preserves read access
- coalition decisions use group-scoped petitions linked by a bundle
- coalition bundles fail on any rejection, withdrawal, or timeout
- unfinished child petitions are marked `superseded` after bundle failure
- no coalition-scoped petition electorate exists
- node governance eligibility is derived from active group membership on the node, not account home node
- node votes and node governance signals are deduplicated once per account per node
