import { createPrismaClient } from "../src/lib/prisma";
import { deleteExpiredDiscussionContent } from "../src/lib/discussions";

async function main() {
  const prisma = createPrismaClient();
  try {
    const groups = await prisma.group.findMany({ select: { id: true } });
    for (const group of groups) {
      const result = await deleteExpiredDiscussionContent(prisma, { groupId: group.id });
      console.log(
        `discussion cleanup group=${group.id} messages=${result.deletedMessages} threads=${result.deletedThreads}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
