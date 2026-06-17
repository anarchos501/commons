export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createPrismaClient } = await import("./lib/prisma");
  const { resolveExpiredPetitions } = await import("./lib/petition-evaluation");

  const prisma = createPrismaClient();
  const SWEEP_INTERVAL_MS = 60_000;

  const tick = async () => {
    try {
      await resolveExpiredPetitions(prisma);
    } catch (err) {
      console.error("[petitions] sweep failed", err);
    } finally {
      setTimeout(tick, SWEEP_INTERVAL_MS);
    }
  };

  tick();
}
