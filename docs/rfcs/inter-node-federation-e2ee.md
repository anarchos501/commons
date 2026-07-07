# RFC-009: Inter-Node Federation & End-to-End Encryption

## Status

Accepted — implementation in progress. F0 (protocol & peering) and Workstreams A (steward hardening + appointment legibility) and B (the design & decision register) are implemented; F1 (federation governance) is implemented behind the two-node harness; F2–F6 and Workstream C are specified here and tracked in the implementation program. The canonical commitments this RFC rests on live in [docs/register.md](../register.md) — where this RFC and the register differ, the register wins and this RFC must be amended.

## Purpose

Commons grows from a healthy single-node system toward federation between nodes, and from privacy-by-convention toward a content-blind host. This RFC is the constitutional text for both: how autonomous nodes form, live inside, and leave relationships with each other; and what the operator of a node can and cannot see as encryption lands. It covers the full program — the wire protocol (F0), federation governance (F1), identity and presence (F2), cross-node entities and UI (F3), Rung-1 encryption (F4, the beta gate), hardening (F5), the Rung-2 destination (F6), and the email workstream (C) — so later phases implement against a settled shape rather than re-deciding it.

RFC-007 defined federation *within* a node (groups → projects, coalitions, stewardship). This RFC extends the same pattern one level up: coalitions cooperate → nodes federate. It introduces the first programmatic API Commons has ever exposed, and records that as a deliberate, defended decision (register F-4).

---

## Constitutional Principles

1. **Federation is a relationship between communities, not a network default** (register F-2). Two nodes federate the way two collectives form a coalition: by mutual, petition-backed consent on both sides. No node is federated with anything until its people decide to be.
2. **Federation enables opportunity; it never mandates interaction.** An agreement exposes nothing by itself. Every collective starts closed toward every peer node and opens itself toward a specific peer only by its own petition (register D-4). Deliberate acts — joining a cross-node coalition — carry their own consent and need no prior standing grant. Consent is collected once per layer and never charged twice.
3. **The vulnerability asymmetry crosses the wire** (register D-3). Contribution and coordination records may federate; request content, concern records, and everything in the vulnerability class never leave the home node as plaintext federation payloads. One deny-by-default predicate — `mayFederate(dataClass, agreement)` — guards every path, enforced at enqueue, upstream of the transport, which is architecturally private to the outbox.
4. **Recall before authority, again.** Every federation agreement is revocable by the same class of process that created it — cheaper, in fact: starting is delegated, stopping is community-owned. De-federation is a first-class flow.
5. **Home-node sovereignty** (register F-6). Every account, group, project, and coalition has exactly one home node that is authoritative for it. Other nodes hold presences — references, never copies of authority. Resilience comes from refuges and re-homing, never from multiple live authorities.
6. **Legible boundaries beat seamless illusion.** The UI tells the truth about where data lives and where an action will land: aggregated reads, routed writes, a node tag on every remote thing.

---

## Part I — The Federation Agreement (F1)

### Governance: authority rides steward appointment

Federation authority is an explicit, legible part of what appointing the node steward collective means (register F-5). The appointment UI, the steward petition detail panels, and the node page all state the mandate plainly. One node-wide consent moment — appointment — grants it; a second node-wide "policy vote" would double-charge the same consent and is deliberately absent.

- **`federationPolicy` is steward-managed.** Changing it is a steward-group petition (`federation_policy_change`, the reversible Pattern-A shape, one open at a time), not a constitutional object. `allowlisted` is the beta default posture.
- **Any member may initiate.** A member with a peer's address pins it (`/.well-known/commons` → key + identity) and opens a federation request; the request *is* a petition before the steward collective — the member's own petition if they sit in that collective, a system petition before it otherwise. Inbound proposals from remote peers land in the same steward queue.
- **Node-wide power is reserved for stopping, never required for starting.** Any active member may open `federation_termination` (end one agreement) or `federation_disable` (end them all and close the surface) — single aggregated node-wide votes. A community that wants to be constitutionally non-federating can make itself so. Mass mobilization is the instrument for checking power and must never be the price of acting.
- **No steward ⇒ not federable, fail-closed in both directions.** With no steward collective there is no entity to receive *or propose*: outbound requests are refused at open; inbound proposals draw a **signed rejection decision** (reason: `no_steward_group`) rather than a silent timeout, and `/.well-known/commons` reports `federation: unavailable`. The node's own pages say why and point at the appointment path.

### Mutual consent: the cross-node bundle

