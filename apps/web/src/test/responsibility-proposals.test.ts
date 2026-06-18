import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  proposeResponsibility,
  createResponsibilityFromProposal,
  PROPOSABLE_RESPONSIBILITY_ABILITIES,
} from "../lib/responsibility-proposals";
import { openPetition } from "../lib/petitions";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const ALLOWED_ABILITY = PROPOSABLE_RESPONSIBILITY_ABILITIES[0].ability;
const ALLOWED_ABILITY_2 = PROPOSABLE_RESPONSIBILITY_ABILITIES[1].ability;

async function approveAndApply(petitionId: string) {
  await prisma.petition.update({ where: { id: petitionId }, data: { status: "approved" } });
  await prisma.$transaction((tx) => createResponsibilityFromProposal(tx, petitionId));
}

// ── Validation ────────────────────────────────────────────────────────────────

test("proposeResponsibility rejects an empty/over-length type", async () => {
  const { groupId, membershipId } = await createFixture("rp_type");
  try {
    const empty = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "   ", description: "Purpose text", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(empty, { ok: false, reason: "invalid_type" });

    const tooLong = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "x".repeat(65), description: "Purpose text", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(tooLong, { ok: false, reason: "invalid_type" });
  } finally {
    await cleanupFixture("rp_type");
  }
});

test("proposeResponsibility rejects an empty/over-length description", async () => {
  const { groupId, membershipId } = await createFixture("rp_desc");
  try {
    const empty = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "   ", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(empty, { ok: false, reason: "invalid_description" });

    const tooLong = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "x".repeat(501), abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(tooLong, { ok: false, reason: "invalid_description" });
  } finally {
    await cleanupFixture("rp_desc");
  }
});

test("proposeResponsibility fails closed on an out-of-allowlist ability", async () => {
  const { groupId, membershipId } = await createFixture("rp_bad_ability");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Greeter",
      description: "Welcomes new members",
      abilities: [
        { ability: ALLOWED_ABILITY, availability: "always_available" },
        { ability: "approve_membership", availability: "always_available" },
      ],
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_ability" });
    const drafts = await prisma.responsibilityProposalDraft.findMany({ where: { groupId } });
    assert.equal(drafts.length, 0, "no draft should be created when validation fails closed");
  } finally {
    await cleanupFixture("rp_bad_ability");
  }
});

test("proposeResponsibility de-duplicates abilities keeping the first occurrence", async () => {
  const { groupId, membershipId } = await createFixture("rp_dedup");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Greeter",
      description: "Welcomes new members",
      abilities: [
        { ability: ALLOWED_ABILITY, availability: "always_available" },
        { ability: ALLOWED_ABILITY, availability: "available_during_emergency" },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const draft = await prisma.responsibilityProposalDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    const abilities = draft.abilities as { ability: string; availability: string }[];
    assert.equal(abilities.length, 1);
    assert.equal(abilities[0].availability, "always_available");
  } finally {
    await cleanupFixture("rp_dedup");
  }
});

test("proposeResponsibility rejects an empty abilities list after dedup", async () => {
  const { groupId, membershipId } = await createFixture("rp_no_abilities");
  try {
    const result = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "Welcomes new members", abilities: [] });
    assert.deepEqual(result, { ok: false, reason: "no_abilities" });
  } finally {
    await cleanupFixture("rp_no_abilities");
  }
});

test("proposeResponsibility rejects a duplicate type case-insensitively", async () => {
  const { groupId, membershipId } = await createFixture("rp_dup");
  try {
    await prisma.responsibility.create({ data: { id: "rp_dup_existing", groupId, type: "Reviewer" } });
    const result = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "reviewer", description: "Reviews concerns", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(result, { ok: false, reason: "duplicate_type" });
  } finally {
    await cleanupFixture("rp_dup");
  }
});

test("proposeResponsibility rejects an inactive member", async () => {
  const { groupId, membershipId } = await createFixture("rp_inactive");
  try {
    await prisma.groupMembership.update({ where: { id: membershipId }, data: { participationStatus: "dormant" } });
    const result = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "Welcomes new members", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.deepEqual(result, { ok: false, reason: "not_eligible" });
  } finally {
    await cleanupFixture("rp_inactive");
  }
});

