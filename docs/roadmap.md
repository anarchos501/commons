# Roadmap

Commons development should stay anchored to the minimum social loop:

1. A community need appears.
2. Trusted people coordinate.
3. Help is delivered.
4. Contribution is remembered.
5. Vulnerability is not archived.
6. Trust in the commons grows.

Near-term work should make that loop usable on one healthy local node before adding heavier infrastructure.

## Phase 1

Core models: Node, Account, PortableIdentity, Group, Project, ServiceCapability, TrustedServiceCapability, Contribution, SupportRequest, Offer, Proposal, Role, GovernancePreference, and PrivacyEnvelope.

## Phase 2

Core web app: request intake, service directory, route review, contributor accept/decline flows, contribution logging, group/project pages, lightweight dashboards, and proposals.

## Phase 3

Routing and trust: service notifications, contributor availability, trust petitions, trust approvals, and request routing.

Contributor availability should stay private, revocable, and low-pressure. Future controls may support preferences such as unavailable, available, limited, and time-sensitive capable, but must avoid creating an on-call culture, urgency pressure, public reliability signals, or implied obligation.

## Phase 4

Mobile and PWA: installable app, offline drafts, encrypted local storage, sync queue, and cached group/project views.

## Later

Security audits, deletion/export workflows, federation readiness, portable identity migration, offline sync, and plugin foundations.

## Scope Boundary: Resource Coordination

Core Commons should remain focused on human coordination. For resource-related workflows, the platform should stop at:

- Resource Needed
- Resource Pledged
- Resource Fulfilled

Core Commons should not drift into:

- inventory management
- warehousing
- asset management
- procurement
- accounting

Communities that need those capabilities may add them through optional plugins. The core platform should remain self-contained for human coordination while avoiding responsibility for document storage, external workflow dependencies, and inventory administration.

## Hybrid Architecture Preparation

Prepare a split-by-data-class architecture with lightweight signed events, local sync state, and replication policies before implementing full federation, P2P, CRDTs, or browser encryption. Signed events are accountability and migration preparation, not blockchain architecture, total event sourcing, or immutable surveillance history.
