// Shadow accounts (F2) are the local, member-shaped adapters for REMOTE
// people: credential-less (passwordHash null — no session can ever act as
// one) and portable-identity-backed. Anywhere a raw `status: "active"`
// membership enumeration is used as a proxy for "local people" must exclude
// them explicitly — participation status is NOT the right discriminator,
// because local members who go dormant are still local people (their group
// must not archive under them), while a shadow is remote regardless of
// status. Shadow-account read-path audit findings C1/C2.

// Account-level filter: NOT (credential-less AND identity-backed).
export const NOT_SHADOW_ACCOUNT_FILTER = {
  NOT: { passwordHash: null, portableIdentityId: { not: null } },
} as const;

export function isShadowAccount(account: { passwordHash: string | null; portableIdentityId: string | null }): boolean {
  return account.passwordHash === null && account.portableIdentityId !== null;
}
