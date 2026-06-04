import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  createLivingDocument,
  reviseLivingDocument,
  draftLivingDocumentRevision,
  openRevisionPetition,
  onRevisionPetitionApproved,
  openLivingDocumentArchivalPetition,
  onLivingDocumentArchivalPetitionApproved,
} from "../lib/living-documents";
import { createBulletin, archiveBulletin, openBulletinArchivalPetition, onBulletinArchivalPetitionApproved } from "../lib/bulletins";
import {
  createPublication,
  addPublicationEntry,
  archivePublication,
  openPublicationArchivalPetition,
  onPublicationArchivalPetitionApproved,
  openPublicationEntryArchivalPetition,
  onPublicationEntryArchivalPetitionApproved,
} from "../lib/publications";
import { evaluatePetition } from "../lib/petitions";
import { isProposalFamily } from "../lib/governance-proposal-families";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// ---- G4a: existing direct archive/revise tests must still pass ----

test("direct reviseLivingDocument still works (internal primitive)", async () => {
  const { group, account } = await createCommsFixture("gc_direct_revise");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Charter", body: "v1" });
    await reviseLivingDocument(prisma, { livingDocumentId: document.id, authorId: account.id, body: "v2" });
    const updated = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(updated.currentBody, "v2");
  } finally {
    await cleanupCommsFixture("gc_direct_revise");
  }
});

test("direct archiveBulletin still works (internal primitive)", async () => {
  const { group, account } = await createCommsFixture("gc_direct_blt");
  try {
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Post", body: "." });
    await archiveBulletin(prisma, b.id);
    const updated = await prisma.bulletin.findUniqueOrThrow({ where: { id: b.id } });
    assert.ok(updated.archivedAt);
    assert.equal(updated.archivedByAccountId, null); // direct path does not set provenance
  } finally {
    await cleanupCommsFixture("gc_direct_blt");
  }
});

// ---- G4b: petition wrappers ----

test("revision petition: draft revision does not update currentBody until approved", async () => {
  const { group, account, membership } = await createCommsFixture("gc_rev_draft");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Policy", body: "v1" });
    const revision = await draftLivingDocumentRevision(prisma, { livingDocumentId: document.id, authorId: account.id, body: "v2" });

    // currentBody must still be v1
    const before = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(before.currentBody, "v1");

    // Open petition
    const result = await openRevisionPetition(prisma, { livingDocumentId: document.id, revisionId: revision.id, createdByMembershipId: membership.id, groupId: group.id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // currentBody still v1 before approval
    const during = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(during.currentBody, "v1");
  } finally {
    await cleanupCommsFixture("gc_rev_draft");
  }
});

test("revision petition: approval promotes body and sets provenance", async () => {
  const { group, account, membership } = await createCommsFixture("gc_rev_approve", 3);
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Policy", body: "v1" });
    const revision = await draftLivingDocumentRevision(prisma, { livingDocumentId: document.id, authorId: account.id, body: "v2" });

    const result = await openRevisionPetition(prisma, { livingDocumentId: document.id, revisionId: revision.id, createdByMembershipId: membership.id, groupId: group.id });
    if (!result.ok) return;

    // Add enough support (need >= 60% of 3 = 2)
    const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });

    // Expire petition
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await onRevisionPetitionApproved(prisma, result.petitionId);

    const updated = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(updated.currentBody, "v2");

    const rev = await prisma.livingDocumentRevision.findUniqueOrThrow({ where: { id: revision.id } });
    assert.equal(rev.proposalId, result.petitionId);
    assert.ok(rev.approvedAt);
    assert.equal(rev.approvedByAccountId, account.id);
  } finally {
    await cleanupCommsFixture("gc_rev_approve");
  }
});

test("revision petition: unapproved petition leaves currentBody unchanged", async () => {
  const { group, account, membership } = await createCommsFixture("gc_rev_reject");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Policy", body: "v1" });
    const revision = await draftLivingDocumentRevision(prisma, { livingDocumentId: document.id, authorId: account.id, body: "v2" });
    const result = await openRevisionPetition(prisma, { livingDocumentId: document.id, revisionId: revision.id, createdByMembershipId: membership.id, groupId: group.id });
    if (!result.ok) return;

    // No support → petition will reject
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    // Do NOT call onRevisionPetitionApproved since petition was rejected

    const doc = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(doc.currentBody, "v1"); // unchanged
  } finally {
    await cleanupCommsFixture("gc_rev_reject");
  }
});

