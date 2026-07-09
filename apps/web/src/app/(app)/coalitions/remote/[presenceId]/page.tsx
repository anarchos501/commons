import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlphaNotice } from "../../../../../components/shared/Notice";
import { EmptyState } from "../../../../../components/shared/EmptyState";
import { SubmitButton } from "../../../../../components/shared/SubmitButton";
import { postFederatedCoalitionMessage } from "../../../../../lib/federated-coalitions";
import { createPrismaClient } from "../../../../../lib/prisma";
import { getSession } from "../../../../../lib/session";
import { requiredString } from "../../../../../lib/support-form";

export const dynamic = "force-dynamic";

// Member-side view of a coalition homed on another node (plan §5: aggregated
// reads, routed writes). Reads come from the local relay cache — never a
// synchronous cross-node fetch; writes route to the coalition's home node and
// the UI says so (the node tag is the always-visible honesty affordance).
export default async function RemoteCoalitionPage({ params }: { params: Promise<{ presenceId: string }> }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const { presenceId } = await params;

  const prisma = createPrismaClient();
  try {
    const presence = await prisma.federatedCoalitionPresence.findUnique({
      where: { id: presenceId },
      include: {
        homeFederatedNode: { select: { domain: true, displayName: true, status: true } },
        group: { select: { id: true, name: true } },
        messages: { orderBy: { postedAt: "asc" }, take: 200 },
      },
    });
    if (!presence) redirect("/dashboard");
    // Reads are scoped to the member group's own people — the coalition's
    // disclosure boundary (A3).
    const membership = await prisma.groupMembership.findFirst({
      where: { accountId: session.accountId, groupId: presence.group.id, status: "active" },
      select: { id: true },
    });
    if (!membership) redirect("/dashboard");

    const homeLabel = presence.homeFederatedNode.displayName ?? presence.homeFederatedNode.domain;

    return (
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <AlphaNotice />
          <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Cross-node coalition
            </span>
            <h1 className="mt-1 text-2xl font-bold text-[var(--text)]">{presence.name}</h1>
            {/* The node tag: quiet, always-visible, honest (plan §5). */}
            <p className="mt-1 text-xs text-[var(--muted)]">
              Home: <span className="font-medium text-[var(--soft-text)]">@ {presence.homeFederatedNode.domain}</span>
              {" · "}your collective: {presence.group.name} · <span className="capitalize">{presence.status}</span>
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              This coalition lives on {homeLabel}. What you read here is your node&apos;s cached copy of the
              shared thread, refreshed by deliveries from the home node; what you write is routed to
              {" "}{presence.homeFederatedNode.domain} and lands under that community&apos;s rules.
            </p>

            <div className="mt-4 space-y-2">
              {presence.messages.length === 0 ? (
                <EmptyState text="No shared messages cached yet." />
              ) : (
                presence.messages.map((message) => (
                  <div key={message.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                    <p className="text-xs text-[var(--muted)]">
                      {message.authorLabel} · {message.postedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{message.body}</p>
                  </div>
                ))
              )}
            </div>

            {presence.status === "active" && presence.homeFederatedNode.status === "active" && (
              <form action={postRemoteCoalitionMessageAction} className="mt-4 space-y-3">
                <input type="hidden" name="presenceId" value={presence.id} />
                <label className="block">
                  <span className="field-label">Post to the shared thread</span>
                  <textarea name="body" required rows={2} className="field-input" />
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    This posts to {presence.homeFederatedNode.domain} — the coalition&apos;s home node.
                  </span>
                </label>
                <SubmitButton variant="secondary">Send to {homeLabel}</SubmitButton>
              </form>
            )}

            {presence.status === "active" && (
              <form action={withdrawRemoteCoalitionBackupAction} className="mt-4 border-t border-[var(--border)] pt-3">
                <input type="hidden" name="presenceId" value={presence.id} />
                {/* The same unilateral door local member groups have (register
                    F-8): membership is not tiered by where a group's data lives. */}
                <p className="text-xs text-[var(--muted)]">
                  If this coalition holds a backup designation, your collective can withdraw its consent through
                  its own petition — one collective&apos;s withdrawal revokes the backup for everyone, because the
                  designation stands on unanimous member consent.
                </p>
                <div className="mt-2">
                  <SubmitButton variant="secondary">Open backup-withdrawal petition</SubmitButton>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function withdrawRemoteCoalitionBackupAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const presenceId = requiredString(formData, "presenceId");
  const prisma = createPrismaClient();
  try {
    const presence = await prisma.federatedCoalitionPresence.findUnique({
      where: { id: presenceId },
      select: { coalitionId: true, groupId: true },
    });
    if (!presence) return;
    const membership = await prisma.groupMembership.findFirst({
      where: { accountId: session.accountId, groupId: presence.groupId, status: "active", participationStatus: "active" },
      select: { id: true },
    });
    if (!membership) return;
    const { proposeCoalitionBackupWithdrawal } = await import("../../../../../lib/federated-coalitions");
    await proposeCoalitionBackupWithdrawal(prisma, {
      coalitionId: presence.coalitionId,
      groupId: presence.groupId,
      createdByMembershipId: membership.id,
    });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/remote/${presenceId}`);
}

async function postRemoteCoalitionMessageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const presenceId = requiredString(formData, "presenceId");
  const body = requiredString(formData, "body");
  const prisma = createPrismaClient();
  try {
    await postFederatedCoalitionMessage(prisma, { accountId: session.accountId, presenceId, body });
  } finally {
    await prisma.$disconnect();
  }
  revalidatePath(`/coalitions/remote/${presenceId}`);
}
