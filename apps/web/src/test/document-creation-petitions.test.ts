import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { proposeContentCreation, applyContentCreationDraft, expireStaleContentDrafts } from "../lib/content-creation-drafts";
// Helper: force approve then directly apply (matches pattern used in other test files)
async function approveAndApply(
  prisma: ReturnType<typeof createPrismaClient>,
  petitionId: string,
  family: "bulletin_creation" | "publication_creation" | "publication_entry_creation" | "living_document_creation",
) {
  await prisma.petition.update({ where: { id: petitionId }, data: { status: "approved" } });
  await prisma.$transaction((tx) => applyContentCreationDraft(tx, petitionId, family));
}

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ── F6: draft expiry sweep ─────────────────────────────────────────────────────

test("expireStaleContentDrafts deletes an unapplied, past-expiry draft once its petition has resolved", async () => {
  await cleanupFixture("dc_sweep");
  try {
    const { groupId, membershipId } = await createFixture("dc_sweep");
    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Stale draft",
      body: "Body",
      createdByMembershipId: membershipId,
    });
    assert.ok(result.ok);
    if (!result.ok) return;

    // Petition resolves (rejected) and the draft ages past its expiry.
    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "rejected" } });
    await prisma.contentCreationDraft.update({
      where: { id: result.draftId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expireStaleContentDrafts(prisma, groupId);
    assert.equal(await prisma.contentCreationDraft.findUnique({ where: { id: result.draftId } }), null);
  } finally {
    await cleanupFixture("dc_sweep");
  }
});

