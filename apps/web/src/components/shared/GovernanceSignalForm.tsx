"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

// Default labels for the category-wide ("bulk") signal. Per-parameter forms pass truthful,
// direction-aware labels via the `labels` prop (e.g. "Increase threshold").
const DEFAULT_LABELS: [string, string, string] = ["More careful", "Neutral", "Easier to act"];
const SIGNAL_VALUES = ["-1", "0", "1"] as const;

function SignalButtons({
  currentSignal,
  size,
  labels,
}: {
  currentSignal: number;
  size: "sm" | "md";
  labels: [string, string, string];
}) {
  const { pending } = useFormStatus();
  const padding = size === "md" ? "px-3 py-1.5" : "px-2 py-1.5";
  return (
    <>
      {SIGNAL_VALUES.map((value, i) => (
        <button
          key={value}
          type="submit"
          name="signal"
          value={value}
          disabled={pending}
          aria-pressed={currentSignal === Number(value)}
          // Full-width so the three options stack as a tidy left-aligned column that never wraps
          // on a phone (the reported layout complaint).
          className={`w-full border ${padding} text-left text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 ${
            currentSignal === Number(value)
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
              : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
          }`}
        >
          {labels[i]}
        </button>
      ))}
    </>
  );
}

export function GovernanceSignalForm({
  action,
  groupId,
  category,
  parameter,
  currentSignal,
  labels = DEFAULT_LABELS,
  size = "sm",
}: {
  action: (prev: string | null, fd: FormData) => Promise<string | null>;
  groupId: string;
  category: string;
  parameter: string;
  currentSignal: number;
  labels?: [string, string, string];
  size?: "sm" | "md";
}) {
  const [error, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="parameter" value={parameter} />
      <div className="flex w-full max-w-[15rem] flex-col gap-1">
        <SignalButtons currentSignal={currentSignal} size={size} labels={labels} />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
