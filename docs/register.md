# Commons — Design & Decision Register

*Canonical, in-repo record of load-bearing design commitments and known limitations. Each entry is a promise or a boundary that must stay true as the code changes. When a change would violate an entry, that is a signal to stop and revisit the entry deliberately — not to quietly let the code drift.*

**How to use this file.** Append-mostly. One entry per commitment or limitation, stable ID. `F-n` = architecture/authority direction; `D-n` = data/privacy boundary. When code enforces an entry, reference the entry ID in a comment at the enforcement point (same convention as the RFC references already in the code). This file is the **canonical** copy; exploratory analysis may happen elsewhere, but nothing is a commitment until it lands here.

**Entry format:** Status (Committed / Open / Watch) · Decision (one sentence) · Context · Consequences · Links.

---

## F-1 — Content-blind host is the operator-sovereignty commitment

**Status:** Committed (direction); Rung 1 targeted for beta, Rung 2 post-beta.
**Decision:** A node operator must not be able to read the *content* of the community's life on their own server; the commitment is a content-blind host, not merely encryption of a narrow "vulnerability class."
**Context:** The charter's "shared coordination should be visible and accountable" means visible **to the community**, never **to the operator**. The host currently reading every petition, chat log, and roster is an artifact of server-side rendering (the server renders, so it reads), not a designed decision. "No hidden admin power" carries no asterisk reading "except the host reads everything."
**Consequences:** Rung 1 (beta gate) encrypts content across collective surfaces to member-held keys while structural metadata stays plaintext so lifecycle machinery runs. Rung 2 (post-beta) moves governance computation client-side (blind server). Redaction becomes key destruction. The honest residual is recorded in D-6 — this is a large narrowing of operator power, not its elimination.
**Links:** federation-e2ee plan §6; D-1; D-6; F4.

## F-2 — Federation is opportunity, never mandate; consent is collected once per layer

**Status:** Committed.
**Decision:** Federation between nodes creates only the *capability* to interact; no group, project, or person is exposed or obligated by it. Consent is collected once, at the layer that owns each decision, and never charged twice.
**Context:** A node↔node agreement is a handshake (keys, peering, presence capability) that exposes nothing. Each scale has exactly one consent moment: a node consents to federation via steward appointment (F-5); a collective consents to each peer via a per-(collective, peer-node) grant (D-4); a member consents to each interaction via the normal petition/request machinery. Repeated attempts to add a second consent gate (a standing node-wide policy vote atop steward appointment; a per-group refuge application atop the agreement; a standing visibility grant atop a deliberate join) were each rejected as double-charging.
**Consequences:** Every layer defaults **closed** and opts in per relationship. Every layer's power to *stop* (de-federation valve, recall, grant revocation) is cheaper than its power to start. Deliberate acts (joining a cross-node coalition) are their own consent and need no prior standing grant. This is the project's strongest articulation of "consent, not coercion" — it specifies *where* consent is collected and *how often*, which the charter does not.
**Links:** plan §1, §2b; F-5; D-4.

## F-3 — Federation extends the hostile-collective threat model (a peer node can be the hostile collective)

**Status:** Watch.
**Decision:** Treat a whole peer node as a potential hostile collective — capture, impersonation, payload abuse — not just individual bad actors.
**Context:** The register's standing asymmetry: Commons is well-defended against a hostile *individual*, under-defended against a hostile *majority*. Federation raises the stakes on the weak side because it turns "a majority forms inside your node" into "a majority can *arrive*." Most hard federation questions (F-6 refuge-then-promote, node-scale removal, arrival weight) are hostile-collective problems.
**Consequences:** Mitigations: mutual-consent agreements, pinned node keys (TOFU at proposal, confirmed via `/.well-known/commons`), per-agreement `mayFederate` allow-lists, unilateral departure, per-peer visibility grants defaulting closed. The counter-majoritarian safeguards (entrenchment, arrival-weight phase-in, protected exit) stop being theoretical at federation.
**Links:** plan §9; F-5; F-6; D-4.

## F-4 — The federation protocol is Commons' first API — a new attack and power surface

