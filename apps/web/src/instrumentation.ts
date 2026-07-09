export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createPrismaClient } = await import("./lib/prisma");
  const { resolveExpiredPetitions } = await import("./lib/petition-evaluation");
  const { deliverPendingFederationEvents, httpsFederationTransport } = await import("./lib/federation-outbox");
  const { resolveExpiredFederationProposals } = await import("./lib/federations");
  const { resolveExpiredCrossNodeCoalitionProposals } = await import("./lib/federated-coalitions");
  const { runContinuityReplicationSweep } = await import("./lib/continuity-replication");
  const { runContinuityHeartbeat } = await import("./lib/continuity");
  const { markUnverifiedAtBoot, runQuietBootVerification } = await import("./lib/continuity-boot");
  const { runTakeoverActivationSweep } = await import("./lib/continuity-takeover");

  const prisma = createPrismaClient();

  // Quiet-boot (register F-9): FIRST, before any tick runs — a node that
  // just started must not trust its own DB about backed-up entities until
  // it has verified with each backup. Serving starts immediately; those
  // entities are simply read-only for the seconds this takes (the
  // documented restart blip — see DEPLOYMENT.md).
  try {
    await markUnverifiedAtBoot(prisma);
  } catch (err) {
    console.error("[continuity] markUnverifiedAtBoot failed", err);
  }
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
      await runContinuityReplicationSweep(prisma);
      await runContinuityHeartbeat(prisma);
      await runQuietBootVerification(prisma);
      await runTakeoverActivationSweep(prisma);
    } catch (err) {
      console.error("[federation] outbox sweep failed", err);
    } finally {
      setTimeout(federationTick, FEDERATION_SWEEP_INTERVAL_MS);
    }
  };

  tick();
  federationTick();
}
