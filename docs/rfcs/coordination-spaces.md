# RFC-005: Coordination Spaces

## Status

Accepted

## Purpose

Commons requires a shared model for how people coordinate around ongoing initiatives and functions. This RFC defines Coordination Spaces as the primary organizational unit for collective action and establishes the structural model for Projects, Responsibilities, and their shared communication infrastructure.

---

## Constitutional Principle

**Coordination Spaces coordinate people, communication, commitments, and collective action.**

Commons does not attempt to become:
- inventory software
- accounting software
- scheduling software
- task management software
- file storage software

External tools may be used for those purposes. Commons coordinates the people who use them.

**Deletion is not part of the Coordination Spaces model.** Content may be archived (removed from active view) or revised — but records are preserved. `archivedAt` captures "removed from active view"; it is orthogonal to lifecycle status.

---

## Coordination Space Types

There are three equal Coordination Space types:

| Type | Purpose |
| --- | --- |
| **Group** | Durable community container — the primary membership and governance unit |
| **Project** | Initiative-oriented space — pursues a specific mission |
| **Responsibility** | Function-oriented space — performs an ongoing coordination role |

Groups, Projects, and Responsibilities are equal Coordination Spaces. They differ in lifecycle semantics and persistence — not in their access to communication infrastructure.

Groups and Projects are **durable containers**. Responsibilities are **functions with expiring assignments**.

---

## Projects

### Purpose

Projects exist to pursue an initiative.

Examples:
- Community Garden
- Tool Library
- Food Drive
- Emergency Preparedness Project

Projects accumulate autonomy. Projects are communities organized around a mission.

### Hosting

Groups may host projects.

Hosting means:
- endorsement
- discoverability
- recruitment access
- support-request access
- contribution-offer access

Hosting does not mean:
- ownership
- governance authority
- operational control

**Groups host projects but do not own them.** Projects may be hosted by multiple groups simultaneously.

### Membership

Projects have members. Project membership is distinct from group membership.

Members may apply or be invited. Membership acceptance is determined internally within the project. Project members govern project membership.

**Responsibilities do not have members; they have holders.**

### Membership and Group Participation

Project membership is tied to the social fabric of host groups. If a member becomes dormant in all host groups associated with a project, their project membership ends automatically. If ≥1 host group still has them as active or quiet, project membership is preserved.

### Internal Governance

Projects may maintain internal governance preferences. Those preferences apply only to the project. Projects do not gain authority over host groups.

Projects may not directly create:
- responsibilities
- governance changes
- living document revisions
- authority structures

Projects may **recommend** responsibility creation through proposal. Groups decide whether to act on those recommendations.

### Project Lifecycle

| Status | Meaning |
| --- | --- |
| `active` | At least one active project member |
| `quiet` | No active members; at least one quiet member remains |
| `dormant` | No project members remain; at least one host group remains |
| `completed` | Mission intentionally fulfilled through internal project decision |
| `closed` | Automatic: no members AND no host groups |

**Completed and Dormant are explicitly distinct:**
- `completed` = mission intentionally fulfilled
- `dormant` = no members remain, but the project may be revived by host groups

`archivedAt` is a visibility flag separate from lifecycle status. A project with `archivedAt` set is removed from active views regardless of its lifecycle status. Archived ≠ closed, archived ≠ completed.

### Project → Responsibility

Projects may recommend creation of responsibilities. No automatic conversion occurs. No automatic holder assignment occurs. Responsibility holders must always be approved through the group's responsibility processes.

---

## Responsibilities

### Purpose

Responsibilities exist because the group needs an ongoing function performed.

Examples:
- Reviewer
- Emergency Preparedness
- Welcome Team
- Resource Steward

Responsibilities accumulate accountability. Responsibilities serve the group rather than a specific initiative.

### Holder Lifecycle

Members may volunteer to become holders. Assignments:
- expire after a configured term
- require reconfirmation
- end when participation becomes Quiet or Dormant

Returning to Active participation does not restore assignments. The member must volunteer again.

### Abilities

Responsibilities receive explicitly granted **coordination abilities**.

Abilities facilitate cooperation. **Abilities do not create governance authority.**

Examples:
- `create_bulletins`
- `create_publications`
- `create_publication_entries`
- `create_projects`
- `issue_support_requests`
- `issue_contribution_offers`
- `approve_membership`

Accountability abilities (Reviewer only):
- `review_concerns`
- `issue_findings`
- `issue_action_proposals`
- `administrative_closure`

**Not grantable as abilities** (remain subject to member proposal/petition):
- `create_responsibilities`
- `modify_governance_preferences`
- `directly_edit_living_documents`

### Responsibility Decision-Making

Responsibility holders do not act unilaterally. Responsibility actions are decided internally through responsibility petitions (deferred to Governance RFC).

The responsibility exercises the delegated coordination capacity granted by the group. The group retains oversight through holder recall, responsibility modification, and ability modification.

### Responsibility Charters

Responsibility definitions and charters live in the Living Document system (`LivingDocument` with `spaceType: "responsibility"`). No separate document structure is introduced for responsibilities.

---

## Communication Model

All four communication systems are available to all Coordination Space types (Groups, Projects, and Responsibilities) uniformly. No specialized `GroupBulletin` or `ProjectPublication` types exist — the same primitives serve every space.

### Bulletin

Standalone, immutable, timestamped announcement.

- Open participation
- Immutable after publication
- Chronological

Statements are a Bulletin use case — not a separate communication type.

*Question answered: "What happened?"*

### Publication & Periodical

Titled collection of individually immutable entries.

```
Publication
├─ Entry (January Meeting)
├─ Entry (February Meeting)
└─ Entry (March Meeting)
```

Each entry is its own document, browsable as a collection.

Examples:
- Meeting Notes
- Lessons Learned
- Research Journals
- Training Series

*Question answered: "What have we learned?"*

### Living Document

Single current version. Editable only through proposal/petition. Revision history preserved.

**LivingDocument identity persists across revisions.** Mission, Charter, Code of Conduct, and Approved Practices remain the same `LivingDocument` through their entire history. Revisions create `LivingDocumentRevision` records — never new `LivingDocument` records.

The current accepted version is the primary representation. Historical revisions remain accessible but are not the default view.

Examples:
- Mission
- Charter
- Code of Conduct
- Approved Practices
- Responsibility Definitions

*Question answered: "What do we currently believe?"*

### Discussion

Deferred. Threading and moderation design not yet settled.

---

## Archival

All content types support archival workflows.

Archival:
- is proposal/petition-driven — not unilateral
- removes content from active views
- preserves content (archived ≠ deleted)
- keeps content searchable and historically accessible

**Archived ≠ Deleted.**

Archival semantics for Publications:
- Archive the Publication = hide the entire collection from active views
- Archive a PublicationEntry = hide one entry while the rest of the collection remains active

Future archival provenance (`archivedBy`, `archiveProposalId`, `archiveReason`) is deferred to the Governance RFC.

---

## Default Coordination Space Structure

New Groups, Projects, and Responsibilities begin with no automatically created content. Bulletins, Publications, and Living Documents must be created intentionally. This avoids unnecessary bureaucracy while preserving flexibility.

---

## Deferred Topics

### Governance RFC
- Petition mechanics and responsibility petitions
- Support counting and readiness calculations
- Governance temperatures and thresholds
- Proposal families
- Emergency declaration mechanics
- Living Document revision approval workflows

### Federation RFC
- Project-to-project relationships
- Cross-group coordination models
- Federated hosting relationships
- Recommendation propagation
