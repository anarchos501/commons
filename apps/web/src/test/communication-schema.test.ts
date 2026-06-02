import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

// --- Bulletin ---

test("Bulletin can be created for a group space and queried by spaceType+spaceId", async () => {
  const { group, account } = await createFixture("bul_group");
  try {
    await prisma.bulletin.create({
      data: { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Hello", body: "Welcome." },
    });
    const results = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: group.id, archivedAt: null } });
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Hello");
  } finally {
    await cleanupFixture("bul_group");
  }
});

test("Bulletin can be created for a project space", async () => {
  const { project, account } = await createFixture("bul_project");
  try {
    await prisma.bulletin.create({
      data: { spaceType: "project", spaceId: project.id, authorId: account.id, title: "Update", body: "Project news." },
    });
    const results = await prisma.bulletin.findMany({ where: { spaceType: "project", spaceId: project.id, archivedAt: null } });
    assert.equal(results.length, 1);
  } finally {
    await cleanupFixture("bul_project");
  }
});

test("Bulletin can be created for a responsibility space", async () => {
  const { responsibility, account } = await createFixture("bul_resp");
  try {
    await prisma.bulletin.create({
      data: { spaceType: "responsibility", spaceId: responsibility.id, authorId: account.id, title: "Notice", body: "Reviewer update." },
    });
    const results = await prisma.bulletin.findMany({ where: { spaceType: "responsibility", spaceId: responsibility.id, archivedAt: null } });
    assert.equal(results.length, 1);
  } finally {
    await cleanupFixture("bul_resp");
  }
});

test("archived Bulletin is excluded from archivedAt: null query", async () => {
  const { group, account } = await createFixture("bul_archive");
  try {
    const b = await prisma.bulletin.create({
      data: { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Old", body: "Old news." },
    });
    await prisma.bulletin.update({ where: { id: b.id }, data: { archivedAt: new Date() } });

    const active = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: group.id, archivedAt: null } });
    assert.equal(active.length, 0);

    // Archived record is still preserved
    const all = await prisma.bulletin.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(all.length, 1);
  } finally {
    await cleanupFixture("bul_archive");
  }
});

// --- Publication + PublicationEntry ---

test("Publication records creator; PublicationEntry records author; creator and author can differ", async () => {
  const { group, account, account2 } = await createFixture("pub_creator");
  try {
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: group.id, title: "Meeting Notes", createdByAccountId: account.id },
    });
    await prisma.publicationEntry.create({
      data: { publicationId: pub.id, authorId: account2.id, title: "January", body: "Notes from January." },
    });

    const loaded = await prisma.publication.findUniqueOrThrow({
      where: { id: pub.id },
      include: { creator: true, entries: { include: { author: true } } },
    });
    assert.equal(loaded.creator.id, account.id);
    assert.equal(loaded.entries[0].author.id, account2.id);
    assert.notEqual(loaded.creator.id, loaded.entries[0].author.id);
  } finally {
    await cleanupFixture("pub_creator");
  }
});

test("archiving a PublicationEntry hides the entry; Publication remains visible", async () => {
  const { group, account } = await createFixture("pub_entry_archive");
  try {
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: group.id, title: "Notes", createdByAccountId: account.id },
    });
    const entry = await prisma.publicationEntry.create({
      data: { publicationId: pub.id, authorId: account.id, body: "Content." },
    });
    await prisma.publicationEntry.update({ where: { id: entry.id }, data: { archivedAt: new Date() } });

    // Publication still active
    const activePubs = await prisma.publication.findMany({ where: { spaceType: "group", spaceId: group.id, archivedAt: null } });
    assert.equal(activePubs.length, 1);

    // Entry filtered out
    const activeEntries = await prisma.publicationEntry.findMany({ where: { publicationId: pub.id, archivedAt: null } });
    assert.equal(activeEntries.length, 0);

    // Entry preserved
    const allEntries = await prisma.publicationEntry.findMany({ where: { publicationId: pub.id } });
    assert.equal(allEntries.length, 1);
  } finally {
    await cleanupFixture("pub_entry_archive");
  }
});

