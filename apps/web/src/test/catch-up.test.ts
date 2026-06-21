import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { hasCatchUpSince, getCatchUpDigest, summarizeGroupSinceLastSeen } from "../lib/catch-up";

// DB round-trip tests for catch-up-on-return. Pins the three invariants: counts since a watermark,
// null-watermark → no catch-up, and concern lines respect the reviewer entitlement (+ proxy parity).

const prisma = createPrismaClient();
const P = "cu_test";
const DAY = 24 * 60 * 60 * 1000;

async function cleanup() {
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: P } } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: P } } });
  await prisma.report.deleteMany({ where: { groupId: { startsWith: P } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: P } } });
  await prisma.bulletin.deleteMany({ where: { spaceId: { startsWith: P } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: P } } });
}

test("catch-up: counts since watermark, null-watermark suppression, concern audience scoping + proxy parity", async () => {
  await cleanup();
  try {
    const watermark = new Date(Date.now() - 10 * DAY); // "you last looked 10 days ago"
    const old = new Date(Date.now() - 30 * DAY); // pre-existing, before the watermark

    await prisma.node.create({ data: { id: `${P}_node`, name: P, domain: `${P}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
    const mk = (suffix: string) =>
      prisma.account.create({ data: { id: `${P}_${suffix}`, homeNodeId: `${P}_node`, displayName: suffix, accountType: "member", profileVisibility: "private" } });
    const [member, reviewer, joiner, newbie] = await Promise.all([mk("member"), mk("reviewer"), mk("joiner"), mk("newbie")]);

    // Group A: member + reviewer both visited 10d ago; Group B: newbie never visited (null watermark).
    await prisma.group.create({ data: { id: `${P}_gA`, nodeId: `${P}_node`, name: "Group A", membershipPolicy: "open" } });
    await prisma.group.create({ data: { id: `${P}_gB`, nodeId: `${P}_node`, name: "Group B", membershipPolicy: "open" } });

    const reviewerMembership = await prisma.groupMembership.create({
      data: { accountId: reviewer.id, groupId: `${P}_gA`, status: "active", joinedAt: old, lastSeenAt: watermark },
    });
    await prisma.groupMembership.createMany({
      data: [
        { accountId: member.id, groupId: `${P}_gA`, status: "active", joinedAt: old, lastSeenAt: watermark },
        { accountId: newbie.id, groupId: `${P}_gB`, status: "active", joinedAt: old, lastSeenAt: null }, // never visited
        { accountId: joiner.id, groupId: `${P}_gA`, status: "active", joinedAt: new Date() }, // a NEW member, after the watermark
      ],
    });

    // Reviewer seat in Group A (the concern-visibility entitlement).
    const resp = await prisma.responsibility.create({ data: { id: `${P}_resp`, groupId: `${P}_gA`, type: "reviewer" } });
    await prisma.responsibilityAssignment.create({
      data: { responsibilityId: resp.id, membershipId: reviewerMembership.id, expiresAt: new Date(Date.now() + 365 * DAY) },
    });

    // Activity in Group A AFTER the watermark: a resolved petition, a bulletin, a concern.
    await prisma.petition.create({
      data: {
        id: `${P}_pet`, groupId: `${P}_gA`, scopeType: "group", scopeId: `${P}_gA`, category: "test",
        subjectType: "test", subjectId: "x", governanceSnapshot: {}, closesAt: new Date(), status: "approved", resolvedAt: new Date(),
      },
    });
    await prisma.bulletin.create({ data: { id: `${P}_bul`, spaceType: "group", spaceId: `${P}_gA`, authorId: member.id, title: "T", body: "B" } });
    await prisma.report.create({ data: { id: `${P}_rep`, groupId: `${P}_gA`, subject: "S", description: "D" } });
    // Activity in Group B too — to prove a null watermark suppresses catch-up even when things changed.
    await prisma.bulletin.create({ data: { id: `${P}_bulB`, spaceType: "group", spaceId: `${P}_gB`, authorId: newbie.id, title: "T", body: "B" } });

    // — member (non-reviewer) digest —
    const memberDigest = await getCatchUpDigest(prisma, member.id);
    assert.equal(memberDigest.length, 1, "only Group A (B has a null watermark)");
    const gA = memberDigest[0];
    assert.equal(gA.groupId, `${P}_gA`);
    assert.equal(gA.resolvedPetitions, 1);
    assert.equal(gA.newPosts, 1, "one bulletin");
    assert.equal(gA.newMembers, 1, "only the new joiner (pre-existing joined before the watermark)");
    assert.equal(gA.newConcerns, null, "a non-reviewer never sees a concern line");
    assert.ok(gA.total >= 3);

    // — reviewer digest: same group, but the concern line is visible —
    const reviewerDigest = await getCatchUpDigest(prisma, reviewer.id);
    assert.equal(reviewerDigest.length, 1);
    assert.equal(reviewerDigest[0].newConcerns, 1, "a reviewer sees the concern count");

    // — null-watermark suppression: newbie's only group (B) has activity but was never visited —
    assert.equal(await hasCatchUpSince(prisma, newbie.id), false, "null watermark → no catch-up");
    assert.deepEqual(await getCatchUpDigest(prisma, newbie.id), []);

    // — proxy parity: the cheap proxy agrees with the digest's non-emptiness —
    assert.equal(await hasCatchUpSince(prisma, member.id), memberDigest.length > 0);
    assert.equal(await hasCatchUpSince(prisma, reviewer.id), reviewerDigest.length > 0);

    // — per-group helper honours the canSeeConcerns gate directly —
    const seen = await summarizeGroupSinceLastSeen(prisma, { accountId: member.id, groupId: `${P}_gA`, groupName: "Group A", since: watermark, canSeeConcerns: true });
    assert.equal(seen.newConcerns, 1);
    const unseen = await summarizeGroupSinceLastSeen(prisma, { accountId: member.id, groupId: `${P}_gA`, groupName: "Group A", since: watermark, canSeeConcerns: false });
    assert.equal(unseen.newConcerns, null);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
});
