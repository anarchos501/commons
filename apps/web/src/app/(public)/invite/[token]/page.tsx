import Link from "next/link";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { resolveGroupInviteToken } from "../../../../lib/group-invites";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;
  const session = await getSession();
  const accountId = session.accountId ?? null;

  const prisma = createPrismaClient();
  let result: Awaited<ReturnType<typeof resolveGroupInviteToken>>;
  try {
    result = await resolveGroupInviteToken(prisma, token);
  } finally {
    await prisma.$disconnect();
  }

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "This invite link has expired. Ask a group member to generate a new one."
        : "This invite link is no longer valid.";
    return (
      <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md">
          <div className="border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--soft-text)]">{message}</p>
          </div>
        </div>
      </main>
    );
  }

  const { groupId, groupName, membershipPolicy } = result;
  const joinsDirectly = membershipPolicy === "open";
  const joinHref = `/groups/${groupId}/join?invite=${encodeURIComponent(token)}`;
  const loginHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md">
        <div className="border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Group Invitation</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-[var(--text)]">{groupName}</h1>
          </div>
          <p className="text-sm text-[var(--soft-text)]">
            You have been invited to join <strong>{groupName}</strong>.
            {joinsDirectly
              ? " This group is open to join directly with a valid invite link."
              : " Submitting an application creates a pending request — an active member must sponsor you before a petition opens and your membership can be approved."}
          </p>
          {accountId ? (
            <Link
              href={joinHref}
              className="inline-flex items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
            >
              {joinsDirectly ? "Join Group" : "Apply to Join"}
            </Link>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)]">You need to be signed in to apply.</p>
              <Link
                href={loginHref}
                className="inline-flex items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
              >
                {joinsDirectly ? "Sign in to join" : "Sign in to apply"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
