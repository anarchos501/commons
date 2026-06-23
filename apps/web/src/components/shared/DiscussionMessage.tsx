import { LocalTime } from "./LocalTime";

const MESSAGE_TIME: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * A single chat-style discussion message bubble, shared across the group/coalition/project/
 * responsibility discussion spaces. The viewer's own messages hug the right in the neutral
 * surface color; everyone else's sit on the left in the teal "notice" palette (the same
 * theme-aware tokens as the Open Alpha banner), so both bubbles adapt to light/dark mode.
 * Author name is bold and slightly larger.
 */
export function DiscussionMessage({
  body,
  authorName,
  authorId,
  viewerAccountId,
  createdAtIso,
}: {
  body: string;
  authorName: string;
  authorId: string | null;
  viewerAccountId: string | null;
  createdAtIso?: string;
}) {
  // Defensive: a null/absent author or viewer renders as "other" — never matches a null, never throws.
  const isOwn = !!viewerAccountId && authorId === viewerAccountId;

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 ${
          isOwn ? "bg-[var(--subtle)]" : "border border-[var(--notice-border)] bg-[var(--notice)]"
        }`}
      >
        <p className={`text-sm font-semibold ${isOwn ? "text-[var(--text)]" : "text-[var(--notice-text)]"}`}>{authorName}</p>
        <p className={`mt-0.5 text-sm leading-6 ${isOwn ? "text-[var(--soft-text)]" : "text-[var(--notice-text)]"}`}>{body}</p>
        {createdAtIso && (
          <p className={`mt-1 text-xs ${isOwn ? "text-[var(--muted)]" : "text-[var(--notice-text)] opacity-70"}`}>
            <LocalTime value={createdAtIso} options={MESSAGE_TIME} />
          </p>
        )}
      </div>
    </div>
  );
}
