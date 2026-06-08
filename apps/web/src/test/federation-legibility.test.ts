import assert from "node:assert/strict";
import test from "node:test";
import {
  getMemberAffiliationVisibility,
  visibleGroupRosterAffiliations,
  visibleProjectRosterAffiliations,
} from "../lib/federation-legibility";

test("member affiliations remain private unless explicitly enabled", () => {
  assert.equal(getMemberAffiliationVisibility(null), "private");
  assert.equal(getMemberAffiliationVisibility({}), "private");
  assert.equal(getMemberAffiliationVisibility({ memberAffiliationVisibility: "group" }), "private");
});

test("project and public affiliation visibility allow project roster disclosure", () => {
  assert.equal(getMemberAffiliationVisibility({ memberAffiliationVisibility: "project" }), "project");
  assert.equal(getMemberAffiliationVisibility({ memberAffiliationVisibility: "public" }), "public");
});

test("project roster affiliations exclude groups without disclosure permission", () => {
  const affiliations = visibleProjectRosterAffiliations([
    { id: "group_private", name: "Private Group", privacyPreferences: null },
    {
      id: "group_project",
      name: "Project Visible Group",
      privacyPreferences: { memberAffiliationVisibility: "project" },
    },
    {
      id: "group_public",
      name: "Public Group",
      privacyPreferences: { memberAffiliationVisibility: "public" },
    },
  ]);

  assert.deepEqual(affiliations, [
    { id: "group_project", name: "Project Visible Group" },
    { id: "group_public", name: "Public Group" },
  ]);
});

test("group roster affiliations require public disclosure, not just project disclosure", () => {
  const affiliations = visibleGroupRosterAffiliations([
    { id: "group_private", name: "Private Group", privacyPreferences: null },
    {
      id: "group_project",
      name: "Project Visible Group",
      privacyPreferences: { memberAffiliationVisibility: "project" },
    },
    {
      id: "group_public",
      name: "Public Group",
      privacyPreferences: { memberAffiliationVisibility: "public" },
    },
  ]);

  assert.deepEqual(affiliations, [{ id: "group_public", name: "Public Group" }]);
});