test("proposeResponsibility opens a petition and logs responsibility_proposal.created", async () => {
  const { groupId, membershipId, accountId } = await createFixture("rp_open");
  try {
    const result = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "Welcomes new members", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.subjectType, "responsibility_creation_proposal");
    assert.equal(petition.subjectId, result.draftId);

    const log = await prisma.actionLog.findFirst({ where: { targetId: result.draftId, action: "responsibility_proposal.created" } });
    assert.ok(log);
    assert.equal(log!.actorAccountId, accountId);
  } finally {
    await cleanupFixture("rp_open");
  }
});

// ── Application ───────────────────────────────────────────────────────────────

test("createResponsibilityFromProposal creates Responsibility, abilities, and a Purpose living document", async () => {
  const { groupId, membershipId, accountId } = await createFixture("rp_apply");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Greeter",
      description: "Welcomes new members at the door",
      abilities: [
        { ability: ALLOWED_ABILITY, availability: "always_available" },
        { ability: ALLOWED_ABILITY_2, availability: "available_during_emergency" },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(result.petitionId);

    const responsibilities = await prisma.responsibility.findMany({ where: { groupId, type: "Greeter" } });
    assert.equal(responsibilities.length, 1);
    const responsibility = responsibilities[0];

    const abilities = await prisma.responsibilityAbility.findMany({ where: { responsibilityId: responsibility.id }, orderBy: { ability: "asc" } });
    assert.equal(abilities.length, 2);
    const byAbility = new Map(abilities.map((a) => [a.ability, a.availability]));
    assert.equal(byAbility.get(ALLOWED_ABILITY), "always_available");
    assert.equal(byAbility.get(ALLOWED_ABILITY_2), "available_during_emergency");

    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "responsibility", spaceId: responsibility.id, title: "Purpose" } });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].currentBody, "Welcomes new members at the door");
    assert.equal(responsibility.descriptionDocumentId, docs[0].id);

    const revisions = await prisma.livingDocumentRevision.findMany({ where: { livingDocumentId: docs[0].id } });
    assert.equal(revisions.length, 1);
    assert.notEqual(revisions[0].approvedAt, null);
    assert.equal(revisions[0].proposalId, result.petitionId);

    const draft = await prisma.responsibilityProposalDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    assert.equal(draft.appliedResponsibilityId, responsibility.id);
    assert.notEqual(draft.appliedAt, null);

    const createdLogs = await prisma.actionLog.findMany({ where: { targetId: responsibility.id, action: "responsibility.created" } });
    assert.equal(createdLogs.length, 1);
    assert.equal(createdLogs[0].actorAccountId, accountId);
  } finally {
    await cleanupFixture("rp_apply");
  }
});

test("createResponsibilityFromProposal is idempotent across repeated applications", async () => {
  const { groupId, membershipId } = await createFixture("rp_idempotent");
  try {
    const result = await proposeResponsibility(prisma, { groupId, createdByMembershipId: membershipId, type: "Greeter", description: "Welcomes new members", abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }] });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(result.petitionId);
    // Re-evaluate the already-applied petition
    await prisma.$transaction((tx) => createResponsibilityFromProposal(tx, result.petitionId));

    const responsibilities = await prisma.responsibility.findMany({ where: { groupId, type: "Greeter" } });
    assert.equal(responsibilities.length, 1);

    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "responsibility", spaceId: responsibilities[0].id, title: "Purpose" } });
    assert.equal(docs.length, 1);

    const createdLogs = await prisma.actionLog.findMany({ where: { targetId: responsibilities[0].id, action: "responsibility.created" } });
    assert.equal(createdLogs.length, 1, "second application must not double-log");
  } finally {
    await cleanupFixture("rp_idempotent");
  }
});

// ── Concurrent convergence ────────────────────────────────────────────────────

test("createResponsibilityFromProposal seeds Purpose when augmenting a bare existing responsibility", async () => {
  const { groupId, membershipId } = await createFixture("rp_bare_existing");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Greeter",
      description: "Welcomes new members",
      abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const existing = await prisma.responsibility.create({
      data: { groupId, type: "Greeter" },
    });
    await approveAndApply(result.petitionId);

    const updated = await prisma.responsibility.findUniqueOrThrow({ where: { id: existing.id } });
    assert.notEqual(updated.descriptionDocumentId, null);
    const purpose = await prisma.livingDocument.findUniqueOrThrow({
      where: { id: updated.descriptionDocumentId! },
    });
    assert.equal(purpose.currentBody, "Welcomes new members");
    assert.equal(await prisma.responsibility.count({ where: { groupId } }), 1);
  } finally {
    await cleanupFixture("rp_bare_existing");
  }
});

