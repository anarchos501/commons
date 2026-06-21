"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// External bookmarks like `…/groups/X#library` (or `…/dashboard#my-petitions`) rely on the old
// always-rendered sections. Under disclosure a contextual card may not be present, so its `#hash`
// target doesn't exist and the native scroll/open no-ops. This rewrites such a hash to
// `?section=<id>` (server-readable, beats a stored hide) so the card is presented; SectionStateRestorer
// then opens/scrolls to it as before. Scope-generic: `validIds` is the surface's module-id set
// (MODULE_IDS for a group, HOME_MODULE_IDS for the home), so no surface coupling lives here.
export function DisclosureBookmarkFallback({ present, validIds }: { present: string[]; validIds: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function applyHash() {
      const id = window.location.hash.slice(1);
      if (!id || !validIds.includes(id)) return;
      if (present.includes(id)) return; // card is present → native #hash scroll/open already works
      if (searchParams.get("section") === id) return; // already targeting it
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", id);
      router.replace(`${pathname}?${params.toString()}#${id}`, { scroll: false });
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [present, validIds, router, pathname, searchParams]);

  return null;
}
