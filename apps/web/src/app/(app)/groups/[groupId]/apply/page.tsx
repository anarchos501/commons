import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../../lib/prisma";
import { getSession } from "../../../../../lib/session";
import { applyForGroupMembership } from "../../../../../lib/group-membership";
import { FormWithNotice } from "../../../../../components/shared/FormWithNotice";
import { type FormState } from "../../../../../components/shared/form-state";
import { SubmitButton } from "../../../../../components/shared/SubmitButton";
import { AlphaNotice } from "../../../../../components/shared/Notice";

function applyFailureMessage(reason: string): string {
  switch (reason) {
    case "already_member": return "You are already a member of this collective.";
    case "already_applied": return "Your application is already pending.";
    case "revoked": return "Your membership here was revoked and cannot be reapplied.";
    case "group_not_found": return "This collective no longer exists.";
    default: return "Could not submit your application.";
  }
}

export default async function ApplyToGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect(`/login`);
  const accountId = session.accountId;

  const prisma = createPrismaClient();
  let view:
    | { kind: "form"; name: string; description: string | null }
    | { kind: "pending"; name: string };
  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, description: true, membershipPolicy: true, visibility: true },
    });
    if (!group) redirect("/groups");
    // Open groups join immediately; private groups are joined via invite — neither uses this form.
    if (group.membershipPolicy === "open") redirect(`/groups/${groupId}/join`);
    if (group.visibility !== "public") redirect("/groups");

    const membership = await prisma.groupMembership.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
      select: { status: true },
    });
    if (membership?.status === "active") redirect(`/groups/${groupId}`);

    view =
      membership?.status === "pending"
        ? { kind: "pending", name: group.name }
        : { kind: "form", name: group.name, description: group.description };
  } finally {
    await prisma.$disconnect();
  }

  async function applyToGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const note = formData.get("note");
    const prismaInner = createPrismaClient();
    try {
      const result = await applyForGroupMembership(
        prismaInner,
        s.accountId,
        groupId,
        typeof note === "string" && note.trim() ? note.trim() : undefined,
      );
      if (!result.ok) return { kind: "error", message: applyFailureMessage(result.reason) };
    } finally {
      await prismaInner.$disconnect();
    }
    revalidatePath(`/groups/${groupId}/apply`);
    return { kind: "success", message: "Your application is pending." };
  }

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <AlphaNotice />
        <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Apply to join</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)]">{view.name}</h1>

          {view.kind === "pending" ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-[var(--soft-text)]">
                Your application is pending. Active members can sponsor it for a membership vote. You can track or
                withdraw it from your dashboard.
              </p>
              <Link href="/dashboard" className="text-sm text-[var(--accent)] hover:underline">Go to dashboard</Link>
            </div>
          ) : (
            <>
              {view.description && <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{view.description}</p>}
              <p className="mt-3 text-sm text-[var(--soft-text)]">
                This collective reviews applications. Submit a short note for members reviewing your request.
              </p>
              <FormWithNotice action={applyToGroupAction} className="mt-4 space-y-3">
                <label className="block">
                  <span className="field-label">Optional note</span>
                  <textarea
                    name="note"
                    maxLength={2000}
                    rows={4}
                    className="field-input resize-y"
                    placeholder="Share anything members should know about your request to join."
                  />
                </label>
                <SubmitButton variant="secondary">Submit application</SubmitButton>
              </FormWithNotice>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