test("expireStaleContentDrafts preserves drafts with an open petition or already applied", async () => {
  await cleanupFixture("dc_sweep_keep");
  try {
    const { groupId, membershipId } = await createFixture("dc_sweep_keep");

    // (a) Open petition, past expiry → must be preserved (proposal still in flight).
    const open = await proposeContentCreation(prisma, {
      contentType: "bulletin", spaceType: "group", spaceId: groupId, groupId,
      title: "Open", body: "B", createdByMembershipId: membershipId,
    });
    assert.ok(open.ok);
    if (!open.ok) return;
    await prisma.contentCreationDraft.update({ where: { id: open.draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    // (b) Applied draft, past expiry → must be preserved (it backs created content).
    const applied = await proposeContentCreation(prisma, {
      contentType: "bulletin", spaceType: "group", spaceId: groupId, groupId,
      title: "Applied", body: "B", createdByMembershipId: membershipId,
    });
    assert.ok(applied.ok);
    if (!applied.ok) return;
    await approveAndApply(prisma, applied.petitionId, "bulletin_creation");
    await prisma.contentCreationDraft.update({ where: { id: applied.draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expireStaleContentDrafts(prisma, groupId);

    assert.ok(await prisma.contentCreationDraft.findUnique({ where: { id: open.draftId } }));
    assert.ok(await prisma.contentCreationDraft.findUnique({ where: { id: applied.draftId } }));
  } finally {
    await cleanupFixture("dc_sweep_keep");
  }
});

// ── Bulletin creation ─────────────────────────────────────────────────────────

test("bulletin_creation: draft created, petition opens, canonical list empty until approved", async () => {
  await cleanupFixture("dc_bul");
  try {
    const { groupId, membershipId } = await createFixture("dc_bul");
    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Test Bulletin",
      body: "Body text",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Draft exists but canonical record does not yet
    const draft = await prisma.contentCreationDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    assert.equal(draft.appliedAt, null);
    assert.equal(draft.createdContentId, null);

    const bulletins = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(bulletins.length, 0);
  } finally {
    await cleanupFixture("dc_bul");
  }
});

test("bulletin_creation: approval creates canonical record with correct fields", async () => {
  await cleanupFixture("dc_bul_approve");
  try {
    const { groupId, membershipId } = await createFixture("dc_bul_approve");
    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "My Bulletin",
      body: "Bulletin body",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(prisma, result.petitionId, "bulletin_creation");

    const bulletins = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(bulletins.length, 1);
    assert.equal(bulletins[0].title, "My Bulletin");
    assert.equal(bulletins[0].body, "Bulletin body");

    const draft = await prisma.contentCreationDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    assert.notEqual(draft.appliedAt, null);
    assert.equal(draft.createdContentId, bulletins[0].id);
  } finally {
    await cleanupFixture("dc_bul_approve");
  }
});

// ── Publication creation ──────────────────────────────────────────────────────

test("publication_creation: approval creates canonical publication", async () => {
  await cleanupFixture("dc_pub_approve");
  try {
    const { groupId, membershipId } = await createFixture("dc_pub_approve");
    const result = await proposeContentCreation(prisma, {
      contentType: "publication",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Test Publication",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(prisma, result.petitionId, "publication_creation");

    const pubs = await prisma.publication.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(pubs.length, 1);
    assert.equal(pubs[0].title, "Test Publication");

    const draft = await prisma.contentCreationDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    assert.equal(draft.createdContentId, pubs[0].id);
  } finally {
    await cleanupFixture("dc_pub_approve");
  }
});

// ── Publication entry creation ─────────────────────────────────────────────────

test("publication_entry_creation: approval creates entry in correct publication", async () => {
  await cleanupFixture("dc_entry_approve");
  try {
    const { groupId, membershipId, accountId } = await createFixture("dc_entry_approve");
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: groupId, createdByAccountId: accountId, title: "Pub" },
    });

    const result = await proposeContentCreation(prisma, {
      contentType: "publication_entry",
      spaceType: "group",
      spaceId: groupId,
      publicationId: pub.id,
      groupId,
      body: "Entry body",
      title: "Entry Title",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(prisma, result.petitionId, "publication_entry_creation");

    const entries = await prisma.publicationEntry.findMany({ where: { publicationId: pub.id } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].body, "Entry body");
    assert.equal(entries[0].title, "Entry Title");
  } finally {
    await cleanupFixture("dc_entry_approve");
  }
});

test("publication_entry_creation: space mismatch is rejected before draft creation", async () => {
  await cleanupFixture("dc_entry_mismatch");
  try {
    const { groupId, membershipId, accountId } = await createFixture("dc_entry_mismatch");
    // Create a pub in a different spaceId
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: `${groupId}_other`, createdByAccountId: accountId, title: "Pub" },
    });

    const result = await proposeContentCreation(prisma, {
      contentType: "publication_entry",
      spaceType: "group",
      spaceId: groupId,
      publicationId: pub.id,
      groupId,
      body: "Entry body",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "publication_space_mismatch");

    // No draft was created
    const drafts = await prisma.contentCreationDraft.findMany({ where: { groupId } });
    assert.equal(drafts.length, 0);
  } finally {
    await cleanupFixture("dc_entry_mismatch");
  }
});

test("publication_entry_creation: archived publication is rejected", async () => {
  await cleanupFixture("dc_entry_archived");
  try {
    const { groupId, membershipId, accountId } = await createFixture("dc_entry_archived");
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: groupId, createdByAccountId: accountId, title: "Archived Pub", archivedAt: new Date() },
    });

    const result = await proposeContentCreation(prisma, {
      contentType: "publication_entry",
      spaceType: "group",
      spaceId: groupId,
      publicationId: pub.id,
      groupId,
      body: "Entry",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "publication_archived");
  } finally {
    await cleanupFixture("dc_entry_archived");
  }
});

test("publication_entry_creation: approval rejects a publication moved to another space", async () => {
  await cleanupFixture("dc_entry_moved");
  try {
    const { groupId, membershipId, accountId } = await createFixture("dc_entry_moved");
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: groupId, createdByAccountId: accountId, title: "Movable Pub" },
    });

    const result = await proposeContentCreation(prisma, {
      contentType: "publication_entry",
      spaceType: "group",
      spaceId: groupId,
      publicationId: pub.id,
      groupId,
      body: "Entry body",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await prisma.publication.update({
      where: { id: pub.id },
      data: { spaceId: `${groupId}_other` },
    });
    await prisma.petition.update({
      where: { id: result.petitionId },
      data: { status: "approved" },
    });

    await assert.rejects(
      prisma.$transaction((tx) => applyContentCreationDraft(tx, result.petitionId, "publication_entry_creation")),
      /no longer belongs/,
    );
    assert.equal(await prisma.publicationEntry.count({ where: { publicationId: pub.id } }), 0);
  } finally {
    await cleanupFixture("dc_entry_moved");
  }
});

// ── Living document creation ──────────────────────────────────────────────────

test("living_document_creation: approval creates document with initial revision with petition provenance", async () => {
  await cleanupFixture("dc_doc_approve");
  try {
    const { groupId, membershipId } = await createFixture("dc_doc_approve");
    const result = await proposeContentCreation(prisma, {
      contentType: "living_document",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Governance Charter",
      body: "We believe in...",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(prisma, result.petitionId, "living_document_creation");

    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, "Governance Charter");
    assert.equal(docs[0].currentBody, "We believe in...");

    const revisions = await prisma.livingDocumentRevision.findMany({ where: { livingDocumentId: docs[0].id } });
    assert.equal(revisions.length, 1);
    assert.notEqual(revisions[0].approvedAt, null);
    assert.equal(revisions[0].proposalId, result.petitionId);
    assert.notEqual(revisions[0].approvedByAccountId, null);
  } finally {
    await cleanupFixture("dc_doc_approve");
  }
});

// ── Idempotency ───────────────────────────────────────────────────────────────

test("applyContentCreationDraft is idempotent: applying twice creates only one canonical record", async () => {
  await cleanupFixture("dc_idempotent");
  try {
    const { groupId, membershipId } = await createFixture("dc_idempotent");
    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Once",
      body: "Only created once",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await approveAndApply(prisma, result.petitionId, "bulletin_creation");
    await prisma.$transaction((tx) => applyContentCreationDraft(tx, result.petitionId, "bulletin_creation"));

    const bulletins = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(bulletins.length, 1);
    const logs = await prisma.actionLog.findMany({
      where: { groupId, action: "bulletin.created", targetId: bulletins[0].id },
    });
    assert.equal(logs.length, 1);
  } finally {
    await cleanupFixture("dc_idempotent");
  }
});

// ── Failed petition → draft deleted ──────────────────────────────────────────

test("ineligible proposer is rejected before a draft is created", async () => {
  await cleanupFixture("dc_fail_cleanup");
  try {
    const { groupId, membershipId } = await createFixture("dc_fail_cleanup");

    await prisma.groupMembership.update({
      where: { id: membershipId },
      data: { participationStatus: "quiet" },
    });

    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Should fail",
      body: "Body",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, false);

    const drafts = await prisma.contentCreationDraft.findMany({ where: { groupId } });
    assert.equal(drafts.length, 0);
  } finally {
    await cleanupFixture("dc_fail_cleanup");
  }
});

// ── Non-active member rejected ────────────────────────────────────────────────

test("non-active member is rejected before draft is created", async () => {
  await cleanupFixture("dc_inactive");
  try {
    const { groupId, membershipId } = await createFixture("dc_inactive");
    await prisma.groupMembership.update({ where: { id: membershipId }, data: { participationStatus: "dormant" } });

    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Test",
      body: "Body",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not_eligible");
  } finally {
    await cleanupFixture("dc_inactive");
  }
});

// ── Project voter scope ───────────────────────────────────────────────────────

test("project-scoped bulletin petition uses project membership and project voter scope", async () => {
  await cleanupFixture("dc_proj_scope");
  try {
    const { groupId, projectId, projectMembershipId } = await createProjectFixture("dc_proj_scope");
    await prisma.groupMembership.deleteMany({ where: { groupId } });

    const result = await proposeContentCreation(prisma, {
      contentType: "bulletin",
      spaceType: "project",
      spaceId: projectId,
      groupId,
      title: "Project Bulletin",
      body: "For the project",
      createdByProjectMembershipId: projectMembershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const petition = await prisma.petition.findUniqueOrThrow({ where: { id: result.petitionId } });
    assert.equal(petition.scopeType, "project");
    assert.equal(petition.scopeId, projectId);
    const voterScope = petition.voterScope as { type: string; scopeId: string };
    assert.equal(voterScope.type, "project");
    assert.equal(voterScope.scopeId, projectId);
  } finally {
    await cleanupFixture("dc_proj_scope");
  }
});

// ── Rejection: draft not applied ──────────────────────────────────────────────

test("rejected petition: draft.appliedAt stays null, no canonical record", async () => {
  await cleanupFixture("dc_rejected");
  try {
    const { groupId, membershipId } = await createFixture("dc_rejected");
    const result = await proposeContentCreation(prisma, {
      contentType: "publication",
      spaceType: "group",
      spaceId: groupId,
      groupId,
      title: "Should Not Exist",
      createdByMembershipId: membershipId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Force rejection — do not call applyContentCreationDraft; verify draft is not applied
    await prisma.petition.update({ where: { id: result.petitionId }, data: { status: "rejected" } });

    const draft = await prisma.contentCreationDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    assert.equal(draft.appliedAt, null);

    const pubs = await prisma.publication.findMany({ where: { spaceType: "group", spaceId: groupId } });
    assert.equal(pubs.length, 0);
  } finally {
    await cleanupFixture("dc_rejected");
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createFixture(prefix: string) {
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.dc.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
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
  return { node, account, group, groupId: group.id, membershipId: membership.id, accountId: account.id };
}

async function createProjectFixture(prefix: string) {
  const { groupId, accountId } = await createFixture(prefix);
  const project = await prisma.project.create({
    data: { id: `${prefix}_proj`, name: `Project ${prefix}`, foundingGroupId: groupId, status: "active" },
  });
  // Every project needs at least one ProjectHosting row — current hosting (not
  // foundingGroupId) is what authorizes the project's coordination space (RFC-007).
  await prisma.projectHosting.create({ data: { projectId: project.id, groupId } });
  const projectMembership = await prisma.projectMembership.create({
    data: { id: `${prefix}_pmem`, accountId, projectId: project.id, status: "active", participationStatus: "active" },
  });
  return { groupId, projectId: project.id, projectMembershipId: projectMembership.id };
}

async function cleanupFixture(prefix: string) {
  await prisma.actionLog.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.contentCreationDraft.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.bulletin.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.publicationEntry.deleteMany({ where: { publication: { spaceId: { startsWith: prefix } } } });
  await prisma.publication.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.livingDocumentRevision.deleteMany({ where: { livingDocument: { spaceId: { startsWith: prefix } } } });
  await prisma.livingDocument.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.projectMembership.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.projectHosting.deleteMany({ where: { project: { foundingGroupId: { startsWith: prefix } } } });
  await prisma.project.deleteMany({ where: { foundingGroupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
