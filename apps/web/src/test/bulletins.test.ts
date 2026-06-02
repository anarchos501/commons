import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { archiveBulletin, createBulletin, listBulletins } from "../lib/bulletins";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("createBulletin creates record; listBulletins returns it by space", async () => {
  const { group, account } = await createFixture("blt_create");
  try {
    await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Hello", body: "Welcome." });
    const results = await listBulletins(prisma, "group", group.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Hello");
  } finally {
    await cleanupFixture("blt_create");
  }
});

test("archiveBulletin excludes bulletin from default list", async () => {
  const { group, account } = await createFixture("blt_archive");
  try {
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Old", body: "Old." });
    await archiveBulletin(prisma, b.id);
    const active = await listBulletins(prisma, "group", group.id);
    assert.equal(active.length, 0);
  } finally {
    await cleanupFixture("blt_archive");
  }
});

test("archiveBulletin is idempotent -- preserves first archivedAt", async () => {
  const { group, account } = await createFixture("blt_idem");
  try {
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "X", body: "Y." });
    await archiveBulletin(prisma, b.id);
    const first = await prisma.bulletin.findUniqueOrThrow({ where: { id: b.id } });
    await archiveBulletin(prisma, b.id);
    const second = await prisma.bulletin.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(first.archivedAt?.getTime(), second.archivedAt?.getTime());
  } finally {
    await cleanupFixture("blt_idem");
  }
});

test("listBulletins includes archived when flag is set", async () => {
  const { group, account } = await createFixture("blt_incl");
  try {
    const b = await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "A", body: "B." });
    await archiveBulletin(prisma, b.id);
    const all = await listBulletins(prisma, "group", group.id, { includeArchived: true });
    assert.equal(all.length, 1);
  } finally {
    await cleanupFixture("blt_incl");
  }
});

test("listBulletins returns results in publishedAt desc order", async () => {
  const { group, account } = await createFixture("blt_order");
  try {
    await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "First", body: "." });
    await createBulletin(prisma, { spaceType: "group", spaceId: group.id, authorId: account.id, title: "Second", body: "." });
    const results = await listBulletins(prisma, "group", group.id);
    assert.equal(results.length, 2);
    assert.ok(results[0].publishedAt >= results[1].publishedAt);
  } finally {
    await cleanupFixture("blt_order");
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
  await prisma.bulletin.deleteMany({ where: { spaceId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
