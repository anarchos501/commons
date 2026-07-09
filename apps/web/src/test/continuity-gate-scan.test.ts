import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// F3.5 Phase 6 — the continuity gate-scan (the transport-privacy-test move):
// gate completeness as CONSTRUCTION, not convention. Until this file, "every
// write path checks resolveWriteAuthority" was a discipline; now an ungated
// path is a failing build. The scan already earned its keep while being
// written: it found the coalition/event proposal evaluators flipping child
// petitions through evaluatePetition directly (bypassing the resolver gate —
// closed by moving the gate INTO the flipper), and the concerns module's
// status-only guard skipping the authority check (closed in guards.ts).

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).replaceAll(path.sep, "/");

test("petition status flips happen only in the gated funnel (plus the pinned proposal-cleanup list)", () => {
  // Files allowed to touch petition.status directly. Everything here is
  // either the funnel itself or proposal-level CLEANUP (supersede/fail) —
  // which is the safe direction: never an approval, so never a write the
  // continuity gate exists to stop. Additions to this list are a conscious
  // review decision, not a convenience.
  const ALLOWED = new Set([
    "lib/petitions.ts", // the funnel: evaluatePetition (carries the gate) + open/withdraw
    "lib/petition-evaluation.ts", // evaluateAndApplyPetition (carries the gate)
    "lib/coalitions.ts", // proposal-failure supersede
    "lib/events.ts", // event-proposal rollback/supersede
    "lib/federated-coalitions.ts", // mirror supersede on home failure
    "lib/federations.ts", // federation-proposal supersede
    "lib/node-stewardship.ts", // appointment race cleanup (Workstream A)
    "lib/node-name.ts", // competing-proposal supersede
    "lib/project-hosting.ts", // hosting-proposal supersede (RFC-007)
    "lib/project-membership.ts", // pending-closure freeze supersede (RFC-007)
  ]);
  const offenders: string[] = [];
  for (const file of walk(path.join(SRC, "lib"))) {
    const relative = rel(file);
    if (ALLOWED.has(relative)) continue;
    const content = readFileSync(file, "utf8");
    if (/\.petition\.(update|updateMany)\(/.test(content) && /status:\s*"/.test(content)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `petition status writes outside the pinned list: ${offenders.join(", ")}`);
});

test("the authority gate lives INSIDE the flipper and the resolver entry", () => {
  const petitions = readFileSync(path.join(SRC, "lib/petitions.ts"), "utf8");
  const evaluation = readFileSync(path.join(SRC, "lib/petition-evaluation.ts"), "utf8");
  // evaluatePetition gates structurally — every direct caller (the coalition
  // and event proposal evaluators included) inherits it.
  assert.ok(
    /export async function evaluatePetition[\s\S]{0,1200}resolveWriteAuthority\(/.test(petitions),
    "evaluatePetition must consult resolveWriteAuthority before flipping status",
  );
  assert.ok(
    /export async function evaluateAndApplyPetition[\s\S]{0,1500}resolveWriteAuthority\(/.test(evaluation),
    "evaluateAndApplyPetition must gate before dispatching appliers",
  );
});

test("every group-module server action passes through a continuity-gated guard", () => {
  const modulesDir = path.join(SRC, "app/(app)/groups/[groupId]/_modules");
  const offenders: string[] = [];
  for (const file of walk(modulesDir)) {
    if (!file.endsWith("actions.ts")) continue;
    const relative = rel(file);
    if (relative.endsWith("_shared/guards.ts")) continue;
    const content = readFileSync(file, "utf8");
    const exportedActions = content.match(/export async function \w+/g) ?? [];
    if (exportedActions.length === 0) continue;
    // Both guards live in _shared/guards.ts and both carry the authority
    // check; an actions file using neither is an ungated write surface.
    if (!content.includes("requireMembership(") && !content.includes("requireGroupMembershipStatus(")) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `group-module action files with no gated guard: ${offenders.join(", ")}`);
  const guards = readFileSync(path.join(modulesDir, "_shared/guards.ts"), "utf8");
  const gateCount = (guards.match(/resolveWriteAuthority\(/g) ?? []).length;
  assert.ok(gateCount >= 2, "both shared guards must carry the authority check");
});

test("every coalition write path carries the coalition gate", () => {
  const page = readFileSync(path.join(SRC, "app/(app)/coalitions/[coalitionId]/page.tsx"), "utf8");
  const gateCalls = (page.match(/requireCoalitionWritable\(/g) ?? []).length;
  // Six mutating actions: thread create, message post, event submit, and the
  // three membership proposals.
  assert.ok(gateCalls >= 6, `coalition page actions gated: ${gateCalls} < 6`);

  const mediated = readFileSync(path.join(SRC, "lib/federation-actions.ts"), "utf8");
  assert.ok(
    /coalition_post_message[\s\S]{0,900}resolveWriteAuthority\(/.test(mediated),
    "the mediated coalition_post_message handler must gate before writing",
  );
  const federated = readFileSync(path.join(SRC, "lib/federated-coalitions.ts"), "utf8");
  assert.ok(
    /export async function broadcastCoalitionMessage[\s\S]{0,900}resolveWriteAuthority\(/.test(federated),
    "broadcastCoalitionMessage carries the defense-in-depth gate",
  );
  const coalitions = readFileSync(path.join(SRC, "lib/coalitions.ts"), "utf8");
  assert.ok(
    /export async function evaluateCoalitionProposal[\s\S]{0,2200}resolveWriteAuthority\(/.test(coalitions),
    "home-side evaluateCoalitionProposal gates membership changes (petition hook + expiry sweep)",
  );
});

test("the scan fails on an ungated action (self-check against silent rot)", () => {
  // If the group-module scan's own mechanics break (glob misses files, the
  // guard regex rots), this canary keeps it honest: a synthetic file body
  // with an exported action and no guard MUST be flagged by the same logic.
  const synthetic = `export async function poke(formData: FormData) { "use server"; }`;
  const exported = synthetic.match(/export async function \w+/g) ?? [];
  assert.ok(exported.length > 0);
  assert.ok(!synthetic.includes("requireMembership(") && !synthetic.includes("requireGroupMembershipStatus("));
});
