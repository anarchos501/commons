type Prefs = {
  enableRequests: boolean;
  enablePetitions: boolean;
  enableOutcomes: boolean;
  enableSafety: boolean;
  enableUpdates: boolean;
  rollUpUpdates: boolean;
  mutedGroupIds: string[];
};

const TOGGLES: Array<{ name: keyof Prefs; label: string; hint?: string }> = [
  { name: "enableRequests", label: "Support requests", hint: "Muting hides requests routed to you." },
  { name: "enablePetitions", label: "Petitions to vote on", hint: "Muting hides your pending votes." },
  { name: "enableOutcomes", label: "Outcomes", hint: "Petition results, your application decisions, term expiry, concern reviews." },
  { name: "enableSafety", label: "Safety alerts", hint: "Emergency declarations in your collectives." },
  { name: "enableUpdates", label: "Space updates", hint: "New bulletins in collectives/projects you belong to." },
];

/**
 * Durable notification preferences (what you receive at all) — distinct from the in-the-moment
 * NotificationFilters. Native checkboxes posting to a server action; unchecked boxes are simply
 * absent, which the action reads as "off". "About you" has no toggle (non-muteable).
 */
export function NotificationPreferencesForm({
  prefs,
  groups,
  action,
}: {
  prefs: Prefs;
  groups: Array<{ id: string; name: string }>;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="space-y-4 text-sm">
      <fieldset>
        <legend className="field-label">What to notify me about</legend>
        <div className="mt-2 space-y-2">
          {TOGGLES.map((t) => (
            <label key={t.name} className="flex items-start gap-2">
              <input type="checkbox" name={t.name} defaultChecked={prefs[t.name] as boolean} className="mt-0.5 h-4 w-4 accent-[#0d9488]" />
              <span>
                <span className="text-[var(--text)]">{t.label}</span>
                {t.hint && <span className="block text-xs text-[var(--muted)]">{t.hint}</span>}
              </span>
            </label>
          ))}
          <p className="text-xs text-[var(--muted)]">
            <strong className="font-medium text-[var(--soft-text)]">About you</strong> — notices about your own roles and standing (e.g. a recall) are always on and can&apos;t be muted.
          </p>
        </div>
      </fieldset>

      <label className="flex items-start gap-2">
        <input type="checkbox" name="rollUpUpdates" defaultChecked={prefs.rollUpUpdates} className="mt-0.5 h-4 w-4 accent-[#0d9488]" />
        <span>
          <span className="text-[var(--text)]">Roll up space updates</span>
          <span className="block text-xs text-[var(--muted)]">One summary per space (e.g. &ldquo;3 new bulletins&rdquo;) instead of one notification each.</span>
        </span>
      </label>

      {groups.length > 0 && (
        <fieldset>
          <legend className="field-label">Mute updates from specific collectives</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2">
                <input type="checkbox" name="mutedGroup" value={g.id} defaultChecked={prefs.mutedGroupIds.includes(g.id)} className="h-4 w-4 accent-[#0d9488]" />
                <span className="text-[var(--soft-text)]">{g.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <button
        type="submit"
        className="btn-secondary inline-flex min-h-11 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
      >
        Save notification settings
      </button>
    </form>
  );
}
