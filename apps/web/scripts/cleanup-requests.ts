import { createPrismaClient } from "../src/lib/prisma";
import { redactSupportRequestIfEligible } from "../src/lib/request-lifecycle";

async function main() {
  const prisma = createPrismaClient();
  try {
    // Candidates: terminal-status requests whose description has not yet been cleared.
    // redactSupportRequestIfEligible handles the window check for each one.
    const candidates = await prisma.supportRequest.findMany({
      where: {
        description: { not: "" },
        status: { in: ["fulfilled", "expired", "deleted"] },
      },
      select: { id: true },
    });

    console.log(`Found ${candidates.length} candidate request(s).`);
    let redacted = 0;
    let stillOpen = 0;
    let skipped = 0;

    for (const { id } of candidates) {
      const result = await redactSupportRequestIfEligible(prisma, id);
      if (result === "redacted") redacted++;
      else if (result === "window_still_open") stillOpen++;
      else skipped++;
    }

    console.log(`Redacted: ${redacted}  |  Window still open: ${stillOpen}  |  Skipped: ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
