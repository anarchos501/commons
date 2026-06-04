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
      ? "btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed"
      : "btn-secondary min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button type="submit" className={className} disabled={disabled}>
      {children}
    </button>
  );
}
