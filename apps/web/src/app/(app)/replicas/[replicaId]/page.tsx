import { notFound, redirect } from "next/navigation";
import { FormWithNotice } from "../../../../components/shared/FormWithNotice";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import type { StructuralManifest } from "../../../../lib/continuity-replication";
import { openTakeoverChallengeAction } from "./actions";

export const dynamic = "force-dynamic";

// F3.5 Tier-1 replica page (register F-8): a read-only window into a
// community homed elsewhere. No group machinery is touched — this renders
// the structural manifest and nothing else.

type PageProps = { params: Promise<{ replicaId: string }> };

export default async function ReplicaPage({ params }: PageProps) {
  const { replicaId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const prisma = createPrismaClient();
  try {
    const replica = await prisma.backupReplica.findUnique({
      where: { id: replicaId },
      include: { origin: true },
    });
    if (!replica || replica.status === "refused" || replica.status === "ended") notFound();

    const manifest = replica.manifest as StructuralManifest | null;
    const statusLabel = replica.status.replaceAll("_", " ");

    return (
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Backup replica — read-only · home: {replica.origin.domain}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-[var(--text)]">{replica.entityName}</h1>
            <p className="mt-1 text-sm text-[var(--soft-text)]">
              {replica.memberCount} members (as reported by the home node) · failover window {replica.windowHours}h ·{" "}
              <span className="capitalize">{statusLabel}</span>
              {replica.manifestSeq > 0 && <> · manifest #{replica.manifestSeq}</>}
              {replica.lastProofOfLifeAt && <> · last proof of life {replica.lastProofOfLifeAt.toISOString().slice(0, 16).replace("T", " ")} UTC</>}
            </p>
            {/* D-10 honesty: this tier is plaintext structure by design. */}
            <p className="mt-2 text-xs text-[var(--muted)]">
              This replica holds structural skeleton only — names, counts, timings — readable by this node&apos;s
              operator by design. The community&apos;s content is not here; the encrypted content archive arrives
              with a later phase, and this node will not be able to read that either.
            </p>
          </div>

          {replica.status === "challenge_open" && replica.challengeOpenedAt && (
            <div className="border border-[var(--border)] bg-[var(--subtle)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Challenge open</p>
              <p className="mt-1 text-sm text-[var(--soft-text)]">
                Opened {replica.challengeOpenedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. The home node —
                directly, or relayed through any peer, or vouched for by any peer that has heard from it — cancels
                this by proving life. If the full failover window passes in total silence, this replica activates
                for discussion.
              </p>
            </div>
          )}

          {replica.status === "active" && (
            <FormWithNotice action={openTakeoverChallengeAction} className="border border-[var(--border)] p-4">
              <input type="hidden" name="replicaId" value={replica.id} />
              <p className="text-sm text-[var(--soft-text)]">
                Can&apos;t reach this community&apos;s home node? Opening a challenge gives it the full failover
                window ({replica.windowHours}h) to prove life. One click starts the clock; nothing activates
                without the window passing in total silence.
              </p>
              <div className="mt-2">
                <SubmitButton variant="secondary">Report home unreachable</SubmitButton>
              </div>
            </FormWithNotice>
          )}

          {manifest ? (
            <div className="space-y-4">
              <div className="border border-[var(--border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Open petitions (skeleton)</p>
                {manifest.petitions.length === 0 ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">None in the last manifest.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {manifest.petitions.map((petition) => (
                      <li key={petition.id} className="text-sm text-[var(--soft-text)]">
                        <span className="capitalize">{petition.familyLabel.replaceAll("_", " ")}</span> ·{" "}
                        <span className="capitalize">{petition.status}</span> · closes {petition.closesAt.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border border-[var(--border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Upcoming events (timing skeleton)</p>
                {manifest.calendar.length === 0 ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">None in the last manifest.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {manifest.calendar.map((event) => (
                      <li key={event.id} className="text-sm text-[var(--soft-text)]">
                        {event.startTime.slice(0, 16).replace("T", " ")} UTC — {event.title ?? "(title withheld — not a public event)"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No manifest replicated yet.</p>
          )}
        </div>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}
