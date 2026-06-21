import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { catchUpSummaryLine, type CatchUpGroupDigest } from "../../../../lib/catch-up";

// "While you were away" — a calm, sticky digest of what changed in each space since you last visited
// it. Concern lines only appear where the helper deemed you entitled (reviewer seat). Quiet when
// empty; never a badge or count-on-the-chrome.

export function CatchUp({ digests }: { digests: CatchUpGroupDigest[] }) {
  if (digests.length === 0) return null;
  return (
    <CollapsibleSection id="catch-up" title="Catch up" eyebrow="While you were away" storageKey="dashboard:catch-up" className="bg-[var(--surface)] p-5 sm:p-6">
      <ul className="space-y-2">
        {digests.map((d) => (
          <li key={d.groupId} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
            <a href={`/groups/${d.groupId}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]">{d.groupName}</a>
            <p className="mt-0.5 text-xs text-[var(--soft-text)]">{catchUpSummaryLine(d)}</p>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
