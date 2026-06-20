import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  getUiDisclosurePreference,
  setUiDisclosurePreference,
  setModuleOverride,
  resolveEffectiveVisibility,
  type UiDisclosurePrefs,
} from "../lib/ui-disclosure";

const prisma = createPrismaClient();

test.after(async () => {
  await cleanup("uid_");
  await prisma.$disconnect();
});

const NONE: UiDisclosurePrefs = { revealAll: false, overrides: {} };
const FG = new Set(["governance", "discussion"] as const);

test("resolveEffectiveVisibility: foreground default, ?section beats hide, override precedence, revealAll", () => {
  const G = "g1";
  // foreground default
  assert.equal(resolveEffectiveVisibility("governance", G, FG, NONE), "show");
  assert.equal(resolveEffectiveVisibility("projects", G, FG, NONE), "hide");

  // ?section deep-link presents transiently, even over a stored hide
  const hidden: UiDisclosurePrefs = { revealAll: false, overrides: { g1: { projects: "hide" } } };
  assert.equal(resolveEffectiveVisibility("projects", G, FG, hidden), "hide");
  assert.equal(resolveEffectiveVisibility("projects", G, FG, hidden, "projects"), "show");

  // group override > global override
  const both: UiDisclosurePrefs = { revealAll: false, overrides: { global: { governance: "hide" }, g1: { governance: "show" } } };
  assert.equal(resolveEffectiveVisibility("governance", G, new Set(), both), "show");
  // global override applies when no group-scoped one
  const globalOnly: UiDisclosurePrefs = { revealAll: false, overrides: { global: { governance: "hide" } } };
  assert.equal(resolveEffectiveVisibility("governance", G, FG, globalOnly), "hide");

  // revealAll shows non-overridden; an explicit hide still wins over revealAll
  const reveal: UiDisclosurePrefs = { revealAll: true, overrides: { g1: { projects: "hide" } } };
  assert.equal(resolveEffectiveVisibility("trusted-providers", G, new Set(), reveal), "show");
  assert.equal(resolveEffectiveVisibility("projects", G, new Set(), reveal), "hide");
});

test("get/set/override persist and round-trip", async () => {
  const accountId = await makeAccount("uid_rt");
  try {
    assert.deepEqual(await getUiDisclosurePreference(prisma, accountId), { revealAll: false, overrides: {} });

    await setUiDisclosurePreference(prisma, accountId, { revealAll: true });
    let got = await getUiDisclosurePreference(prisma, accountId);
    assert.equal(got.revealAll, true);

    await setModuleOverride(prisma, accountId, "grp1", "projects", "hide");
    await setModuleOverride(prisma, accountId, "global", "library", "show");
    got = await getUiDisclosurePreference(prisma, accountId);
    assert.equal(got.overrides.grp1?.projects, "hide");
    assert.equal(got.overrides.global?.library, "show");

    // clearing an override removes it (and prunes empty scope)
    await setModuleOverride(prisma, accountId, "grp1", "projects", null);
    got = await getUiDisclosurePreference(prisma, accountId);
    assert.equal(got.overrides.grp1, undefined);

    // junk keys/values are sanitized out
    await setUiDisclosurePreference(prisma, accountId, { overrides: { grp1: { projects: "show", notAModule: "show", governance: "bogus" } } });
    got = await getUiDisclosurePreference(prisma, accountId);
    assert.deepEqual(got.overrides.grp1, { projects: "show" });
  } finally {
    await cleanup("uid_rt");
  }
});

async function makeAccount(prefix: string): Promise<string> {
  await cleanup(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: prefix, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const acct = await prisma.account.create({ data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: "U", accountType: "member", profileVisibility: "private" } });
  return acct.id;
}

async function cleanup(prefix: string) {
  await prisma.uiDisclosurePreference.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
