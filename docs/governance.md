# Governance

Commons governance is surfaced through petitions, responsibility confirmation, membership sponsorship, emergency declarations, and category-specific temperature signals.

Governance preferences are first-class infrastructure. They apply through explicit categories, visible thresholds, and petition durations rather than hidden authority or automatic rule by algorithm.

## Current Model

- Active group members govern group-scoped decisions.
- Active project members govern project-internal decisions.
- Responsibilities remain accountable to the group that owns them.
- Membership applications require sponsorship by an active group member before the group votes.
- Project creation is approved by a host group; after creation, project-internal petitions are scoped to project members.
- Emergency periods are declared by petition and become visible in the governance section.
- Governance temperature signals can be set per category and affect resolved petition parameters.

## Current Governance Categories

The UI exposes the 12 current categories:

- Membership
- Project
- Responsibility
- Accountability
- Living document
- Archival
- Emergency
- Discussion
- Support request
- Contribution offer
- Contribution category
- Trusted provider

Each category shows the member's signal, current temperature label, resolved threshold, and petition duration.

## Current Limits

- Responsibility volunteering is petition-backed, but creating new responsibility types is not yet implemented as a distinct petition flow.
- Some proposal families exist as backend primitives before they have polished end-to-end UI.
- Petition evaluation is explicit; page loaders must not evaluate petitions because evaluation mutates state.
- Alpha governance is for testing model clarity, not for high-stakes real-world decisions.

Founders may establish protective constitutional preferences at node creation in future work, but they do not receive permanent ruling authority.