**Status:** Committed.
**Decision:** Introducing a node-to-node wire protocol ends the "no API" property; treat that end as a deliberate, defended decision.
**Context:** Commons has had no API surface — its single existing route handler is a browser redirect (the invite join route), not a programmatic interface. The no-API simplicity was itself a safety property (a smaller surface to attack and to concentrate power in). Federation requires a server-to-server API.
**Consequences:** The API is narrow, versioned, signed (Ed25519 envelopes), server-to-server only (browsers never call it), deny-by-default on data classes, replay-protected, and rate-limited (F5). Every inbound message verifies against a pinned key. This entry is the standing reminder that the surface must stay minimal. **The surface grew by one pull route (F3.5 amendment):** `/api/federation/continuity-status` — the first request/response endpoint — exists because quiet-boot verification needs a bounded synchronous answer to leave read-only, which the async-with-backoff outbox deliberately cannot give. It is read-only, server-to-server, node-signed in both directions, and verified against pinned keys; browsers never call it. Identity and delivery address are distinct things and must never be conflated: a peer's `domain` (plus its pinned key) is the identity everything security-relevant keys off; its delivery address (`FederatedNode.inboxUrl`, self-reported via `/.well-known/commons`) is untrusted routing metadata — a peer pointing it elsewhere can at worst misdeliver its own traffic, never redirect trust or impersonate. Envelope signatures cover the origin domain, never the delivery address.
**Links:** plan §4; F0; F5.

## F-5 — Federation authority is delegated to the steward collective, granted at appointment

**Status:** Committed.
**Decision:** Per-peer federation agreements — and federation policy itself — are decided by the node steward collective; the node-wide mandate for this is granted when the steward collective is appointed, not by a separate policy vote. Node-wide petitions are reserved for *stopping* (end an agreement, disable federation).
**Context:** A node-wide petition per peer is unworkable at scale (quorum failure or rubber-stamp fatigue). Two facts make delegation legitimate rather than a concentration of hidden power: (1) an agreement exposes nothing by itself (F-2), so it is low-stakes; (2) steward appointment is already an unavoidable node-wide two-step, so it *is* the consent moment — a second policy vote double-charges it. No steward ⇒ not federable (fail-closed), which also guarantees federation always rests on at least one node-wide decision.
**Consequences:** Steward appointment becomes the single most consequential vote a node holds, and the steward collective becomes load-bearing for the first time. **Therefore (pre-F1 work, non-negotiable):** the appointment UI must state plainly that appointment grants federation authority, or the consent story is fiction; and the appointment/recall flows must be audited to current hardening standards before they carry this weight. Mitigations: steward recall, visible steward petitions, node-wide stop valves. **Recall must stay suppressible by nobody** (Workstream A finding A3, fixed pre-F1): the one-open-recall mutex was node-wide and therefore squattable — any member could park a never-approved initiation and block every other group's and the host's recall for its full duration, then reopen. The mutex is now scoped per initiator. Recorded residual: this trades suppression for bounded amplification — up to one node-stage recall petition per group per steward era, which the competition machinery collapses into a single decision at resolution (one winner, the rest auto-rejected under one advisory lock); flooding it requires capturing that many group majorities, the hostile-majority case F-3 already tracks. **Local-accountability floor (F2/F3 shadow-account audit, finding C1):** a collective — least of all a steward group — cannot be kept alive by remote presences alone. The defunct check counts local members only (`NOT_SHADOW_ACCOUNT_FILTER`), so a group drained of locals archives and, if it was the steward group, stewardship is vacated — federation authority can never persist on zero local accountability.
**Links:** plan §2, Workstream A; F-2; F-3; F-7.

## F-6 — Continuity is one home plus refuges, never multiple home nodes

**Status:** Committed (structural); disaster activation Open.
**Decision:** An entity has exactly one authoritative home node at a time; resilience against node death comes from cold refuge replicas plus a promotion/re-homing flow — not from multiple concurrent home nodes.
**Context:** Multiple live authorities over one entity is the split-brain problem (two petition states, two rosters, two truths under partition), which no care makes coherent. Refuge hosting is a *term of the federation agreement* (not a per-group application, per F-2): within an active agreement any collective backs up to the peer by right, as cold ciphertext.
**Consequences:** Refuges hold ciphertext + structure, never live authority; members hold keys, so a refuge operator gains no read access (backup does not multiply the F-1 problem). Re-homing has two entrances: graceful signed handoff, or disaster member-quorum activation on the refuge. **Capture vector (Watch):** a large group promoting onto a small node can dominate its electorate — see D-5 (arrival weight). Authority transfers only by signed handoff or member-quorum activation; a stale returning home must reconcile and demote. **Reframed by F3.5 (this amendment): the re-homing target is RECONSTITUTION, not continuity-transfer.** A permanently stranded entity's replica activates as a NEW entity — new id, technically a different thing, furnished with the D-10 Tier-B archive (same name, documents, contribution memory; governance history as read-only inheritance; live governance starts fresh). This abandons the legal fiction of sameness and with it the identity-forgery, ghost/split-brain, and consent-transfer problems (relationships are re-earned entity-by-entity, F-2). Gated by the entity's advance directive (`reconstitute`, recorded at designation — the only legitimate consent moment), escrow-verified membership (D-8), and D-5 arrival weight — the one hard question that survives the reframe. The old member-quorum disaster activation is Tier 3, post-beta, named only.
**Links:** plan §5b; D-5; F-3.

