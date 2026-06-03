export function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <p className="text-sm font-medium text-[var(--muted)]">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-normal">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}
