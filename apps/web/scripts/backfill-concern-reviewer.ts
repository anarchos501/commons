import { createPrismaClient } from "../src/lib/prisma";
import { CONCERN_REVIEWER_TYPE, provisionConcernReviewer } from "../src/lib/concern-reviewer";

/**
 * One-shot production data repair: groups created before the Concern Reviewer role was
 * auto-provisioned have no accountability path. This backfills the role (and its abilities)
 * for every group that lacks it. Idempotent — re-running is a no-op.
 *
 *   pnpm --filter web backfill:concern-reviewer   (or: tsx scripts/backfill-concern-reviewer.ts)
 */
async function main() {
  const prisma = createPrismaClient();
  try {
    const groups = await prisma.group.findMany({
      where: { responsibilities: { none: { type: CONCERN_REVIEWER_TYPE } } },
      select: { id: true, name: true },
    });

    console.log(`Found ${groups.length} group(s) without a Concern Reviewer role.`);
    let provisioned = 0;
    for (const group of groups) {
      await provisionConcernReviewer(prisma, group.id);
      provisioned++;
      console.log(`  provisioned: ${group.name} (${group.id})`);
    }
    console.log(`Done. Provisioned ${provisioned} group(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