## F-7 — Petition single-open invariants are not DB-enforced (standing caution)

**Status:** Watch.
**Decision:** Any flow that assumes "at most one open petition per key" must either add a family-specific partial unique index (the `Petition_custom_requests_toggle_open_unique` precedent) or a conscious application-level guard — never assume the competition key enforces it at open time.
**Context:** The partial unique index on open competition keys was deliberately dropped (migration `20260603000400_fix_petition_duplicate_constraint`). Since then, multiple open petitions can share a competition key; the machinery serializes and collapses them **at resolution** (`resolveCompetingPetitions`: one advisory lock, one winner, the rest rejected), not at open. This sharp edge has bitten twice — the steward double-escalation race (audit A2: a duplicate node vote orphaned by re-entry could win the competition and burn a passed appointment) and the reasoning around the recall mutex (A3) — and the third feature to assume a DB constraint enforces single-open is the one that ships the bug to beta.
**Consequences:** New petition families (F2, F3, and beyond) declare their single-open story explicitly at design time: partial unique index, application guard + advisory lock, or "competition-collapse at resolution is sufficient." Reviews of petition-family code check this line item.
**Links:** Workstream A (A2, A3); F-5.

## F-8 — Continuity is tiered live-standby, not just cold backup

**Status:** Committed (Tiers 1–2 beta; Tier 3 post-beta).
**Decision:** Every entity with a home node (collective, project, coalition) is in exactly one of three per-entity node-states on every node — home-no-backup (zero machinery), home-with-backup (outbound structural replication + failover rules), backup-for-others (an inert replica walled off from all local logic) — and failover is per-entity, so complexity is proportional to opt-in.
**Context:** §5b's cold-refuge sketch matured into live standby: a backup that automatically covers a downed primary (Tier 1 read-only immediately; Tier 2 write-takeover after the F-9 lease window) and cedes back safely. Each entity designates its backup through its NATIVE governance form (group petition; project-internal petition; coalition one-petition-per-member-group). A coalition backup replicates the coalition's home-node state only — never its member groups' data (they have their own homes and their own backup decisions).
**Consequences:** The designation carries the failover window W and an **advance directive** (`reconstitute` | `none`) — the entity's pre-consent to post-disaster re-homing, collected at the only moment its own machinery can legitimately decide it (afterwards, the machinery *was* the home). Tier-2 is a **coordination annex** (ratified narrowing): a signed append-only log with a registered two-verb vocabulary; petitions freeze on both sides; "actable for discussion," stated on the banner. A backed-up entity's replica members are shadow-relative to the backup node (zero weight, D-5). Tier 3 — two-live-writer partition merge, and the old member-quorum disaster activation — is post-beta, named here, not built. Dependencies named: the D-8 key escrow is what the directive's execution, Tier-2 verified actors, and reconstitution stand on. Operational note: every deploy/restart causes a seconds-long read-only blip for backed-up entities until quiet-boot verification round-trips — fail-safe, intended. If project/coalition designation entrances ship later than groups, this entry records them as OWED, the coalition entrance due before cross-node coalitions are promoted as a beta feature.
**Links:** F-6; F-9; F-10; D-5; D-10; D-8.

## F-9 — "Cede back" is safe because write authority is a lease and the returning primary does not trust its own database

