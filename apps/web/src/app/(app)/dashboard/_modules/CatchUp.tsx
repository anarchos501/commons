import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import type { CatchUpGroupDigest } from "../../../../lib/catch-up";

// "While you were away" — a calm, sticky digest of what changed in each space since you last visited
// it. Concern lines only appear where the helper deemed you entitled (reviewer seat). Quiet when
// empty; never a badge or count-on-the-chrome.

function summaryLine(d: CatchUpGroupDigest): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (d.resolvedPetitions) parts.push(`${plural(d.resolvedPetitions, "petition")} resolved`);
  if (d.newPosts) parts.push(`${plural(d.newPosts, "new post")}`);
  if (d.routedToYou) parts.push(`${plural(d.routedToYou, "request")} routed to you`);
  if (d.newMembers) parts.push(`${plural(d.newMembers, "new member")}`);
  if (d.newConcerns) parts.push(`${plural(d.newConcerns, "new concern")}`);
  return parts.join(" · ");
}

export function CatchUp({ digests }: { digests: CatchUpGroupDigest[] }) {
  if (digests.length === 0) return null;
  return (
    <CollapsibleSection id="catch-up" title="Catch up" eyebrow="While you were away" storageKey="dashboard:catch-up" className="bg-[var(--surface)] p-5 sm:p-6">
      <ul className="space-y-2">
        {digests.map((d) => (
          <li key={d.groupId} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
            <a href={`/groups/${d.groupId}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{d.groupName}</a>
            <p className="mt-0.5 text-xs text-[var(--soft-text)]">{summaryLine(d)}</p>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