test("archiving a Publication hides the collection; entries not individually queried from active list", async () => {
  const { group, account } = await createFixture("pub_archive");
  try {
    const pub = await prisma.publication.create({
      data: { spaceType: "group", spaceId: group.id, title: "Old Guide", createdByAccountId: account.id },
    });
    await prisma.publicationEntry.create({ data: { publicationId: pub.id, authorId: account.id, body: "Chapter 1." } });
    await prisma.publication.update({ where: { id: pub.id }, data: { archivedAt: new Date() } });

    // Publication hidden from active views
    const activePubs = await prisma.publication.findMany({ where: { spaceType: "group", spaceId: group.id, archivedAt: null } });
    assert.equal(activePubs.length, 0);

    // Both publication and entry are preserved (archived != deleted)
    const allPubs = await prisma.publication.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(allPubs.length, 1);
    const allEntries = await prisma.publicationEntry.findMany({ where: { publicationId: pub.id } });
    assert.equal(allEntries.length, 1);
  } finally {
    await cleanupFixture("pub_archive");
  }
});

// --- LivingDocument + LivingDocumentRevision ---

test("LivingDocument currentBody is set; revision creates a LivingDocumentRevision, not a new LivingDocument", async () => {
  const { group, account } = await createFixture("ld_identity");
  try {
    const doc = await prisma.livingDocument.create({
      data: { spaceType: "group", spaceId: group.id, title: "Mission", currentBody: "V1 body." },
    });
    await prisma.livingDocumentRevision.create({
      data: { livingDocumentId: doc.id, authorId: account.id, body: "V2 body." },
    });
    // Update currentBody to reflect the revision
    await prisma.livingDocument.update({ where: { id: doc.id }, data: { currentBody: "V2 body.", lastRevisedAt: new Date() } });

    const docs = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(docs.length, 1, "only one LivingDocument should exist; identity preserved across revisions");
    assert.equal(docs[0].currentBody, "V2 body.");

    const revisions = await prisma.livingDocumentRevision.findMany({ where: { livingDocumentId: doc.id } });
    assert.equal(revisions.length, 1);
  } finally {
    await cleanupFixture("ld_identity");
  }
});

test("LivingDocument unique constraint prevents duplicate titles in the same space", async () => {
  const { group } = await createFixture("ld_unique");
  try {
    await prisma.livingDocument.create({
      data: { spaceType: "group", spaceId: group.id, title: "Charter", currentBody: "V1." },
    });
    await assert.rejects(
      () => prisma.livingDocument.create({
        data: { spaceType: "group", spaceId: group.id, title: "Charter", currentBody: "Duplicate." },
      }),
      // Prisma unique constraint violation
      /unique/i,
    );
  } finally {
    await cleanupFixture("ld_unique");
  }
});

test("LivingDocument archived is preserved but hidden from active queries", async () => {
  const { group } = await createFixture("ld_archive");
  try {
    const doc = await prisma.livingDocument.create({
      data: { spaceType: "group", spaceId: group.id, title: "Old Charter", currentBody: "Superseded." },
    });
    await prisma.livingDocument.update({ where: { id: doc.id }, data: { archivedAt: new Date() } });

    const active = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: group.id, archivedAt: null } });
    assert.equal(active.length, 0);

    const all = await prisma.livingDocument.findMany({ where: { spaceType: "group", spaceId: group.id } });
    assert.equal(all.length, 1);
  } finally {
    await cleanupFixture("ld_archive");
  }
});

// --- Fixtures ---

async function createFixture(prefix: string) {
  await cleanupFixture(prefix);

  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
  });

  const group = await prisma.group.create({
    data: { id: `${prefix}_group`, nodeId: node.id, name: `Group ${prefix}`, membershipPolicy: "open" },
  });

  const account = await prisma.account.create({
    data: { id: `${prefix}_account`, homeNodeId: node.id, displayName: `User ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const account2 = await prisma.account.create({
    data: { id: `${prefix}_account2`, homeNodeId: node.id, displayName: `User2 ${prefix}`, accountType: "member", profileVisibility: "private" },
  });

  const project = await prisma.project.create({
    data: { id: `${prefix}_project`, groupId: group.id, name: `Project ${prefix}`, status: "active" },
  });

  await prisma.projectHosting.create({ data: { projectId: project.id, groupId: group.id } });

  const responsibility = await prisma.responsibility.create({
    data: { id: `${prefix}_responsibility`, groupId: group.id, type: "reviewer" },
  });

  return { node, group, account, account2, project, responsibility };
}

async function cleanupFixture(prefix: string) {
  await prisma.livingDocumentRevision.deleteMany({ where: { livingDocument: { spaceId: { startsWith: prefix } } } });
  await prisma.livingDocument.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.publicationEntry.deleteMany({ where: { publication: { spaceId: { startsWith: prefix } } } });
  await prisma.publication.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.bulletin.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.responsibilityAbility.deleteMany({ where: { responsibilityId: { startsWith: prefix } } });
  await prisma.responsibility.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.projectHosting.deleteMany({ where: { projectId: { startsWith: prefix } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