test("createResponsibilityFromProposal rejects a petition whose draft belongs to another group", async () => {
  const groupA = await createFixture("rp_scope_a");
  const groupB = await createFixture("rp_scope_b");
  try {
    const proposal = await proposeResponsibility(prisma, {
      groupId: groupB.groupId,
      createdByMembershipId: groupB.membershipId,
      type: "Greeter",
      description: "Welcomes members in group B",
      abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }],
    });
    assert.equal(proposal.ok, true);
    if (!proposal.ok) return;

    const forged = await openPetition(prisma, {
      groupId: groupA.groupId,
      category: "responsibility",
      subjectType: "responsibility_creation_proposal",
      subjectId: proposal.draftId,
      createdByMembershipId: groupA.membershipId,
    });
    assert.equal(forged.ok, true);
    if (!forged.ok) return;
    await prisma.petition.update({ where: { id: forged.petitionId }, data: { status: "approved" } });

    await assert.rejects(
      () => prisma.$transaction((tx) => createResponsibilityFromProposal(tx, forged.petitionId)),
      /scope does not match the draft group/,
    );
    assert.equal(await prisma.responsibility.count({ where: { groupId: groupA.groupId } }), 0);
    assert.equal(await prisma.responsibility.count({ where: { groupId: groupB.groupId } }), 0);
  } finally {
    await cleanupFixture("rp_scope_a");
    await cleanupFixture("rp_scope_b");
  }
});

test("createResponsibilityFromProposal drops non-grantable abilities instead of throwing/jamming", async () => {
  const { groupId, membershipId } = await createFixture("rp_stored_ability");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Greeter",
      description: "Welcomes new members",
      abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Inject an accountability ability (never proposable, and it gates real behavior). Applying must
    // NOT throw — throwing rolls back the approval and permanently jams the petition — and must NOT
    // grant the ability.
    await prisma.responsibilityProposalDraft.update({
      where: { id: result.draftId },
      data: { abilities: [{ ability: "review_concerns", availability: "always_available" }] },
    });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved" } });

    await prisma.$transaction((tx) => createResponsibilityFromProposal(tx, result.petitionId)); // resolves cleanly
    const responsibility = await prisma.responsibility.findFirstOrThrow({
      where: { groupId, type: "Greeter" },
      include: { abilities: true },
    });
    assert.equal(responsibility.abilities.length, 0, "the non-grantable ability must not be granted");
  } finally {
    await cleanupFixture("rp_stored_ability");
  }
});

test("createResponsibilityFromProposal grants grandfathered abilities removed from the proposable form (regression)", async () => {
  const { groupId, membershipId } = await createFixture("rp_grandfather");
  try {
    const result = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: membershipId,
      type: "Emergency Team",
      description: "Acts during emergencies",
      abilities: [{ ability: ALLOWED_ABILITY, availability: "always_available" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Simulate a draft approved before issue_support_requests was removed from the proposable form
    // (the real cause of a stuck seed petition). It must still resolve and grant the grandfathered ability.
    await prisma.responsibilityProposalDraft.update({
      where: { id: result.draftId },
      data: {
        abilities: [
          { ability: "create_bulletins", availability: "always_available" },
          { ability: "issue_support_requests", availability: "available_during_emergency" },
        ],
      },
    });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "approved" } });
    await prisma.$transaction((tx) => createResponsibilityFromProposal(tx, result.petitionId));

    const responsibility = await prisma.responsibility.findFirstOrThrow({
      where: { groupId, type: "Emergency Team" },
      include: { abilities: true },
    });
    assert.deepEqual(responsibility.abilities.map((a) => a.ability).sort(), ["create_bulletins", "issue_support_requests"]);
  } finally {
    await cleanupFixture("rp_grandfather");
  }
});

