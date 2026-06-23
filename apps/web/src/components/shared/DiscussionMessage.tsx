import { LocalTime } from "./LocalTime";

const MESSAGE_TIME: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * A single chat-style discussion message bubble, shared across the group/coalition/project/
 * responsibility discussion spaces. The viewer's own messages hug the right in the neutral
 * (theme-aware) surface color; everyone else's sit on the left in the blue used by the app's
 * badges. Author name is bold and slightly larger. The blue is a fixed Tailwind color (like
 * those badges) so it doesn't theme in dark mode — paired with fixed blue text it stays readable.
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
          isOwn ? "bg-[var(--subtle)]" : "border border-blue-100 bg-blue-50"
        }`}
      >
        <p className={`text-sm font-semibold ${isOwn ? "text-[var(--text)]" : "text-blue-900"}`}>{authorName}</p>
        <p className={`mt-0.5 text-sm leading-6 ${isOwn ? "text-[var(--soft-text)]" : "text-blue-900"}`}>{body}</p>
        {createdAtIso && (
          <p className={`mt-1 text-xs ${isOwn ? "text-[var(--muted)]" : "text-blue-700"}`}>
            <LocalTime value={createdAtIso} options={MESSAGE_TIME} />
          </p>
        )}
      </div>
    </div>
  );
}