test("bulletin archival petition: approval sets archivedAt and provenance", async () => {
  const { group, account, membership } = await createCommsFixture("gc_blt_archive", 3);
  try {
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Announce", body: "." });

    const result = await openBulletinArchivalPetition(prisma, { bulletinId: b.id, createdByMembershipId: membership.id, groupId: group.id });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Verify archivedAt not yet set
    const before = await prisma.bulletin.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(before.archivedAt, null);

    // Add enough support and expire
    const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await onBulletinArchivalPetitionApproved(prisma, result.petitionId);

    const after = await prisma.bulletin.findUniqueOrThrow({ where: { id: b.id } });
    assert.ok(after.archivedAt);
    assert.equal(after.archivedByAccountId, account.id);
    assert.equal(after.archiveProposalId, result.petitionId);
  } finally {
    await cleanupCommsFixture("gc_blt_archive");
  }
});

test("publication archival petition: approval sets provenance", async () => {
  const { group, account, membership } = await createCommsFixture("gc_pub_archive", 3);
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Newsletter" });

    const result = await openPublicationArchivalPetition(prisma, { publicationId: pub.id, createdByMembershipId: membership.id, groupId: group.id });
    if (!result.ok) return;

    const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await onPublicationArchivalPetitionApproved(prisma, result.petitionId);

    const after = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    assert.ok(after.archivedAt);
    assert.equal(after.archiveProposalId, result.petitionId);
  } finally {
    await cleanupCommsFixture("gc_pub_archive");
  }
});

test("publication entry archival petition: approval sets provenance on entry only", async () => {
  const { group, account, membership } = await createCommsFixture("gc_entry_archive", 3);
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Journal" });
    const entry = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Issue 1" });

    const result = await openPublicationEntryArchivalPetition(prisma, { entryId: entry.id, createdByMembershipId: membership.id, groupId: group.id });
    if (!result.ok) return;

    const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await onPublicationEntryArchivalPetitionApproved(prisma, result.petitionId);

    const afterEntry = await prisma.publicationEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.ok(afterEntry.archivedAt);
    assert.equal(afterEntry.archiveProposalId, result.petitionId);

    // Publication itself is not archived
    const afterPub = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    assert.equal(afterPub.archivedAt, null);
  } finally {
    await cleanupCommsFixture("gc_entry_archive");
  }
});

test("living document archival petition: approval sets provenance", async () => {
  const { group, account, membership } = await createCommsFixture("gc_doc_archive", 3);
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Mission", body: "We care." });

    const result = await openLivingDocumentArchivalPetition(prisma, { documentId: document.id, createdByMembershipId: membership.id, groupId: group.id });
    if (!result.ok) return;

    const memberships = await prisma.groupMembership.findMany({ where: { groupId: group.id } });
    await prisma.petitionSupport.createMany({ data: memberships.slice(0, 2).map(m => ({ petitionId: result.petitionId, membershipId: m.id })) });
    await prisma.petition.update({ where: { id: result.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluatePetition(prisma, result.petitionId);
    await onLivingDocumentArchivalPetitionApproved(prisma, result.petitionId);

    const after = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.ok(after.archivedAt);
    assert.equal(after.archiveProposalId, result.petitionId);
    assert.equal(after.archivedByAccountId, account.id);
  } finally {
    await cleanupCommsFixture("gc_doc_archive");
  }
});

// ---- Fix 3 ownership security tests ----

test("Fix 3: openBulletinArchivalPetition rejects bulletin from wrong group", async () => {
  const { group, membership } = await createCommsFixture("gc_own_blt_a");
  const { group: groupB, account: accountB } = await createCommsFixture("gc_own_blt_b");
  try {
    // Bulletin is in groupB's space
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: groupB.id, authorId: accountB.id, title: "Wrong group", body: "." });
    // Try to open archival petition in groupA's governance
    await assert.rejects(
      () => openBulletinArchivalPetition(prisma, { bulletinId: b.id, createdByMembershipId: membership.id, groupId: group.id }),
      /group/,
    );
  } finally {
    await cleanupCommsFixture("gc_own_blt_a");
    await cleanupCommsFixture("gc_own_blt_b");
  }
});

test("Fix 3: openRevisionPetition rejects revision on document from wrong group", async () => {
  const { group, account, membership } = await createCommsFixture("gc_own_rev_a");
  const { group: groupB, account: accountB } = await createCommsFixture("gc_own_rev_b");
  try {
    // Document is in groupB's space
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: groupB.id, authorId: accountB.id, title: "Foreign doc", body: "v1" });
    const revision = await draftLivingDocumentRevision(prisma, { livingDocumentId: document.id, authorId: accountB.id, body: "v2" });
    // Try to open revision petition in groupA's governance
    await assert.rejects(
      () => openRevisionPetition(prisma, { livingDocumentId: document.id, revisionId: revision.id, createdByMembershipId: membership.id, groupId: group.id }),
      /group/,
    );
  } finally {
    await cleanupCommsFixture("gc_own_rev_a");
    await cleanupCommsFixture("gc_own_rev_b");
  }
});

