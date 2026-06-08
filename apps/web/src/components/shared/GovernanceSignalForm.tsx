"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

const SIGNAL_OPTIONS = [
  { value: "-1", label: "More Careful" },
  { value: "0", label: "Neutral" },
  { value: "1", label: "Easier To Act" },
] as const;

function SignalButtons({ currentSignal, size }: { currentSignal: number; size: "sm" | "md" }) {
  const { pending } = useFormStatus();
  const padding = size === "md" ? "px-3 py-1.5" : "px-2 py-1";
  return (
    <>
      {SIGNAL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="submit"
          name="signal"
          value={opt.value}
          disabled={pending}
          aria-pressed={currentSignal === Number(opt.value)}
          className={`border ${padding} text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 ${
            currentSignal === Number(opt.value)
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
              : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
          }`}
        >
          {opt.label}
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
  size = "sm",
}: {
  action: (prev: string | null, fd: FormData) => Promise<string | null>;
  groupId: string;
  category: string;
  parameter: string;
  currentSignal: number;
  size?: "sm" | "md";
}) {
  const [error, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="parameter" value={parameter} />
      <div className="flex flex-wrap gap-1.5">
        <SignalButtons currentSignal={currentSignal} size={size} />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
