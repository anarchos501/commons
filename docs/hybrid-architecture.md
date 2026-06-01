# Hybrid Federated Local-First Architecture

Commons uses a split-by-data-class authority model. Community nodes are the first operational authority for shared coordination, while users retain control over personal-only data through local-first storage, encryption, deletion, export, retention choices, and opt-in sync.

## Authority Boundaries

Community nodes are authoritative for shared coordination records: groups, projects, proposals, accepted contribution summaries, scoped trust approvals, responsibilities, governance preferences, action logs, and community memory.

Groups are authoritative for group rules within node constitutional limits: membership policy, thresholds, trust rules, responsibility terms, contribution visibility, retention defaults, and privacy preferences.

Portable identities are authoritative for continuity: DIDs, public signing keys, linked node presences, migration proofs, and export/import continuity metadata.

Devices are authoritative for personal local data: drafts, personal notes, reminders, private availability metadata, unsynced support requests, cached coordination history, and sync queue state.

## User-Controlled Personal Data

If data belongs only to the individual, does not affect shared governance, does not involve another participant, and does not require group accountability, the user should be able to keep it device-local, encrypt it, delete it, export it, block sync or federation, and choose retention behavior.

Examples include personal notes, drafts, local reminders, private availability metadata, unsynced support requests, cached coordination history, and pending sync items.

## Shared And Sensitive Records

Once data affects others or enters shared coordination, Commons prioritizes accountability, consent, auditability, privacy envelopes, constitutional preferences, and retention rules.

Sensitive support data should not be broadly replicated. Raw support details, private coordination threads, guest secrets, local encryption keys, requester vulnerability histories, plugin-accessible copies of sensitive support records, and personal-only local data must not become default federation payloads.

## Local-First Behavior

Offline users may draft support requests, offers, and contribution logs; view cached groups, projects, and responsibility information; and queue submissions for later sync.

Sync should convert local drafts into node records only after user confirmation, privacy-envelope checks, group rules, and constitutional constraints. When a sync conflict occurs, Commons should prefer a review state over silent overwrite. Sensitive records should prefer not syncing over unsafe merge.

## Federation And P2P Boundaries

Commons is federation-first, not pure P2P-first. Federation is for node-to-node community coordination, migration, linked presence, and portable identity continuity. P2P may later support emergency resilience, encrypted handoff, or node-outage continuity among trusted participants.

Governance, trust approvals, proposal history, responsibility assignments, and contribution memory should remain node-mediated for accountability. P2P should not become a way to bypass privacy envelopes, constitutional preferences, retention rules, or plugin constraints.

## Signed Events

Signed events are lightweight architecture preparation for future federation and migration. They are not a blockchain, not a DAO mechanism, not full event sourcing, and not an immutable global ledger.

A signed event captures a subject, actor, payload, payload hash, development signature, public key, and context references. It gives Commons a stable shape for later cryptographic signing without forcing federation into the MVP.
