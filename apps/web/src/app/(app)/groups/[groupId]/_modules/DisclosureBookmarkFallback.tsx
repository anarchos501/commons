"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { isModuleId } from "../../../../../lib/group-modules";

// External bookmarks like `…/groups/X#library` rely on the old always-rendered sections. Under
// disclosure a contextual card may not be present, so its `#hash` target doesn't exist and the
// native scroll/open no-ops. This rewrites such a hash to `?section=<id>` (server-readable, beats a
// stored hide) so the card is presented; SectionStateRestorer then opens/scrolls to it as before.
export function DisclosureBookmarkFallback({ present }: { present: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function applyHash() {
      const id = window.location.hash.slice(1);
      if (!id || !isModuleId(id)) return;
      if (present.includes(id)) return; // card is present → native #hash scroll/open already works
      if (searchParams.get("section") === id) return; // already targeting it
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", id);
      router.replace(`${pathname}?${params.toString()}#${id}`, { scroll: false });
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [present, router, pathname, searchParams]);

  return null;
}
