import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { getDerivedNotifications, getNotificationPreferences, markCategoryRead, type NotificationPrefs } from "../lib/notifications";

const prisma = createPrismaClient();

test.after(async () => {
  for (const p of ["ntf_pet", "ntf_app", "ntf_exp", "ntf_recall", "ntf_window", "ntf_upd", "ntf_safety", "ntf_pref"]) await cleanup(p);
  await prisma.$disconnect();
});

const OLD = new Date("2020-01-01T00:00:00.000Z");
function prefs(overrides: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return {
    enableRequests: true, enablePetitions: true, enableOutcomes: true, enableSafety: true, enableUpdates: true,
    rollUpUpdates: true, mutedSpaces: {},
    outcomesSeenAt: OLD, safetySeenAt: OLD, updatesSeenAt: OLD, aboutYouSeenAt: OLD,
    ...overrides,
  };
}

test("petition outcome reaches a supporter, not a non-participant", async () => {
  const f = await base("ntf_pet");
  try {
    const petition = await prisma.petition.create({
      data: {
        id: "ntf_pet_petition", groupId: f.groupId, scopeType: "group", scopeId: f.groupId,
        category: "membership", subjectType: "membership_sponsorship", subjectId: "x",
        status: "approved", governanceSnapshot: {}, closesAt: new Date(), resolvedAt: new Date(),
      },
    });
    await prisma.petitionSupport.create({ data: { petitionId: petition.id, membershipId: f.aliceMembershipId } });

    const alice = await getDerivedNotifications(prisma, f.aliceId, prefs());
    assert.ok(alice.items.some((n) => n.id === `petition-outcome:${petition.id}`), "supporter should get the outcome");
    assert.equal(alice.counts.outcomes >= 1, true);

    const bob = await getDerivedNotifications(prisma, f.bobId, prefs());
    assert.ok(!bob.items.some((n) => n.id === `petition-outcome:${petition.id}`), "non-participant should not");

    // Watermark: marking outcomes read (watermark in the future) hides it.
    const read = await getDerivedNotifications(prisma, f.aliceId, prefs({ outcomesSeenAt: new Date(Date.now() + 60_000) }));
    assert.ok(!read.items.some((n) => n.id === `petition-outcome:${petition.id}`), "after mark-read it clears");

    // Disabling Outcomes skips the source entirely.
    const off = await getDerivedNotifications(prisma, f.aliceId, prefs({ enableOutcomes: false }));
    assert.ok(!off.items.some((n) => n.category === "outcomes"));
  } finally {
    await cleanup("ntf_pet");
  }
});

test("application approval and decline surface as outcomes", async () => {
  const f = await base("ntf_app");
  try {
    // A second group where bob's application was approved (decidedAt set).
    const g2 = await prisma.group.create({ data: { id: "ntf_app_g2", nodeId: f.nodeId, name: "G2", membershipPolicy: "request_required" } });
    await prisma.groupMembership.create({ data: { id: "ntf_app_bob_g2", accountId: f.bobId, groupId: g2.id, status: "active", decidedAt: new Date() } });
    const declined = await prisma.group.create({ data: { id: "ntf_app_g3", nodeId: f.nodeId, name: "G3", membershipPolicy: "request_required" } });
    await prisma.groupMembership.create({ data: { id: "ntf_app_bob_g3", accountId: f.bobId, groupId: declined.id, status: "inactive", decidedAt: new Date() } });

    const bob = await getDerivedNotifications(prisma, f.bobId, prefs());
    assert.ok(bob.items.some((n) => n.id === "group-app:ntf_app_bob_g2" && n.title.includes("now a member")), "approval");
    assert.ok(bob.items.some((n) => n.id === "group-app:ntf_app_bob_g3" && n.title.includes("wasn't approved")), "decline");
  } finally {
    await cleanup("ntf_app");
  }
});

test("responsibility expiry reads as a neutral Outcome (not About-you)", async () => {
  const f = await base("ntf_exp");
  try {
    const r = await prisma.responsibility.create({ data: { id: "ntf_exp_r", groupId: f.groupId, type: "gardener" } });
    const a = await prisma.responsibilityAssignment.create({
      data: { id: "ntf_exp_a", responsibilityId: r.id, membershipId: f.aliceMembershipId, expiresAt: new Date(Date.now() - 1000), endedAt: new Date(), endReason: "expired" },
    });
    const res = await getDerivedNotifications(prisma, f.aliceId, prefs());
    const item = res.items.find((n) => n.id === `resp-expiry:${a.id}`);
    assert.ok(item, "expiry present");
    assert.equal(item!.category, "outcomes");
    assert.match(item!.title, /term as gardener has ended/);
  } finally {
    await cleanup("ntf_exp");
  }
});

