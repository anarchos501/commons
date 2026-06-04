export function EmptyState({ text }: { text: string }) {
  return (
    <p className="border border-dashed border-[var(--border-strong)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--muted)]">
      {text}
    </p>
  );
}
