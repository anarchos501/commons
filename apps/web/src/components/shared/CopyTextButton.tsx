"use client";

import { useState, type MouseEvent } from "react";

export function CopyTextButton({
  text,
  label = "Copy",
  stopPropagation = false,
}: {
  text: string;
  label?: string;
  /** Set when rendered inside a <summary> so clicking copy doesn't toggle the <details>. */
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — nothing to fall back to here.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="shrink-0 border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
