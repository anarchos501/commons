"use client";
import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "3month", label: "3 months" },
  { value: "6month", label: "6 months" },
  { value: "all", label: "All time" },
] as const;
type FilterValue = (typeof OPTIONS)[number]["value"];

export function ActivityFilter({ currentFilter }: { currentFilter: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(value: FilterValue) {
    if (value === currentFilter || pending) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("activityFilter", value);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => select(opt.value)}
          disabled={pending}
          aria-pressed={currentFilter === opt.value}
          className={`border px-2 py-0.5 text-xs font-medium transition focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50 ${
            currentFilter === opt.value
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
              : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