The machinery mirrors coalitions structurally (`Federation` ≙ `Coalition`, `FederationMembership` ≙ `CoalitionMembership`, `FederationProposal` ≙ `CoalitionProposal`, `FederationProposalPetition` ≙ `CoalitionProposalPetition`), with one new element — `FederatedNode`, this node's pinned record of a peer (domain, key, status, delivery address) — and one new problem: the participants live in different databases.

The consent protocol (no coordinator, no distributed locks):

1. The initiating node mints a shared proposal UUID, opens its own steward petition, and delivers a signed `federation_proposal_opened` event.
2. The receiving node mirrors the proposal row under the same id and opens its own steward petition in its own queue.
3. Each side holds a `decisions` map (`domain → pending | approved | rejected`). Local petition resolution folds into the map and broadcasts a signed `federation_proposal_decision`. Decisions are **monotonic** (pending → terminal, never back) and idempotent by `(proposalId, domain)`, so redelivered or reordered events cannot change an outcome.
4. Each side applies independently on unanimity: all approved → the agreement activates (the proposal's UUID becomes the `Federation` id, so both databases converge without negotiation); any rejection → `failed-rejected` everywhere; remote silence past the deadline → `failed-timeout` via a sweep, with the local side emitting its own rejection so the peer converges rather than waiting out its own clock. A late approval after a terminal state is ignored by design.

Departure is unilateral (steward petition, peer notified); the node-wide valves dissolve agreements the same way. **Ending an agreement does not sever the pin**: the peer demotes from `active` back to `proposed` — still a known node, still reachable for the goodbye notice and a future re-federation — because a pin severed at dissolution would dead-letter the goodbye itself. `ended` is reserved for actual peer severance (F5).

### What an agreement grants: nothing, yet

An active agreement is pure capability. Per-collective visibility grants (F3) decide what flows, collective-by-collective, peer-by-peer:

- Default **closed**: an agreement adds a row to every collective's federated-nodes list and changes nothing else.
- Opening is a petition-backed, reversible stance per peer: `closed | visible | interactive` (`federated_visibility_change`, subject `groupId:peerNodeId:target`).
- **Grants are a public-group instrument only.** Private groups cannot hold a `visible`/`interactive` stance (`private_group_not_grantable`); their only cross-node exposure is a deliberate shared act — coalition membership, project co-hosting — with name/description disclosure scoped to that shared entity's membership, never to the peer node broadly.
- **The honest scope is enforced in code, not UI copy** (register D-4): the stance chokepoint gates *federated-surface* serving — discovery in peer listings, inbound requests, presence interaction — and never touches public-web serving. A public group set to `closed` toward a peer still serves its public page; the grant retracts nothing from the open web, and a test asserts it.
- Grants suspend when the agreement ends (reversible, the soft-archive precedent).

---

## Part II — Identity, Presence, and Mediated Action (F2)

> A person authenticates only ever to their home node. Everywhere else, their home node vouches for them cryptographically.

- **Identity anchor:** `PortableIdentity` — a `did:key` DID over an Ed25519 keypair, node-custodied at beta (`IdentityKeyCustody`, a deliberately movable boundary — register D-8). `did:key` is self-certifying and survives node death and re-homing; a domain-chained method would contradict the refuge design.
- **Presence, not account:** interaction with a remote node creates a `LinkedNodePresence` there — a reference plus whatever standing that community has granted it. No password, no session, no imported authority.
- **Pattern 1 (beta): home-node-mediated action.** The person acts in their home node's UI; the home node signs the action (identity signs the payload, node signs the envelope) and delivers it server-to-server. The remote node verifies both signatures against pinned keys, checks the presence's standing, and applies the action through its own ordinary `{ok, reason}` domain logic. **Authorization always stays local**: federation authenticates who is acting, never imports what they may do. No trust score crosses the wire.
- **Pattern 2 (visiting sessions)** — the person's browser hitting the remote node directly — is deferred and named; Pattern 1 covers coalition coordination, cross-node projects, and cross-node petition participation.

## Part III — The Wire Protocol (F0, implemented)

Commons' first API, and deliberately its smallest possible one (register F-4):

- **Discovery:** `GET /.well-known/commons` — node identity, active signing key (Ed25519, SPKI PEM), federation policy (or `unavailable`), inbox address.
- **Delivery:** `POST /api/federation/inbox` — signed JSON envelopes only; browsers never call it.
- **Envelope:** the SignedEvent shape extended with `eventId` (sender-minted UUID), origin `{domain, keyId}`, timestamps; canonical JSON; the signature covers every routing and identity field plus the payload hash, so nothing verifiable can be swapped after signing.
- **Identity vs. delivery address:** a peer's `domain` plus its pinned key are the identity everything security-relevant keys off; its self-reported `inboxUrl` is untrusted routing metadata that can at worst misdeliver the peer's own traffic (register F-4).
- **TOFU pinning:** first contact stores the key; a changed key is refused (`key_mismatch`), never silently repinned. Rotation gets an explicit countersigned path in F5.
- **Replay and idempotency:** insert-first dedupe on `(origin, eventId)` — the database constraint, not application logic, decides the winner; handler effects and the dedupe row commit in one transaction. Duplicates answer `200` so the sender stops retrying.
- **Delivery model:** outbox + sweep with exponential backoff and dead-lettering — never synchronous inside a user request. A dead peer degrades cross-node delivery, never local operation.
- **The chokepoint** (register D-3): everything on the wire passes `mayFederate` at enqueue. Deny-by-default, vulnerability class structurally excluded, with exactly one named exception: the **protocol tier** (pings, proposals, decisions, notices) flows to `proposed` peers too, because agreements cannot form if the proposal cannot reach a not-yet-active peer. The tier carries governance-handshake events only — never content, never coordination — and a test asserts nothing else passes pre-active.

## Part IV — Cross-Node Entities & UI (F3)

**Aggregated reads, routed writes.** Reads can feel seamless: the person-centric home already aggregates across spaces, and remote spaces are one more scope, carried by cached copies of coordination content refreshed by deliveries. Writes never pretend: every space has one home node, a write routes there, and the UI says so — a quiet, always-visible node tag on any remote space or actor. Ambient context-switching that silently "becomes" another server would hide which operator sees the interaction and which community's rules govern it.

**Cross-node coalitions** are the flagship: a coalition whose member groups live on different nodes. The coalition's home is the proposing group's node; member groups elsewhere hold presences; formation runs the same consent protocol as agreements (reusing the decisions-map machinery). **Topology is hub, not mesh:** each member node needs an agreement with the coalition's home node only; the home relays coordination content, and `mayFederate` is checked against the home-node agreement on every relay leg — member nodes knowingly trust the home as relay for coordination-class content.

**Refuges** (register F-6): refuge hosting is a term of the federation agreement — within an active agreement, any collective may designate the peer as a refuge by its own petition, by right. A refuge holds a **cold copy, never live authority**: structural snapshots from F3; content only as Rung-1 ciphertext (so a refuge operator reads nothing), which is why full refuges land with F4. Re-homing has two entrances — graceful signed handoff, or disaster member-quorum activation on the refuge — with a split-brain guard: authority transfers only by signed handoff or quorum activation, recorded as signed events; a stale returning home must reconcile and demote. **Refuge-then-promote is a recorded capture vector** (register D-5): a large group activating onto a small node could dominate its electorate; arrival-weight phase-in must be decided before disaster activation ships.

## Part V — End-to-End Encryption (F4, F6)

**The commitment is a content-blind host** (register F-1). The charter's "shared coordination should be visible and accountable" means visible to the community, never to the operator; the host reading everything is an artifact of server-side rendering, not a designed decision. Two rungs:

**Rung 1 — content-blind host (the beta-entry gate, F4).** Content across collective surfaces is encrypted to its audience's keys (X25519-wrapped AES-256-GCM data keys per scope); structural metadata — that a petition exists, its state, deadlines, thresholds, membership records, timing — stays plaintext so the lifecycle machinery keeps running. Sequenced by sensitivity: (a) the vulnerability class first (request content and contact, post-match coordination, concern narratives), (b) collective content (petition bodies, discussion threads, documents), (c) private-group names/descriptions plus the attribution audit. Redaction becomes key destruction — stronger than today's SQL UPDATE. Decided details:

- **Guest requests:** encrypted with key material derived from the request's bearer token (HKDF from the raw token; the stored hash still authenticates). The token is the guest's only key; the submission UI says so. Fallback, only if the token-lifecycle math fails at design time: guest requests excluded from Rung 1 with the honest D-6 statement at submission.
- **History on join:** admission rewraps content keys to the joiner — a member who cannot read the petition history cannot understand the group. Per-group forward secrecy is foreclosed as a default (register D-8) and possible only as a future per-group opt-in.
- **Attribution: omit rather than encrypt.** Display names stay plaintext at Rung 1 (node-custodied name encryption would be theater); instead, every site rendering a person's name is audited into three buckets — load-bearing (responsibility seats, contributions, concern parties, steward membership: names stay), structurally-attributed-but-display-omitted (petition proposer: kept in the row for withdraw rights and accountability, removed from general display; the "available on cause" path is a designed, gated, logged access — never silent unmasking), and decorative (dropped). In small groups prose style identifies authors anyway: this is "not amplified," never "anonymous."

**Rung 2 — blind server (post-beta destination, F6).** Clients compute governance over decrypted state and post signed results; the node becomes storage and delivery. Named now so nothing pre-beta forecloses it: `IdentityKeyCustody` is a movable custody boundary, `decryptForViewer` is the single relocation seam, and **no server feature may grow a new dependency on content plaintext after F4** (register D-8). Its real problems — key backup/recovery, member-removal rotation, guest keys, liveness (client-evaluated petition resolution), poisoned-client mitigation — are named, not hand-waved.

**The honest ceilings** (register D-6, verbatim commitments): *"Commons hides what your community says from the host; it cannot fully hide who your community is from the host."* Membership and the delivery graph are not hideable from your own server; pseudonymity erodes under small-community correlation (and an attached email is a far stronger re-labeling key than traffic timing); web-delivered E2EE defends against a curious operator, not a malicious one shipping a poisoned client; the active rung and custody model are stated in-product. No server-side search over encrypted classes at beta (register D-7).

## Part VI — Email & Registration (Workstream C)

Independent of federation, gating beta alongside F4 (it is the delivery channel for concern-subject notification):

- **Registration modes:** `open` (rate-limited) or `invite_only` (member-generated personal invite tokens — members inviting neighbors is the egalitarian baseline, not a steward gate). Switching modes is a node-wide petition (`registration_mode_change`); the initial mode is set at creation. Existing nodes backfill to `open` (preserving current behavior); new nodes default to `invite_only`.
- **Email is optional in both modes, forever** (register D-2): handle-only accounts are first-class and permanent. Email verification is explicitly not the anti-flood mechanism — it is a weak Sybil defense that would filter the vulnerable more effectively than bots.
- **Hardened storage, honestly framed:** no plaintext email column — salted hash for login lookup, ciphertext (key held outside the database) for sending. This is breach protection, never operator-blindness: the live operator holds the send key and the mail logs, and no cipher can hide an address the server must send to.
- **Email carries existence, not content** (register D-9): bodies and subjects are the fact of activity plus a link — no message text, no petition bodies, and categorically nothing from a Rung-1-encrypted class, which would defeat F4 through third-party mail servers. All categories default off; person-targeted safety notifications are recommended-on, never forced-on; no re-engagement machinery of any kind.

---

## Phasing (the implementation program)

| Phase | Contents | Status |
|---|---|---|
| F0 | Node keys, `/.well-known/commons`, signed envelopes, outbox/inbox, TOFU pinning, `mayFederate` chokepoint, two-node dev harness | Implemented |
| A | Steward appointment/recall audit + hardening; appointment-mandate legibility | Implemented |
| B | `docs/register.md` — the canonical decision register | Implemented |
| F1 | Agreement models, mutual-consent protocol, steward-managed policy, node-wide STOP valves, federation petitions + details, node-page surface | Implemented |
| F2 | `PortableIdentity` activation (`did:key`, custody), `LinkedNodePresence`, Pattern-1 mediated actions | Specified |
| F3 | Visibility grants (first), cross-node coalitions (hub topology), node tags + home aggregation, refuge designation + structural replication | Specified |
| F4 | Rung 1: content-blind host — vulnerability class → collective content → names + attribution audit; refuge ciphertext replication | Specified (beta gate) |
| C | Registration modes, optional verified email, opt-in existence-only notifications | Specified (beta gate) |
| F5 | Rate limits, suspension, countersigned key rotation, compromise runbook | Specified |
| F6 | Rung 2: blind server | Named, guarded, post-beta |

## Open Questions (deliberately open, tracked in the register)

1. **Arrival weight on re-homing** (register D-5) — must be decided before disaster activation ships; phase-in via participation weighting is the leading candidate.
2. **Guest token-lifecycle confirmation** at F4a design time (the A1 decision's one contingency).
3. **`project_level` / `emergency_only` policy semantics** — defined when a real use case arrives.
4. **Node-level trust signals** — per-agreement, local judgment only; this is where a global-reputation system could sneak in wearing federation clothes, and it must not.
5. **Node-scale accountability** (expelling an abusive group) — mirrors the concern pattern, never admin power; removal ≠ data destruction (the exit path is the refuge flow); under a content-blind host the node can eject but not inspect.
