import assert from "node:assert/strict";
import test from "node:test";
import { PROPOSAL_FAMILIES } from "../lib/governance-proposal-families";
import { KNOWN_GENERIC_FAMILIES, PETITION_DETAILED_FAMILIES } from "../lib/petition-evaluation";

// getPetitionDetail silently degrades unhandled families to an empty Details panel, which
// users report as a bug ("this petition has no details"). This test converts that silent
// degradation into a loud omission: every ProposalFamily must either have a detail builder
// or be consciously designated generic — never neither, never both.

test("every proposal family has a detail builder or a conscious generic designation", () => {
  const detailed = new Set(PETITION_DETAILED_FAMILIES);
  for (const family of PROPOSAL_FAMILIES) {
    const inDetailed = detailed.has(family);
    const inGeneric = KNOWN_GENERIC_FAMILIES.has(family);
    assert.ok(
      inDetailed || inGeneric,
      `ProposalFamily "${family}" has neither a petition-detail builder nor an entry in ` +
        `KNOWN_GENERIC_FAMILIES — its petitions would render an empty Details panel. ` +
        `Add a builder to PETITION_DETAIL_BUILDERS or consciously designate it generic.`,
    );
    assert.ok(
      !(inDetailed && inGeneric),
      `ProposalFamily "${family}" is both in PETITION_DETAIL_BUILDERS and KNOWN_GENERIC_FAMILIES — pick one.`,
    );
  }
});

test("KNOWN_GENERIC_FAMILIES and PETITION_DETAILED_FAMILIES contain only real families", () => {
  const all = new Set<string>(PROPOSAL_FAMILIES);
  for (const family of KNOWN_GENERIC_FAMILIES) {
    assert.ok(all.has(family), `KNOWN_GENERIC_FAMILIES entry "${family}" is not a ProposalFamily`);
  }
  for (const family of PETITION_DETAILED_FAMILIES) {
    assert.ok(all.has(family), `PETITION_DETAIL_BUILDERS key "${family}" is not a ProposalFamily`);
  }
});