**Status:** Committed.
**Decision:** Write authority over a backed-up entity is a lease held by staying federation-visible. A primary that finds itself federation-isolated ≥ W self-demotes to read-only by its own clock; the backup activates only after a signed challenge has run the same W with zero proof-of-life — so two simultaneous writers are unreachable **by construction**, not by judgment.
**Context:** Down-vs-unreachable is undecidable from inside one node, so the design stops trying to prove death (unprovable) and gives the primary a bounded chance to prove life (trivially provable: a signed heartbeat, relayable by anyone; ONE witness of life blocks activation — witnesses can only delay, never cause, activation, so a lying peer forces Tier-1, never split-brain).
**Consequences:** Unreachability → Tier-1 read-only immediately. A member's one-click "I can't reach my home node" starts the challenge and can never skip it. Graceful signed handoff and a backup-steward expedite petition are accelerators, never gates (establishment consent is not re-charged at activation). **Quiet-boot:** a returning primary verifies against signed takeover events before serving any backed-up entity; until verified it serves read-only and the petition resolver — the one writer with no human present — is held by the same authority check as user actions. The catch-up packet flows from the node that stayed present to the one that was absent. Honest residuals: worst-case automatic activation waits W in read-only (bounded, predictable); a malicious primary refusing to self-demote can already corrupt its own entities arbitrarily (F-1's territory, not this protocol's); asymmetric partition can produce a contested activation — mitigated by witness relays, W-long retry, cede-on-contact, and the log-only annex making a wrong activation replay losslessly; the resolver-gate's completeness is convention until the hardening caller-scan test lands.
**Links:** F-8; F-1; D-6.

## F-10 — Backup consent derives from registration mode; the cap is a per-entity size gate that escalates, never refuses

