import { SectionStateRestorer } from "./SectionStateRestorer";

interface Props {
  id: string;
  title: string;
  eyebrow: string;
  storageKey?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ id, title, eyebrow, storageKey, children }: Props) {
  return (
    <section id={id} className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{eyebrow}</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight">{title}</span>
          </span>
          <span className="text-sm text-[var(--muted)] select-none group-open:hidden">Expand</span>
          <span className="hidden text-sm text-[var(--muted)] select-none group-open:inline">Collapse</span>
        </summary>
        {storageKey && <SectionStateRestorer storageKey={storageKey} />}
        <div className="mt-5">{children}</div>
      </details>
    </section>
  );
}