test("Fix 3 (revision-doc mismatch): openRevisionPetition rejects when revisionId belongs to different document", async () => {
  const { group, account, membership } = await createCommsFixture("gc_rev_mismatch");
  try {
    const { document: docA } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Doc A", body: "v1" });
    const { document: docB } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Doc B", body: "v1" });
    // Draft a revision for docB
    const revisionB = await draftLivingDocumentRevision(prisma, { livingDocumentId: docB.id, authorId: account.id, body: "docB v2" });
    // Try to open a revision petition claiming docA but with docB's revision
    await assert.rejects(
      () => openRevisionPetition(prisma, { livingDocumentId: docA.id, revisionId: revisionB.id, createdByMembershipId: membership.id, groupId: group.id }),
      /belongs to document/,
    );
  } finally {
    await cleanupCommsFixture("gc_rev_mismatch");
  }
});

test("Fix 2 (typed archive families): retired archive_proposal family is rejected", () => {
  assert.equal(isProposalFamily("archive_proposal"), false);
  assert.equal(isProposalFamily("bulletin_archive"), true);
  assert.equal(isProposalFamily("publication_archive"), true);
  assert.equal(isProposalFamily("publication_entry_archive"), true);
  assert.equal(isProposalFamily("living_document_archive"), true);
});

test("Fix 1 (group-scoped key): competition keys from different groups do not interfere", async () => {
  const { group: gA, membership: membA } = await createCommsFixture("gc_key_a");
  const { group: gB, membership: membB } = await createCommsFixture("gc_key_b");
  try {
    const { openPetition } = await import("../lib/petitions");
    // Same subjectId in both groups — should produce different competition keys
    const subjectId = "shared_account_id";
    const ra = await openPetition(prisma, { groupId: gA.id, category: "membership", subjectType: "membership_request", subjectId, createdByMembershipId: membA.id });
    const rb = await openPetition(prisma, { groupId: gB.id, category: "membership", subjectType: "membership_request", subjectId, createdByMembershipId: membB.id });
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    if (!ra.ok || !rb.ok) return;

    const pA = await prisma.petition.findUniqueOrThrow({ where: { id: ra.petitionId }, select: { competitionKey: true } });
    const pB = await prisma.petition.findUniqueOrThrow({ where: { id: rb.petitionId }, select: { competitionKey: true } });

    // Keys must differ because groupId is embedded
    assert.notEqual(pA.competitionKey, pB.competitionKey);
    assert.ok(pA.competitionKey?.includes(gA.id), "Key A must include group A id");
    assert.ok(pB.competitionKey?.includes(gB.id), "Key B must include group B id");
  } finally {
    await cleanupCommsFixture("gc_key_a");
    await cleanupCommsFixture("gc_key_b");
  }
});

test("Fix 3: openPublicationArchivalPetition rejects publication from wrong group", async () => {
  const { group, membership } = await createCommsFixture("gc_own_pub_a");
  const { group: groupB, account: accountB } = await createCommsFixture("gc_own_pub_b");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: groupB.id, createdByAccountId: accountB.id, title: "Wrong group pub" });
    await assert.rejects(
      () => openPublicationArchivalPetition(prisma, { publicationId: pub.id, createdByMembershipId: membership.id, groupId: group.id }),
      /group/,
    );
  } finally {
    await cleanupCommsFixture("gc_own_pub_a");
    await cleanupCommsFixture("gc_own_pub_b");
  }
});

// ---- fixtures ----

async function createCommsFixture(prefix: string, memberCount = 1) {
  await cleanupCommsFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.comm.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const account = await prisma.account.create({ data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" } });
  const membership = await prisma.groupMembership.create({ data: { id: `${prefix}_membership`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" } });

  for (let i = 1; i < memberCount; i++) {
    const a = await prisma.account.create({ data: { id: `${prefix}_acct_${i}`, homeNodeId: node.id, displayName: `User ${prefix} ${i}`, accountType: "member", profileVisibility: "private" } });
    await prisma.groupMembership.create({ data: { id: `${prefix}_mem_${i}`, accountId: a.id, groupId: group.id, status: "active", participationStatus: "active" } });
  }

  return { node, group, account, membership };
}

async function cleanupCommsFixture(prefix: string) {
  await prisma.petitionSupport.deleteMany({ where: { petition: { groupId: { startsWith: prefix } } } });
  await prisma.petition.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.livingDocumentRevision.deleteMany({ where: { livingDocument: { spaceId: { startsWith: prefix } } } });
  await prisma.livingDocument.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.publicationEntry.deleteMany({ where: { publication: { spaceId: { startsWith: prefix } } } });
  await prisma.publication.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.bulletin.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.memberGovernanceSignal.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
