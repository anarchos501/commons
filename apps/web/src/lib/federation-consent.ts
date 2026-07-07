// The cross-node consent protocol, pure logic only (no tables): a shared
// proposal id, a decisions map { domain → pending|approved|rejected },
// monotonic updates, unanimity combine. federations.ts runs this over
// FederationProposal rows; F3's cross-node coalitions reuse it over theirs.
//
// Convergence argument (plan "consent sync" decision): decisions are
// monotonic — pending → terminal, never back — and updates are idempotent by
// (proposalId, domain), so redelivered or reordered decision events cannot
// change an outcome; each node applies independently once it has seen
// unanimity, and a late approval after a local terminal state is ignored.

export type FederationDecisionOutcome = "approved" | "rejected";
export type FederationDecisionState = "pending" | FederationDecisionOutcome;
export type FederationDecisionsMap = Record<string, FederationDecisionState>;

export function initialDecisions(domains: string[]): FederationDecisionsMap {
  return Object.fromEntries(domains.map((domain) => [domain, "pending" as const]));
}

export function parseDecisions(value: unknown): FederationDecisionsMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const decisions: FederationDecisionsMap = {};
  for (const [domain, state] of Object.entries(value)) {
    if (state === "pending" || state === "approved" || state === "rejected") {
      decisions[domain] = state;
    }
  }
  return decisions;
}

// Monotonic merge: only a pending slot can change, and only for a domain the
// snapshot already knows. Returns null when nothing changed — the idempotency
// signal for redelivered decision events.
export function applyDecision(
  decisions: FederationDecisionsMap,
  domain: string,
  outcome: FederationDecisionOutcome,
): FederationDecisionsMap | null {
  if (decisions[domain] !== "pending") return null;
  return { ...decisions, [domain]: outcome };
}

export type CombinedConsent = "approved" | "rejected" | "pending";

// Unanimity gate over the participant snapshot: any rejection fails the
// proposal immediately; approval requires every participant. A domain missing
// from the map counts as pending, never as consent.
export function combineDecisions(decisions: FederationDecisionsMap, domains: string[]): CombinedConsent {
  let pending = false;
  for (const domain of domains) {
    const state = decisions[domain] ?? "pending";
    if (state === "rejected") return "rejected";
    if (state === "pending") pending = true;
  }
  return pending ? "pending" : "approved";
}
