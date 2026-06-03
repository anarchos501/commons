export function SubmitButton({
  children,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const className =
    variant === "primary"
      ? "min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed"
      : "min-h-11 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button type="submit" className={className} disabled={disabled}>
      {children}
    </button>
  );
}
