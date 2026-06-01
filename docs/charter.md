# Commons Charter

Commons is mutual aid coordination infrastructure for communities that need to organize care, labor, resources, trust, and collective decisions without surrendering autonomy to centralized authority.

Commons is not trying to replace society, model all human relationships, automate morality, optimize communities by algorithm, or become a generalized distributed governance framework. It is software that supports self-organization. It should help people cooperate while leaving real relationships, culture, judgment, conflict, and solidarity in human hands.

The guiding standard is:

> Make cooperation easier and domination harder.

## Core Principle

Shared coordination should be visible and accountable. Personal life should remain private and sovereign.

This distinction should shape every major Commons feature:

- Shared records that affect others need consent, accountability, auditability, privacy envelopes, and understandable governance.
- Personal-only records should stay under user control whenever possible, including local storage, encryption, deletion, export, retention choices, and opt-in sync.
- Commons should minimize unnecessary personal data collection.
- Sensitive support data should remain temporary, bounded, and protected from broad replication.
- Community memory should remember contribution and coordination without archiving vulnerability as public history.
- Commons should reveal coordination complexity gradually, allowing participation to deepen without overwhelming users.
- Commons should support human judgment, trust, and coordination rather than replacing them with opaque algorithmic authority.

## The Minimum Social Loop

The most important Commons loop is practical and human:

1. A community need appears.
2. Trusted people coordinate.
3. Help is delivered.
4. Contribution is remembered.
5. Vulnerability is not archived.
6. Trust in the commons grows.

Federation, offline sync, portable identity, signed events, plugins, and governance machinery only matter insofar as they protect and strengthen this loop.

## The Four Layers

### Human Layer

The human layer is real-world relationship, trust, culture, solidarity, conflict, mutual aid, and informal networks.

Commons must not try to fully digitize this layer. The software supports it; it does not replace it.

### Coordination Layer

The coordination layer is the app people use to organize work:

- support requests
- offers
- service capabilities
- projects
- proposals
- contributions
- temporary responsibilities
- request routing
- trust workflows

Most product development should stay anchored here until Commons is socially useful as a local-node mutual aid tool.

### Constitutional Layer

The constitutional layer prevents coordination from becoming coercive:

- privacy envelopes
- governance preferences
- trust requirements
- retention rules
- replication policies
- visibility rules
- responsibility expiration
- constitutional constraints

This layer should keep power visible, scoped, revocable, and understandable.

### Infrastructure Layer

The infrastructure layer preserves continuity, autonomy, survivability, and exit rights:

- nodes
- portable identity
- linked node presence
- federation readiness
- offline sync
- signed events
- future P2P resilience

This layer should remain mostly invisible to ordinary users. It should support local autonomy and peaceful exit without becoming the main product.

## Commons Is Not A File Repository

Commons coordinates people, commitments, projects, and community memory.

Commons is not intended to become a general-purpose document management system.

Asking someone to upload a document in order to receive support is a form of gatekeeping. It assumes literacy, device access, and a willingness to hand over sensitive materials before help is offered. These assumptions are incompatible with the mutual aid context Commons is designed to serve.

Implications:

- No document uploads in core Commons.
- No required attachments for support requests.
- No assumption that users can provide documentation.
- Vulnerability should not need to be proven through uploaded evidence.

Ask only what is necessary to coordinate help.

## Commons Is Self-Contained By Default

Support requests, contributions, concerns, membership, trust, and accountability should remain fully understandable from within Commons itself.

External systems should not become hidden dependencies for understanding what happened in a community.

If resolving a concern, reviewing a contribution, or understanding a trust decision requires following an external link, then Commons has partially outsourced its accountability layer to an infrastructure it does not control, cannot audit, and cannot guarantee will remain available.

Implications:

- No external links in support requests.
- No external links in concern reports.
- No external links required for contributions.
- No external links required for trust or accountability workflows.

This protects transparency, accessibility, and the ability of communities to understand their own history without depending on third-party services.

## Vulnerability Should Not Be Archived

The fifth step of the minimum social loop is: vulnerability is not archived.

This requires active architectural commitment, not only passive restraint.

A document submitted as evidence of need often contains:

- home addresses
- medical information
- legal information
- financial information
- family information

Commons should be extremely cautious about becoming a storage location for these materials.

Implications:

- Sensitive documents should not be retained by default.
- Future attachment systems should be optional plugins governed by explicit community consent.
- Federation should never automatically replicate attachments.
- Replication policies and privacy envelopes must apply to any document or file data at least as strictly as they apply to support request content.

Community memory should hold contribution and coordination. It should not hold archived hardship.

## Anti-Capture Guardrails

Commons must actively avoid becoming the kind of institution it was meant to soften.

Watch for:

- hidden admin power
- excessive retention
- mandatory identity
- opaque permissions
- complicated governance
- technical gatekeeping
- admin convenience bypassing privacy
- permanent recipient or vulnerability histories
- global reputation scoring
- automation that replaces human consent
- outrage optimization
- contribution competition
- guilt-driven notifications
- addictive interaction patterns

Simplicity is political architecture. A feature that is technically elegant but socially illegible can still concentrate power.

Commons must not use manipulative engagement mechanics. Notifications, contribution visibility, routing, and proposal flows should help people coordinate without manufacturing urgency, shame, rivalry, or dependency.

Trust should remain contextual, scoped, explainable, and revocable rather than becoming a permanent global reputation system.

Interface work should follow the [Commons Experience Principles](experience-principles.md), which translate this charter into UI guidance for calm coordination, progressive complexity, visible privacy, emotional safety, mobile-first access, and non-manipulative notifications.

## Feature Filter

Before adding a major feature, ask:

Does this increase the community's ability to coordinate itself without unnecessarily increasing surveillance, bureaucracy, dependency, or hidden power?

If the answer is unclear, prefer the smaller, more reversible design.

## Signed Events

Signed events may support accountability, migration readiness, portable identity continuity, and future federation.

They must not become blockchain architecture, total event sourcing, append-only dogma, or immutable surveillance history. Commons still needs deletion, expiration, revocation, correction, and consent withdrawal, especially around support records and sensitive coordination.

Events should help communities understand important shared actions. They should not preserve private hardship forever.
