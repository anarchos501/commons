# Roadmap

Commons development stays anchored to the minimum social loop:

1. A community need appears.
2. Trusted people coordinate.
3. Help is delivered.
4. Contribution is remembered.
5. Vulnerability is not archived.
6. Trust in the commons grows.

The current alpha has enough of that loop implemented to test on one local node: support requests, routing, contribution records, collective workspaces, project workspaces (with join requests), responsibility workspaces, coalitions with multi-collective federation governance, petitions, governance temperature signals, and accountability concern flows.

## Current Alpha Focus

- Make the implemented workflows clearer and less brittle.
- Keep project-internal governance autonomous from host-collective membership.
- Keep responsibilities accountable to their collective.
- Tighten tests around petition side effects, membership sponsorship, emergency periods, project workspaces, responsibility coverage, and coalition governance flows.
- Keep documentation aligned with what testers can actually do in the UI.

## Next Product Work

- Polish onboarding for public requesters, applicants, members, project participants, and responsibility holders.
- Improve petition visibility, status explanations, and outcome history.
- Wire the one-way Project `completed` exit (RFC-007) — the status exists but has no writer yet.
- Add production-grade account recovery, email or anti-abuse controls, and operator tooling.
- Add user-facing data deletion/export workflows.
- Continue simplifying the dashboard and sidebar as more workflows become available.

## Deferred Infrastructure

- Mobile/PWA install path, offline drafts, encrypted local storage, sync queue, and cached workspace views.
- Federation between Commons nodes.
- Plugin runtime and permission enforcement.
- End-to-end encryption and stronger local-first storage.
- Full security review, rate limiting, and deployment hardening.
- **Screenshot attachments on bug reports.** There is no file-upload/storage infrastructure yet;
  attachments await a storage-strategy decision (Postgres bytes vs object storage) before implementation.
- **Defunct-group hard deletion.** Groups with no active members are now hidden and soft-archived
  (`Group.archivedAt`), and the immediate/grace-period hard delete is intended — but `Group` has ~40 child
  relations without DB-level cascade, so destructive purge needs cascade rules (or a transactional
  multi-table cleanup) of its own. Until then, defunct groups are hidden, not deleted.
- **Custom support requests on the node-wide form.** The opt-in flag + group-scoped `/request/[groupId]`
  form + routing-to-members ship now; surfacing custom requests on the public node-wide `/request` form and
  a group-level "trusted for custom" designation are follow-ons.

## Scope Boundary: Resource Coordination

Core Commons remains focused on human coordination. For resource-related workflows, the platform should stop at:

- Resource needed.
- Resource pledged.
- Resource fulfilled.

Core Commons should not drift into:

- Inventory management.
- Warehousing.
- Asset management.
- Procurement.
- Accounting.

Communities that need those capabilities may add them through optional plugins later. The core platform should remain self-contained for human coordination.

## Hybrid Architecture Preparation

Signed events, local sync state, replication policies, portable identity, and federation-ready schema foundations are preparation work. They are not blockchain architecture, total event sourcing, or immutable surveillance history.
