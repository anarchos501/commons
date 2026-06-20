import { ActivityFilter } from "../../../../../../components/shared/ActivityFilter";

export type OverviewModuleData = {
  group: { name: string; description: string | null };
  activeParticipantCount: number;
  groupContributions: Array<{ type: string; count: number }>;
};

export function OverviewModule({
  group,
  activeParticipantCount,
  currentParticipationStatus,
  groupContributions,
  activityFilter,
}: {
  group: { name: string; description: string | null };
  activeParticipantCount: number;
  currentParticipationStatus: string | null;
  groupContributions: Array<{ type: string; count: number }>;
  activityFilter: string;
}) {
  return (
    <div id="overview" className="bg-[var(--surface)] p-5 sm:p-6">
      <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Collective workspace</span>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text)]">{group.name}</h1>
      {group.description && <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{group.description}</p>}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
        <span>{activeParticipantCount} active {activeParticipantCount === 1 ? "member" : "members"}</span>
        {currentParticipationStatus && (
          <span className="capitalize">You: {currentParticipationStatus}</span>
        )}
      </div>

      {/* ── Activity (inline collapsible) ─────────────────────────── */}
      <details className="group/activity mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--soft-text)] hover:text-[var(--text)] select-none">
          <span>Activity</span>
          <span className="text-[var(--muted)] group-open/activity:hidden">▸</span>
          <span className="hidden text-[var(--muted)] group-open/activity:inline">▾</span>
        </summary>
        <div className="mt-3">
          <div className="mb-3">
            <ActivityFilter currentFilter={activityFilter} />
          </div>
          {groupContributions.length > 0 ? (
            <div className="space-y-1.5">
              {groupContributions.map((c) => (
                <div key={c.type} className="flex items-center justify-between bg-[var(--subtle)] px-3 py-2 text-sm">
                  <span className="capitalize text-[var(--soft-text)]">{c.type}</span>
                  <span className="text-[var(--muted)]">{c.count} {c.count === 1 ? "time" : "times"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No activity recorded for this period.</p>
          )}
        </div>
      </details>
    </div>
  );
}
