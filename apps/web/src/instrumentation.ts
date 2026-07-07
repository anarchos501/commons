export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createPrismaClient } = await import("./lib/prisma");
  const { resolveExpiredPetitions } = await import("./lib/petition-evaluation");
  const { deliverPendingFederationEvents, httpsFederationTransport } = await import("./lib/federation-outbox");
  const { resolveExpiredFederationProposals } = await import("./lib/federations");
  const { resolveExpiredCrossNodeCoalitionProposals } = await import("./lib/federated-coalitions");

  const prisma = createPrismaClient();
  const SWEEP_INTERVAL_MS = 60_000;
  const FEDERATION_SWEEP_INTERVAL_MS = 30_000;

  const tick = async () => {
    try {
      await resolveExpiredPetitions(prisma);
    } catch (err) {
      console.error("[petitions] sweep failed", err);
    } finally {
      setTimeout(tick, SWEEP_INTERVAL_MS);
    }
  };

  // Outbox delivery is asynchronous by design: a dead peer degrades
  // cross-node delivery, never local operation (plan §4).
  const federationTransport = httpsFederationTransport();
  const federationTick = async () => {
    try {
      await deliverPendingFederationEvents(prisma, federationTransport);
      // Cross-node proposals need a clock of their own: once the local
      // petition resolves, only remote decisions or this timeout sweep can
      // finish them.
      await resolveExpiredFederationProposals(prisma);
      await resolveExpiredCrossNodeCoalitionProposals(prisma);
    } catch (err) {
      console.error("[federation] outbox sweep failed", err);
    } finally {
      setTimeout(federationTick, FEDERATION_SWEEP_INTERVAL_MS);
    }
  };

  tick();
  federationTick();
}
