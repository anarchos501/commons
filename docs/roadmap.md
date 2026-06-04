# Roadmap

Commons development stays anchored to the minimum social loop:

1. A community need appears.
2. Trusted people coordinate.
3. Help is delivered.
4. Contribution is remembered.
5. Vulnerability is not archived.
6. Trust in the commons grows.

The current alpha has enough of that loop implemented to test on one local node: support requests, routing, contribution records, group workspaces, project workspaces, responsibility workspaces, petitions, governance temperature signals, and accountability concern flows.

## Current Alpha Focus

- Make the implemented workflows clearer and less brittle.
- Keep project-internal governance autonomous from host-group membership.
- Keep responsibilities accountable to their group.
- Tighten tests around petition side effects, membership sponsorship, emergency periods, project workspaces, and responsibility coverage.
- Keep documentation aligned with what testers can actually do in the UI.

## Next Product Work

- Polish onboarding for public requesters, applicants, members, project participants, and responsibility holders.
- Improve petition visibility, status explanations, and outcome history.
- Add missing responsibility type governance, likely as a distinct `responsibility_type_proposal`.
- Add production-grade account recovery, email or anti-abuse controls, and operator tooling.
- Add user-facing data deletion/export workflows.
- Continue simplifying the dashboard and sidebar as more workflows become available.

## Deferred Infrastructure

- Mobile/PWA install path, offline drafts, encrypted local storage, sync queue, and cached workspace views.
- Federation between Commons nodes.
- Plugin runtime and permission enforcement.
- End-to-end encryption and stronger local-first storage.
- Full security review, rate limiting, and deployment hardening.

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
