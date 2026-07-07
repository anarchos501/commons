# Federation

Commons starts as a healthy single-node system and grows toward federation.

The architecture should anticipate portable identities, home nodes, linked node presences, migration, signed events, group portability, and node resilience.

Initial federation modes may include open, allowlisted, project-level, read-only, emergency-only, and disabled.
Commons is federation-first rather than pure P2P-first. P2P features may later support emergency resilience and encrypted handoff, but shared governance, trust approvals, proposal history, and community memory remain node-mediated for accountability.

Load-bearing federation and privacy commitments (mutual consent, the deny-by-default data-class chokepoint, per-peer visibility grants, honest protection ceilings) are recorded with stable IDs in the [design & decision register](register.md); code that enforces an entry references its ID at the enforcement point.
