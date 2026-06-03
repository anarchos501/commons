"use client";

import { useEffect, useRef } from "react";

interface Props {
  storageKey: string;
}

export function SectionStateRestorer({ storageKey }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    const section = details.closest("section");

    function openIfHashMatches() {
      if (section?.id && window.location.hash === `#${section.id}`) {
        details!.open = true;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    // Initial load: open from hash, else restore localStorage state.
    if (section?.id && window.location.hash === `#${section.id}`) {
      openIfHashMatches();
    } else {
      const stored = localStorage.getItem(storageKey);
      if (stored === "open") details.open = true;
    }

    function onToggle() {
      localStorage.setItem(storageKey, details!.open ? "open" : "closed");
    }

    details.addEventListener("toggle", onToggle);
    window.addEventListener("hashchange", openIfHashMatches);
    return () => {
      details.removeEventListener("toggle", onToggle);
      window.removeEventListener("hashchange", openIfHashMatches);
    };
  }, [storageKey]);

  return <span ref={ref} className="hidden" aria-hidden="true" />;
}