test("recall is About-you, non-muteable, and worded as an active removal", async () => {
  const f = await base("ntf_recall");
  try {
    const r = await prisma.responsibility.create({ data: { id: "ntf_recall_r", groupId: f.groupId, type: "treasurer" } });
    const a = await prisma.responsibilityAssignment.create({
      data: { id: "ntf_recall_a", responsibilityId: r.id, membershipId: f.aliceMembershipId, expiresAt: new Date(Date.now() + 86_400_000), endedAt: new Date(), endReason: "recall" },
    });
    // Everything muted/disabled — About-you must still pierce through.
    const res = await getDerivedNotifications(prisma, f.aliceId, prefs({
      enableRequests: false, enablePetitions: false, enableOutcomes: false, enableSafety: false, enableUpdates: false,
      mutedSpaces: { group: [f.groupId] },
    }));
    const item = res.items.find((n) => n.id === `recall:${a.id}`);
    assert.ok(item, "recall present even with everything off");
    assert.equal(item!.category, "aboutYou");
    assert.match(item!.title, /by recall/);
  } finally {
    await cleanup("ntf_recall");
  }
});

test("an open recall petition targeting you appears in About-you (right-of-reply)", async () => {
  const f = await base("ntf_window");
  try {
    const r = await prisma.responsibility.create({ data: { id: "ntf_window_r", groupId: f.groupId, type: "steward" } });
    const a = await prisma.responsibilityAssignment.create({
      data: { id: "ntf_window_a", responsibilityId: r.id, membershipId: f.aliceMembershipId, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await prisma.petition.create({
      data: {
        id: "ntf_window_p", groupId: f.groupId, scopeType: "group", scopeId: f.groupId,
        category: "responsibility", subjectType: "responsibility_recall", subjectId: a.id,
        status: "open", governanceSnapshot: {}, closesAt: new Date(Date.now() + 86_400_000),
      },
    });
    const res = await getDerivedNotifications(prisma, f.aliceId, prefs());
    const item = res.items.find((n) => n.id === "recall-open:ntf_window_p");
    assert.ok(item, "open recall petition surfaces");
    assert.equal(item!.category, "aboutYou");
    assert.match(item!.title, /petition to recall you/);
  } finally {
    await cleanup("ntf_window");
  }
});

test("space updates roll up and are silenced by a muted space", async () => {
  const f = await base("ntf_upd");
  try {
    for (let i = 0; i < 3; i++) {
      await prisma.bulletin.create({ data: { id: `ntf_upd_b${i}`, spaceType: "group", spaceId: f.groupId, authorId: f.bobId, title: `B${i}`, body: "x" } });
    }
    const rolled = await getDerivedNotifications(prisma, f.aliceId, prefs());
    const card = rolled.items.find((n) => n.id === `bulletins:group:${f.groupId}`);
    assert.ok(card, "rolled-up updates card present");
    assert.match(card!.title, /3 new bulletins/);

    const muted = await getDerivedNotifications(prisma, f.aliceId, prefs({ mutedSpaces: { group: [f.groupId] } }));
    assert.ok(!muted.items.some((n) => n.category === "updates"), "muted space produces no updates");
  } finally {
    await cleanup("ntf_upd");
  }
});

test("emergencies are Safety notifications and are muteable", async () => {
  const f = await base("ntf_safety");
  try {
    await prisma.emergencyPeriod.create({ data: { id: "ntf_safety_e", groupId: f.groupId, expiresAt: new Date(Date.now() + 86_400_000) } });
    const on = await getDerivedNotifications(prisma, f.aliceId, prefs());
    assert.ok(on.items.some((n) => n.category === "safety"), "safety present");
    const off = await getDerivedNotifications(prisma, f.aliceId, prefs({ enableSafety: false }));
    assert.ok(!off.items.some((n) => n.category === "safety"), "safety muteable");
  } finally {
    await cleanup("ntf_safety");
  }
});

test("preferences persist and markCategoryRead advances the watermark", async () => {
  const f = await base("ntf_pref");
  try {
    const created = await getNotificationPreferences(prisma, f.aliceId);
    assert.ok(created.outcomesSeenAt, "clean-slate: watermark created at first read");
    const before = created.aboutYouSeenAt!.getTime();
    await markCategoryRead(prisma, f.aliceId, "aboutYou");
    const after = await getNotificationPreferences(prisma, f.aliceId);
    assert.ok(after.aboutYouSeenAt!.getTime() >= before, "mark-read advances watermark");
  } finally {
    await cleanup("ntf_pref");
  }
});

async function base(prefix: string) {
  await cleanup(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: prefix, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const alice = await prisma.account.create({ data: { id: `${prefix}_alice`, homeNodeId: node.id, displayName: "Alice", accountType: "member", profileVisibility: "private" } });
  const bob = await prisma.account.create({ data: { id: `${prefix}_bob`, homeNodeId: node.id, displayName: "Bob", accountType: "member", profileVisibility: "private" } });
  const aliceM = await prisma.groupMembership.create({ data: { id: `${prefix}_aliceM`, accountId: alice.id, groupId: group.id, status: "active", participationStatus: "active" } });
  await prisma.groupMembership.create({ data: { id: `${prefix}_bobM`, accountId: bob.id, groupId: group.id, status: "active", participationStatus: "active" } });
  return { nodeId: node.id, groupId: group.id, aliceId: alice.id, bobId: bob.id, aliceMembershipId: aliceM.id };
}

async function cleanup(prefix: string) {
  await prisma.notificationPreference.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.petitionSupport.deleteMany({ where: { petitionId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.responsibility.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.bulletin.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.emergencyPeriod.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { accountId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
