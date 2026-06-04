"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface Props {
  groups: Array<{ id: string; name: string }>;
}

export function NotificationFilters({ groups }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const unreadOnly = searchParams.get("notifUnread") === "1";
  const typeFilter = searchParams.get("notifType") ?? "all";
  const groupFilter = searchParams.get("notifGroup") ?? "all";

  function update(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}#routes`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-[var(--border)]">
      <label className="flex items-center gap-1.5 text-xs text-[var(--soft-text)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => update("notifUnread", e.target.checked ? "1" : null)}
          className="h-3.5 w-3.5 accent-[#0d9488]"
        />
        Unread only
      </label>

      <select
        value={typeFilter}
        onChange={(e) => update("notifType", e.target.value)}
        className="text-xs border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--soft-text)]"
      >
        <option value="all">All types</option>
        <option value="route">Support requests</option>
        <option value="petition">Petitions</option>
      </select>

      {groups.length > 1 && (
        <select
          value={groupFilter}
          onChange={(e) => update("notifGroup", e.target.value)}
          className="text-xs border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--soft-text)]"
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
