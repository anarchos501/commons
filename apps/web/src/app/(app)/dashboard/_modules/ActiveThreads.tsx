import Link from "next/link";

// The "Active" strip: YOUR OWN live commitments with a next step — things you opted into (about-you
// items, requests you accepted, petitions you're party to), surfaced so you can FIND them. Never
// things the collective wants from you; no counts, no urgency, no "N waiting". Quiet when empty.

export type ActiveThreadItem = {
  key: string;
  kind: "about" | "request" | "petition";
  label: string;
  detail: string | null;
  href: string;
};

const KIND_LABEL: Record<ActiveThreadItem["kind"], string> = { about: "about you", request: "accepted", petition: "party to" };

export function ActiveThreads({ items }: { items: ActiveThreadItem[] }) {
  if (items.length === 0) return null; // nothing to pick back up — stay quiet

  return (
    <section id="active-threads" className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Active</span>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-[var(--text)]">Your threads with a next step</h2>
      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
            <div className="min-w-0">
              <Link href={it.href} className="text-sm text-[var(--text)] hover:text-[var(--accent)]">{it.label}</Link>
              {it.detail && <span className="ml-2 text-xs text-[var(--muted)]">{it.detail}</span>}
            </div>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">{KIND_LABEL[it.kind]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
