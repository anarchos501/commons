"use client";

import { useSyncExternalStore } from "react";
const TEXT_SIZE_EVENT = "commons:text-size-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(TEXT_SIZE_EVENT, onStoreChange);
  return () => window.removeEventListener(TEXT_SIZE_EVENT, onStoreChange);
}

function getLargeTextSnapshot() {
  return document.documentElement.classList.contains("large-text");
}

function getServerSnapshot() {
  return false;
}

export function TextSizeToggle() {
  const largeText = useSyncExternalStore(subscribe, getLargeTextSnapshot, getServerSnapshot);

  function toggleTextSize() {
    const next = !document.documentElement.classList.contains("large-text");
    document.documentElement.classList.toggle("large-text", next);
    document.cookie = `commons_text_size=${next ? "large" : "normal"}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggleTextSize}
      aria-label={largeText ? "Use standard text size" : "Use larger text"}
      aria-pressed={largeText}
      className={`btn-icon flex h-8 items-center justify-center gap-1.5 px-2 touch-manipulation text-xs hover:bg-[var(--hover)] hover:text-[var(--text)] active:bg-[var(--hover)] ${
        largeText ? "bg-[var(--subtle)] text-[var(--text)]" : "text-[var(--muted)]"
      }`}
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <span
        aria-hidden="true"
        className={`font-semibold leading-none transition-[font-size] ${largeText ? "text-lg" : "text-xs"}`}
      >
        T
      </span>
      <span>Text</span>
    </button>
  );
}
