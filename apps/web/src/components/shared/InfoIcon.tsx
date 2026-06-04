"use client";

import { Info } from "lucide-react";

interface Props {
  description?: string;
}

export function InfoIcon({ description = "" }: Props) {
  return (
    <span className="relative inline-flex group/info">
      <Info className="h-3.5 w-3.5 text-[var(--muted)] cursor-help flex-shrink-0" aria-hidden="true" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 z-50
          w-52 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2
          text-xs leading-5 text-[var(--soft-text)] shadow-md whitespace-normal
          opacity-0 group-hover/info:opacity-100 transition-opacity duration-150 delay-300"
      >
        {description || <span className="italic text-[var(--muted)]">No description yet.</span>}
      </span>
    </span>
  );
}
