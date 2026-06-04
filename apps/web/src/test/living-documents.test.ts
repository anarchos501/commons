import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { archiveLivingDocument, createLivingDocument, getLivingDocumentHistory, listLivingDocuments, reviseLivingDocument } from "../lib/living-documents";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("createLivingDocument creates document and seeds first revision in one transaction", async () => {
  const { group, account } = await createFixture("ld_create");
  try {
    const { document, revision } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Mission", body: "V1." });
    assert.equal(document.currentBody, "V1.");
    assert.equal(revision.body, "V1.");
    assert.equal(revision.livingDocumentId, document.id);

    // Exactly one document and one revision
    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(docs.length, 1);
    const revisions = await getLivingDocumentHistory(prisma, document.id);
    assert.equal(revisions.length, 1);
  } finally {
    await cleanupFixture("ld_create");
  }
});

test("reviseLivingDocument updates currentBody and creates revision atomically", async () => {
  const { group, account } = await createFixture("ld_revise");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Charter", body: "Original." });
    await reviseLivingDocument(prisma, { livingDocumentId: document.id, authorId: account.id, body: "Revised." });

    const updated = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(updated.currentBody, "Revised.");

    // Still exactly one LivingDocument -- identity preserved
    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(docs.length, 1);

    // Two revisions
    const revisions = await getLivingDocumentHistory(prisma, document.id);
    assert.equal(revisions.length, 2);
  } finally {
    await cleanupFixture("ld_revise");
  }
});

test("reviseLivingDocument throws when document is archived", async () => {
  const { group, account } = await createFixture("ld_revise_err");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Old", body: "V1." });
    await archiveLivingDocument(prisma, document.id);
    await assert.rejects(
      () => reviseLivingDocument(prisma, { livingDocumentId: document.id, authorId: account.id, body: "V2." }),
      /archived/i,
    );
  } finally {
    await cleanupFixture("ld_revise_err");
  }
});

test("multiple revisions accumulate; getLivingDocumentHistory returns newest first", async () => {
  const { group, account } = await createFixture("ld_history");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Doc", body: "V1." });
    await reviseLivingDocument(prisma, { livingDocumentId: document.id, authorId: account.id, body: "V2." });
    await reviseLivingDocument(prisma, { livingDocumentId: document.id, authorId: account.id, body: "V3." });

    const history = await getLivingDocumentHistory(prisma, document.id);
    assert.equal(history.length, 3);
    assert.equal(history[0].body, "V3."); // newest first
    assert.equal(history[2].body, "V1."); // oldest last
  } finally {
    await cleanupFixture("ld_history");
  }
});

test("getLivingDocumentHistory returns history even if document is archived", async () => {
  const { group, account } = await createFixture("ld_hist_arc");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Old", body: "V1." });
    await archiveLivingDocument(prisma, document.id);
    const history = await getLivingDocumentHistory(prisma, document.id);
    assert.equal(history.length, 1);
  } finally {
    await cleanupFixture("ld_hist_arc");
  }
});

test("archiveLivingDocument excludes document from default list", async () => {
  const { group, account } = await createFixture("ld_arc");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Old Charter", body: "V1." });
    await archiveLivingDocument(prisma, document.id);
    const active = await listLivingDocuments(prisma, "group", group.id);
    assert.equal(active.length, 0);
    const all = await listLivingDocuments(prisma, "group", group.id, { includeArchived: true });
    assert.equal(all.length, 1);
  } finally {
    await cleanupFixture("ld_arc");
  }
});

test("archiveLivingDocument is idempotent -- preserves first archivedAt", async () => {
  const { group, account } = await createFixture("ld_arc_idem");
  try {
    const { document } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "X", body: "Y." });
    await archiveLivingDocument(prisma, document.id);
    const first = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    await archiveLivingDocument(prisma, document.id);
    const second = await prisma.livingDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(first.archivedAt?.getTime(), second.archivedAt?.getTime());
  } finally {
    await cleanupFixture("ld_arc_idem");
  }
});

test("listLivingDocuments returns results in lastRevisedAt desc order", async () => {
  const { group, account } = await createFixture("ld_order");
  try {
    const { document: d1 } = await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "First", body: "V1." });
    await createLivingDocument(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Second", body: "V1." });
    // Revise d1 to make it more recently revised
    await reviseLivingDocument(prisma, { livingDocumentId: d1.id, authorId: account.id, body: "V2." });

    const docs = await listLivingDocuments(prisma, "group", group.id);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].id, d1.id); // d1 revised most recently
  } finally {
    await cleanupFixture("ld_order");
  }
});

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" } });
  const group = await prisma.group.create({ data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" } });
  const account = await prisma.account.create({ data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" } });
  return { node, group, account };
}

async function cleanupFixture(prefix: string) {
  await prisma.livingDocumentRevision.deleteMany({ where: { livingDocument: { spaceId: { startsWith: prefix } } } });
  await prisma.livingDocument.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
