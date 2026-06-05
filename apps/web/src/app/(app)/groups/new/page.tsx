import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { resolveCurrentNode } from "../../../../lib/node-context";
import { createGroup } from "../../../../lib/group-settings";
import { SubmitButton } from "../../../../components/shared/SubmitButton";
import { Notice } from "../../../../components/shared/Notice";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CreateGroupPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <Link href="/groups" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Find Groups
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Create Group</h1>
          <p className="mt-1 text-sm text-[var(--soft-text)]">
            New groups start private. You can invite people or later petition to make the group publicly discoverable.
          </p>
        </header>

        {notice && <Notice message={notice} />}

        <form action={createGroupAction} className="space-y-5 border border-[var(--border)] bg-[var(--surface)] p-5">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1" htmlFor="name">
              Group Name
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="Northside Mutual Aid"
              className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1" htmlFor="description">
              Description <span className="font-normal text-[var(--muted)]">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="What does this group do, and who is it for?"
              className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
            />
          </div>
          <SubmitButton>Create Group</SubmitButton>
        </form>
      </div>
    </main>
  );
}

async function createGroupAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() || undefined;
  if (!name) redirect("/groups/new?notice=Group+name+is+required.");

  const prisma = createPrismaClient();
  let groupId: string;
  try {
    const node = await resolveCurrentNode(prisma);
    if (!node) redirect("/dashboard?notice=No+node+configured.");

    const result = await createGroup(prisma, {
      nodeId: node.id,
      name,
      description,
      creatorAccountId: session.accountId,
    });

    if (!result.ok) {
      redirect(`/groups/new?notice=${encodeURIComponent("A group with that name already exists.")}`);
    }
    groupId = result.groupId;
    session.activeGroupId = groupId;
    await session.save();
  } finally {
    await prisma.$disconnect();
  }
  redirect(`/groups/${groupId}`);
}
