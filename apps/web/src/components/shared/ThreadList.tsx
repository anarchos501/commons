"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type ThreadItem = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityLabel: string;
};

export function ThreadList({
  threads,
  selectedThreadId,
}: {
  threads: ThreadItem[];
  selectedThreadId: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="space-y-2">
      {threads.map((thread) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("discussionThread", thread.id);
        const href = `${pathname}?${params.toString()}`;
        const isSelected = selectedThreadId === thread.id;
        return (
          <Link
            key={thread.id}
            href={href}
            replace
            scroll={false}
            aria-current={isSelected ? "true" : undefined}
            className={`block border p-3 text-sm transition hover:bg-[var(--hover)] ${
              isSelected
                ? "border-[var(--accent)] bg-[var(--subtle)]"
                : "border-[var(--border)]"
            }`}
          >
            <span className="font-medium text-[var(--text)]">{thread.title}</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} &middot; {thread.lastActivityLabel}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