test("two case-different proposals converge onto a single Responsibility with union abilities and always_available precedence", async () => {
  const { groupId, membershipId: m1, accountId: a1 } = await createFixture("rp_conv_a");
  const { membershipId: m2, accountId: a2 } = await joinSecondMember("rp_conv_a", groupId);
  try {
    const r1 = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: m1,
      type: "Reviewer",
      description: "First proposal's purpose statement",
      abilities: [
        { ability: ALLOWED_ABILITY, availability: "always_available" },
        { ability: ALLOWED_ABILITY_2, availability: "available_during_emergency" },
      ],
    });
    const r2 = await proposeResponsibility(prisma, {
      groupId,
      createdByMembershipId: m2,
      type: "reviewer",
      description: "Second proposal's purpose statement",
      abilities: [
        { ability: ALLOWED_ABILITY, availability: "available_during_emergency" },
        { ability: PROPOSABLE_RESPONSIBILITY_ABILITIES[2].ability, availability: "always_available" },
      ],
    });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;

    await Promise.all([
      approveAndApply(r1.petitionId),
      approveAndApply(r2.petitionId),
    ]);

    const responsibilities = await prisma.responsibility.findMany({ where: { groupId, type: { equals: "reviewer", mode: "insensitive" } } });
    assert.equal(responsibilities.length, 1, "exactly one Responsibility must exist");
    const responsibility = responsibilities[0];

    const draft1 = await prisma.responsibilityProposalDraft.findUniqueOrThrow({ where: { id: r1.draftId } });
    const draft2 = await prisma.responsibilityProposalDraft.findUniqueOrThrow({ where: { id: r2.draftId } });
    assert.equal(draft1.appliedResponsibilityId, responsibility.id);
    assert.equal(draft2.appliedResponsibilityId, responsibility.id);

    // Union of abilities, always_available wins on conflicts
    const abilities = await prisma.responsibilityAbility.findMany({ where: { responsibilityId: responsibility.id } });
    const byAbility = new Map(abilities.map((a) => [a.ability, a.availability]));
    assert.equal(byAbility.size, 3);
    assert.equal(byAbility.get(ALLOWED_ABILITY), "always_available", "conflicting availability must resolve to always_available");
    assert.equal(byAbility.get(ALLOWED_ABILITY_2), "available_during_emergency");
    assert.equal(byAbility.get(PROPOSABLE_RESPONSIBILITY_ABILITIES[2].ability), "always_available");

    // Exactly one Purpose document, seeded from whichever draft applied "created"
    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "responsibility", spaceId: responsibility.id, title: "Purpose" } });
    assert.equal(docs.length, 1, "exactly one Purpose document must exist");
    assert.ok(
      docs[0].currentBody === "First proposal's purpose statement" || docs[0].currentBody === "Second proposal's purpose statement",
    );
    assert.equal(responsibility.descriptionDocumentId, docs[0].id);

    // Exactly one created + one augmented log entry, order-independent
    const logs = await prisma.actionLog.findMany({ where: { targetId: responsibility.id, action: { in: ["responsibility.created", "responsibility.augmented"] } } });
    const actions = logs.map((l) => l.action).sort();
    assert.deepEqual(actions, ["responsibility.augmented", "responsibility.created"]);
    const actorIds = new Set(logs.map((l) => l.actorAccountId));
    assert.ok(actorIds.has(a1) && actorIds.has(a2));
  } finally {
    await cleanupFixture("rp_conv_a");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.rp.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  return { groupId: group.id, membershipId: membership.id, accountId: account.id };
}

async function joinSecondMember(prefix: string, groupId: string) {
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct2`, homeNodeId: `${prefix}_node`, displayName: `User ${prefix} 2`, accountType: "member", profileVisibility: "private" },
  });
  const membership = await prisma.groupMembership.create({
    data: { id: `${prefix}_mem2`, accountId: account.id, groupId, status: "active", participationStatus: "active" },
  });
  return { membershipId: membership.id, accountId: account.id };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.responsibilityAbility.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityAssignment.deleteMany({ where: { responsibility: { groupId: { startsWith: prefix } } } });
  await prisma.responsibilityProposalDraft.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.livingDocumentRevision.deleteMany({ where: { livingDocument: { spaceId: { in: await responsibilityIdsFor(prefix) } } } });
  await prisma.livingDocument.deleteMany({ where: { spaceType: "responsibility", spaceId: { in: await responsibilityIdsFor(prefix) } } });
  await prisma.responsibility.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function responsibilityIdsFor(prefix: string): Promise<string[]> {
  const rows = await prisma.responsibility.findMany({ where: { groupId: { startsWith: prefix } }, select: { id: true } });
  return rows.map((r) => r.id);
}
