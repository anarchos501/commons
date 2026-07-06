"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LocalTime } from "./LocalTime";

// Matches MESSAGE_TIME in DiscussionMessage so thread cards and bubbles read the same.
const THREAD_TIME: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

type ThreadItem = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityAtIso: string;
  // "New" = has activity the viewer hasn't seen. A boolean by design, never a count —
  // see the DiscussionThreadRead privacy boundary in schema.prisma.
  unread?: boolean;
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
            <span className={`text-[var(--text)] ${thread.unread ? "font-semibold" : "font-medium"}`}>
              {thread.title}
              {thread.unread && (
                <span className="ml-2 align-middle border border-[var(--notice-border)] bg-[var(--notice)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--notice-text)]">
                  New
                </span>
              )}
            </span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} &middot;{" "}
              <LocalTime value={thread.lastActivityAtIso} options={THREAD_TIME} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
