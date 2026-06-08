export type MemberAffiliationVisibility = "private" | "project" | "public";

type GroupAffiliation = {
  id: string;
  name: string;
  privacyPreferences: unknown;
};

export function getMemberAffiliationVisibility(privacyPreferences: unknown): MemberAffiliationVisibility {
  if (!privacyPreferences || typeof privacyPreferences !== "object" || Array.isArray(privacyPreferences)) {
    return "private";
  }

  const value = (privacyPreferences as Record<string, unknown>).memberAffiliationVisibility;
  return value === "project" || value === "public" ? value : "private";
}

export function visibleProjectRosterAffiliations(groups: GroupAffiliation[]) {
  return groups
    .filter((group) => getMemberAffiliationVisibility(group.privacyPreferences) !== "private")
    .map(({ id, name }) => ({ id, name }));
}

export function visibleGroupRosterAffiliations(groups: GroupAffiliation[]) {
  return groups
    .filter((group) => getMemberAffiliationVisibility(group.privacyPreferences) === "public")
    .map(({ id, name }) => ({ id, name }));
}
