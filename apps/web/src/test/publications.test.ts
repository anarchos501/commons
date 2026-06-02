import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { addPublicationEntry, archivePublication, archivePublicationEntry, createPublication, getPublicationWithEntries, listPublications } from "../lib/publications";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("createPublication creates record with correct creator", async () => {
  const { group, account } = await createFixture("pub_create");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Meeting Notes" });
    assert.equal(pub.createdByAccountId, account.id);
    assert.equal(pub.title, "Meeting Notes");
  } finally {
    await cleanupFixture("pub_create");
  }
});

test("addPublicationEntry appends entry to publication", async () => {
  const { group, account } = await createFixture("pub_entry");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Notes" });
    const entry = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, title: "Jan", body: "January notes." });
    assert.equal(entry.publicationId, pub.id);
    assert.equal(entry.authorId, account.id);
  } finally {
    await cleanupFixture("pub_entry");
  }
});

test("addPublicationEntry throws when publication is archived", async () => {
  const { group, account } = await createFixture("pub_entry_err");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Old" });
    await archivePublication(prisma, pub.id);
    await assert.rejects(
      () => addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Attempt." }),
      /archived/i,
    );
  } finally {
    await cleanupFixture("pub_entry_err");
  }
});

test("archivePublicationEntry hides entry; publication still in active list", async () => {
  const { group, account } = await createFixture("pub_entry_arc");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Notes" });
    const entry = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Content." });
    await archivePublicationEntry(prisma, entry.id);
    const activePubs = await listPublications(prisma, "group", group.id);
    assert.equal(activePubs.length, 1);
    const result = await getPublicationWithEntries(prisma, pub.id);
    assert.equal(result.entries.length, 0);
  } finally {
    await cleanupFixture("pub_entry_arc");
  }
});

test("archivePublicationEntry is idempotent -- preserves first archivedAt", async () => {
  const { group, account } = await createFixture("pub_entry_idem");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Notes" });
    const entry = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Content." });
    await archivePublicationEntry(prisma, entry.id);
    const first = await prisma.publicationEntry.findUniqueOrThrow({ where: { id: entry.id } });
    await archivePublicationEntry(prisma, entry.id);
    const second = await prisma.publicationEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(first.archivedAt?.getTime(), second.archivedAt?.getTime());
  } finally {
    await cleanupFixture("pub_entry_idem");
  }
});

test("archivePublication hides collection; entries are not cascade-archived", async () => {
  const { group, account } = await createFixture("pub_arc");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "Guide" });
    await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Chapter 1." });
    await archivePublication(prisma, pub.id);

    const activePubs = await listPublications(prisma, "group", group.id);
    assert.equal(activePubs.length, 0);

    // Entries retain their own archivedAt -- not cascaded
    const entry = await prisma.publicationEntry.findFirstOrThrow({ where: { publicationId: pub.id } });
    assert.equal(entry.archivedAt, null);
  } finally {
    await cleanupFixture("pub_arc");
  }
});

test("archivePublication is idempotent -- preserves first archivedAt", async () => {
  const { group, account } = await createFixture("pub_arc_idem");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "X" });
    await archivePublication(prisma, pub.id);
    const first = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    await archivePublication(prisma, pub.id);
    const second = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    assert.equal(first.archivedAt?.getTime(), second.archivedAt?.getTime());
  } finally {
    await cleanupFixture("pub_arc_idem");
  }
});

test("listPublications excludes archived by default", async () => {
  const { group, account } = await createFixture("pub_list");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "A" });
    await archivePublication(prisma, pub.id);
    const active = await listPublications(prisma, "group", group.id);
    assert.equal(active.length, 0);
    const all = await listPublications(prisma, "group", group.id, { includeArchived: true });
    assert.equal(all.length, 1);
  } finally {
    await cleanupFixture("pub_list");
  }
});

test("getPublicationWithEntries returns an archived publication when fetched by ID", async () => {
  const { group, account } = await createFixture("pub_id_fetch");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "B" });
    await archivePublication(prisma, pub.id);
    const result = await getPublicationWithEntries(prisma, pub.id);
    assert.ok(result.archivedAt !== null);
  } finally {
    await cleanupFixture("pub_id_fetch");
  }
});

test("getPublicationWithEntries filters entries by archivedAt by default", async () => {
  const { group, account } = await createFixture("pub_filter");
  try {
    const pub = await createPublication(prisma, { spaceType: "group", spaceId: group.id, createdByAccountId: account.id, title: "C" });
    const e1 = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Active." });
    const e2 = await addPublicationEntry(prisma, { publicationId: pub.id, authorId: account.id, body: "Archived." });
    await archivePublicationEntry(prisma, e2.id);

    const result = await getPublicationWithEntries(prisma, pub.id);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].id, e1.id);

    const full = await getPublicationWithEntries(prisma, pub.id, { includeArchivedEntries: true });
    assert.equal(full.entries.length, 2);
  } finally {
    await cleanupFixture("pub_filter");
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
  // Resolve publication IDs first, then delete entries by ID to avoid FK issues
  const pubs = await prisma.publication.findMany({ where: { spaceId: { startsWith: prefix } }, select: { id: true } });
  if (pubs.length > 0) {
    await prisma.publicationEntry.deleteMany({ where: { publicationId: { in: pubs.map((p) => p.id) } } });
  }
  await prisma.publication.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