**Status:** Committed.
**Decision:** Whether a node consents to hosting another community's backup derives from its `registrationMode` — no separate consent knob. `open` → accepted by default (registration already said "anyone may put data here"; charging consent twice violates F-2); the community may petition a per-entity member threshold, over which a request auto-converts into the steward consent petition — consent scaled to the impact of a single arrival, never a flat rejection, never an operator knob. `invite_only` → standing policy bit (accept / approve-each / refuse) or per-request steward petition. Stewardless nodes fail closed past the threshold or when gated.
**Context:** Federation is the channel; mode-derived consent is the permission. Aggregate hosted load is deliberately unbounded on open nodes (matching the web form's promise); the threshold incidentally bounds the D-5 arrival mass of any single future reconstitution.
**Consequences:** `memberCount` is home-asserted — the threshold gates HONEST arrivals (a hostile home understating its count is F-3's territory; the first real snapshot is the backup's chance to notice gross divergence). Legitimate growth past the threshold after establishment is covered by establishment-time consent (F-2: consent once, at the layer that owns it) — not re-gated. The mode must never label a door that doesn't exist: all nodes are `open` until C0 ships actual registration gating and flips the creation default in the same commit.
**Links:** F-2; F-3; D-5; C0 (plan Workstream C).

---

## D-1 — Privacy is currently by convention, not by construction

**Status:** Watch (being closed by F-1/F4).
**Decision:** Acknowledge that until Rung 1 ships, member privacy from the operator rests on operator goodwill and code discipline, not on cryptographic guarantee.
**Context:** The server reads everything it renders. Alpha among trusted hosts made this acceptable; open beta among strangers running nodes for real communities does not. A commitment maintained only by convention rots the first time code drifts — which is why F-1's guarantees must be structural, and why this register is in-repo rather than convention-maintained elsewhere.
**Consequences:** F4 (Rung 1) is a beta-entry gate specifically to convert this from convention to construction for content. The residual (metadata, membership) is recorded honestly in D-6.
**Links:** F-1; F4; D-6.

## D-6 — Honest ceilings: never claim more protection than exists

**Status:** Committed.
**Decision:** State exactly what each protection layer does and does not do; never imply anonymity, deletion, or invisibility beyond what the mechanism delivers.
**Context:** False confidence is its own harm — a member who believes they are anonymous behaves differently than one who knows the true boundary. The exact wording of a limitation *is* the commitment.
**Consequences — the boundary sentences that must appear in the UI and the guide, not only here:**
- **On content vs. identity:** *"Commons hides what your community says from the host; it cannot fully hide who your community is from the host."*
- **Membership/graph is not hideable from your own server.** The node authenticates accounts and routes messages, so it must know which accounts receive a collective's traffic — that is the roster, even with every payload opaque. Signal/Matrix/MLS share this. Hiding membership itself is research-grade and out of scope; never implied.
- **Pseudonymity erodes under small-community correlation.** An account with an attached email is not pseudonymous to the host: email is a far stronger re-labeling key than traffic timing. Attaching email is a per-person choice with a per-person cost, stated where it is made. With names encrypted the host holds an unlabeled graph, but IPs, timing, group sizes, and meeting rhythms let a host who knows the community socially partially re-label it without breaking any crypto.
- **The host serves the JavaScript that holds the keys.** Web-delivered E2EE defends against a *curious* operator (DB reads, backups, subpoenas), not a *malicious* one shipping a poisoned client. Closing that gap needs signed/reproducible builds or native clients (post-beta); never implied meanwhile.
- **Rung/custody must be stated in-product.** The UI says which rung is active and what it does *not* protect against; at beta, keys are node-custodied (protects against remote nodes and honest-but-curious reads, not against your own malicious host).
**Links:** F-1; D-1; D-2; F4.

## D-2 — Accounts require no real-world identifier (lean into it deliberately)

**Status:** Committed (make it stated policy).
**Decision:** Login requires no real-world identifier: accounts may attach a verified email (login, recovery, opt-in notifications), but a handle-only account is a first-class, permanent option in every registration mode. Anti-flood protection comes from the node's registration mode (`open` + rate limiter, or `invite_only`) — never from mandatory identity: email verification is a weak Sybil defense (disposable domains), and requiring it would filter the vulnerable more effectively than bots.
**Context:** Commons never integrated email. Most platforms leak identity at the front door before encryption matters; Commons does not have to. This is what makes pseudonymous membership (D-6) more than cosmetic.
**Consequences:** State it as policy in docs. Note the operational tradeoffs it implies elsewhere (account recovery and person-targeted notification — e.g. the A-4 concern-subject right-of-reply — need a channel that reaches someone not currently in the app; solve on Commons' terms, not by quietly adding email and inheriting the re-engagement machinery the charter refuses). Verified email is the delivery channel for A-4 person-targeted notification and for self-service password reset; handle-only accounts knowingly forgo both (stated at registration). Attached emails are stored hash-for-login + encrypted-at-rest with the key outside the database — breach protection, honestly framed: it does not hide the address from the live operator (send path + mail logs reconstruct the mapping), and no cipher can, because the server must send to it. D-2's protection was always the *nonexistence* of the linkage; attaching email trades it away per-person, by choice, at the point of attachment. Registration mode is node-constitutional: set at creation, changed only by node-wide petition.
**Links:** D-6; A-4; D-9.

## D-3 — Federation moves data only through a deny-by-default class chokepoint

**Status:** Committed.
**Decision:** All cross-node data movement passes one predicate — `mayFederate(dataClass, agreement)` — that denies by default and structurally excludes the vulnerability class under every agreement.
**Context:** Same architectural move as `canViewConcern`: one predicate, every path, rather than per-call-site checks that drift. Federation without content protection increases exposure (more copies on more servers), so the vulnerability class is excluded from payloads from day one, before any encryption exists.
**Consequences:** A test asserts the vulnerability class can never pass under any agreement. Refuge replication, coalition coordination, and mediated actions all route through it. After Rung 1, ciphertext blobs may federate; plaintext vulnerability classes never. Deny-by-default has exactly one named exception: the `protocol` class tier (federation handshake — pings, agreement proposals and decisions) is the sole category permitted toward a `proposed` peer, because agreements cannot form if the proposal cannot reach a not-yet-active peer (the same bootstrapping care as F-5's fail-closed rule). It carries governance-handshake events only — never content, never coordination — and a test asserts nothing but protocol-class events pass pre-active. Do not widen this tier without amending this entry. **Widened once (F3.5, this amendment):** `continuity_protocol` — takeover challenges, challenge relays, and proofs of life — joins the protocol tier, because liveness must be provable across relationship turbulence (a challenge or a proof-of-life must flow even when agreement state is contested); these events carry zero member data (entity refs, domains, timestamps, signatures only), asserted by the same exhaustive pre-active test. Enforcement is at *enqueue*, upstream of the transport, and the transport is architecturally private to the outbox (asserted by test) — there is no path to the wire that bypasses the chokepoint.
**Links:** plan §4; F0; F4.

## D-4 — Every collective is closed toward every peer node by default; opening is a per-peer petition

**Status:** Committed.
**Decision:** An active agreement grants nothing toward any collective; each *public* collective opens itself toward a *specific* peer node by its own petition-backed visibility grant (`closed` / `visible` / `interactive`). Grant tiers apply to public groups only: private groups cannot hold a `visible`/`interactive` stance and are exposed cross-node only through deliberate shared acts (coalition membership, project co-hosting), with disclosure scoped to that shared entity's membership.
**Context:** The instantiation of F-2 at the collective layer. An agreement adds a peer to every collective's "federated nodes" list and changes nothing else.
**Consequences — including the honest scope that must be enforced in code, not only UI copy:** the grant governs the *federated* layer (discovery in peer listings, inbound requests, presence interaction). It does **not** govern the open web — a public group's page is already readable by anyone including a peer's members, and "closed toward node X" cannot retract that. The stance chokepoint must gate federated-surface serving specifically; public-web serving is a separate, unchanged path. A test should assert a public group set to "closed" toward a peer does not thereby imply its public page is hidden (D-6). Grant proposals for private groups are rejected in validation (`private_group_not_grantable`), which eliminates the "what does `visible` disclose for an encrypted-name group" question: nothing, ever, via grants. Grants suspend when the agreement ends (reversible; soft-archive, not deletion).
**Links:** plan §2b; F-2; D-6.

## D-5 — Re-homing arrival weight (capture control)

**Status:** Open (must be decided before disaster activation ships).
**Decision:** (To be set.) Newly re-homed members' node-wide governance weight must not let a promoting group instantly dominate a smaller refuge node's electorate.
**Context:** Cold refuge replication is inert and safe; *promotion* makes a group live on the refuge, and its members become constituents carrying node-wide weight — a 200-member group activating onto a 30-member node is suddenly ~87% of its electorate (F-6, F-3).
**Consequences:** Leading candidate is arrival-weight phase-in via the existing participation-weighting machinery. Whatever is chosen must be a decided answer, not a discovered one; this entry blocks F-6 disaster activation. **Adjacent open item (named here so it is decided with, not discovered by, the arrival-weight design):** node-wide votes use a LIVE electorate denominator at evaluation time (`getActiveNodeVoterCount`), consistent between appointment and recall but not frozen the way project votes can be — so re-homed members entering the electorate mid-vote would shift quorum on votes already open. The arrival-weight decision must say whether phase-in applies to the denominator as well as the vote weight. **Decided in miniature at F2:** remote members (presence-backed shadow accounts) carry ZERO local governance weight — by design and by mechanism, not by a check: shadow accounts are credential-less (`passwordHash: null`, so no session can ever act as one) and join with dormant participation, keeping them out of voter counts and threshold denominators by construction. The standing answer is *weight is earned locally, never imported* — a future "give remote members a vote" proposal is this design session (D-5) reopened, and must be treated as such, not as a UI toggle. **Failover ≠ promotion (F3.5 amendment):** a backup covering a downed home is temporary standby — annex actors and replica members import NO local weight (log entries are not memberships; replayed join intents land shadow-shaped and dormant), so failover never triggers this entry. **Reconstitution** — activating a replica as a NEW group (F-6) — converts a replica into constituents and IS this entry's question; D-5 gates it specifically and remains the deliberately-open session.
**Links:** F-6; F-3.

## D-7 — No server-side search over encrypted classes at beta

**Status:** Committed (beta scope).
**Decision:** At Rung 1, the server performs no search or content-indexing over encrypted classes; searchability of encrypted content is a client-side / post-beta concern.
**Context:** A server cannot index what it cannot read. Providing "search" by keeping a plaintext shadow index would silently defeat F-1.
**Consequences:** Scope search to plaintext structural metadata at beta, or move it client-side later. Never reintroduce a plaintext index of an encrypted class.
**Links:** F-1; F4.

## D-8 — Rung 2 must not be foreclosed by F0–F5 decisions

**Status:** Open (guard now, build post-beta).
**Decision:** No pre-beta decision may make the blind-server destination unreachable; keep the relocation seams intact.
**Context:** Rung 2 moves decryption and governance computation client-side. That stays possible only if the boundaries are kept movable.
**Consequences:** `IdentityKeyCustody` is a *movable* custody boundary (node-held at beta, client-held later); `decryptForViewer` is the single seam Rung 2 relocates client-side; **no server feature may grow a new dependency on content plaintext after F4** (optional CI guard: reject new plaintext columns for registered classes). Named Rung-2 problems: key backup/recovery, member-removal rotation, guest keys, liveness redesign (client-evaluated resolution), poisoned-client mitigation. Per-group forward secrecy is foreclosed as a default (history-on-join is the system's shape); custody keys must never become password-derived without a recovery design (forgotten password must not mean lost history). **That recovery design now exists (F3.5 key escrow):** the identity key is WRAPPED (not derived) under scrypt(password) + AES-GCM; the home custody copy stays primary, so password reset rewraps and loses nothing while the home lives; the wrapped blob rides backup replicas' cannot-read tier, giving a stranded member client-side-unwrap login at the backup after home death. Honest ceiling: forgot password + dead home = locked out permanently (nothing exists to reset against; human re-admission is the fallback) — stated where escrow login is offered. **Worked example (F2, the guard catching a real thing):** identity-signed claims originally carried no nonce; with deterministic Ed25519 that surfaced as a ledger-uniqueness test failure at Rung 1 — but the real defect was Rung-2-shaped: a nonce-less member signature could be re-enveloped by a malicious home node as a fresh act once keys go client-side. Claims now carry per-claim nonces (single-intent signatures). Any new identity-signed claim shape must carry one.
**Links:** F-1; F4; F6.

## D-9 — Email carries existence, not content

**Status:** Committed.
**Decision:** No notification email may contain member content; bodies and subjects carry the fact of activity plus a link.
**Context:** Email traverses third-party servers in plaintext; content in email would defeat F-1/F4 through a side channel and is the single easiest way to silently break the content-blind-host guarantee.
**Consequences:** fixture test asserts no encrypted-class content in any rendered email; applies to all future channels (push, SMS) identically.
**Links:** F-1; F4; D-6.

## D-10 — Replicas are ciphertext and deltas, in two tiers; the archive asymmetry

**Status:** Committed (Tier A now; Tier B with/after F4).
**Decision:** Backup replication is delta-based (periodic snapshots + deltas — bandwidth tracks activity, not entity size) in two tiers: **Tier A**, the structural manifest — plaintext skeleton only (counts not rosters, family labels not petition content, timing not titles unless public), which the backup operator CAN read and which therefore must never carry content; **Tier B** (with/after F4), the content archive — member-keyed ciphertext blobs the backup stores and cannot read: publications/bulletins, living documents, contribution categories, contribution history, petition bodies/rationales as an inherited read-only record, discussion threads. Escrow-wrapped identity keys (D-8) ride the cannot-read tier from Phase 2.
**Context:** Being someone's backup never means reading them (F-1). The manifest builder is one review-gated function — titles are the leak vector.
**Consequences:** **Structurally excluded from every tier, in any encryption, forever: the vulnerability class** (request content, need-history) — D-3 enforces it at the chokepoint. *The archive that survives a node's death is exactly the archive Commons promises to keep; what dies with the node is exactly what Commons promises not to archive.* Honest ceiling until F4: the backup operator reads the structural manifest, and the home node reads everything (node-custodied keys) — stated in the replica UI.
**Links:** F-1; F-8; D-3; D-8.

---

## Standing items awaiting fold-in (from prior review cycles — distill and place)

These were identified in earlier patch reviews and are recorded here so they are not lost; each should be promoted to a proper entry or folded into an existing one.

- **A-2 / concern history is not a public scorecard** — a concern must never accrete into a durable, visible per-person reputation record; `request_flag` binds no per-person subject row. (The harm-side twin of the "count the gift" tension.)
- **A-4 / concern subject notification & right-of-reply** — the review workflow is now fully actionable (findings can be substantiated, actions proposed) while the subject is never told; person-targeted action must eventually pierce and afford reply. Sharpened, not closed, by making review actionable; needs a delivery channel (see D-2).
- **administrative_closure is effectively universal** — every auto-provisioned reviewer seat carries all four abilities, so the ability check does not currently differentiate; record as a known governance posture (who may unilaterally close a concern), not an accident.
- **request retention is redaction, not deletion** — after the accountability window, request content is redacted but a coarse attributable record (requester id, type, timing) persists; the "contribution kept, vulnerability not archived" asymmetry is real but softer than "no record at all." (Candidate to reconcile against F-1: key-destruction redaction can strengthen this.)
