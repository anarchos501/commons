"use client";

import { useState } from "react";

export function CopyTextButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
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
