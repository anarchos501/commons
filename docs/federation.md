# Federation

Commons starts as a healthy single-node system and grows toward federation.

The architecture should anticipate portable identities, home nodes, linked node presences, migration, signed events, group portability, and node resilience.

Initial federation modes may include open, allowlisted, project-level, read-only, emergency-only, and disabled.
Commons is federation-first rather than pure P2P-first. P2P features may later support emergency resilience and encrypted handoff, but shared governance, trust approvals, proposal history, and community memory remain node-mediated for accountability.

Load-bearing federation and privacy commitments (mutual consent, the deny-by-default data-class chokepoint, per-peer visibility grants, honest protection ceilings) are recorded with stable IDs in the [design & decision register](register.md); code that enforces an entry references its ID at the enforcement point.

## Continuity backups (F3.5)

A collective, project, or coalition can designate a federated peer as its backup: a structural
replica (skeleton only until encryption lands) that can hold the community's coordination open in
read-only, then discussion-only, form if the home node goes dark. Groups and projects decide by
their own petition; **a coalition's designation is decided by every member collective, on every
node, through its own governance** — and any single member collective's withdrawal revokes it.

**Designate early, in calm weather.** Because designation needs every member node's consent, a
coalition can only arrange its disaster protection while all its member nodes are healthy — a
proposal with an unreachable member times out. The moment to arrange protection is before you need
it; that is the same logic as the advance directive the designation carries.
