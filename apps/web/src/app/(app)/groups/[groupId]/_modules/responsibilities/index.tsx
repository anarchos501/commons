import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { responsibilityTypeLabel } from "../../../../../../lib/concern-reviewer";
import { PROPOSABLE_RESPONSIBILITY_ABILITIES } from "../../../../../../lib/responsibility-proposals";
import { proposeResponsibilityAction, volunteerForResponsibilityAction, recallResponsibilityAction, resignResponsibilityAction } from "./actions";

export type ResponsibilityType = {
  id: string;
  type: string;
  assignments: Array<{ id: string; membershipId: string; membership: { account: { displayName: string } } }>;
};

export function ResponsibilitiesModule({
  responsibilityTypes,
  myResponsibilityTypes,
  currentMembershipId,
  isActive,
  groupId,
}: {
  responsibilityTypes: ResponsibilityType[];
  myResponsibilityTypes: Set<string>;
  currentMembershipId: string | undefined;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="responsibilities" title="Responsibilities" eyebrow="Community coverage" storageKey={`group:${groupId}:section:responsibilities`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="space-y-3">
        {responsibilityTypes.length === 0 && (
          <EmptyState text="No responsibility types defined yet." />
        )}
        {responsibilityTypes.map((r) => {
          const isHolder = myResponsibilityTypes.has(r.type);
          const hasHolders = r.assignments.length > 0;
          return (
            <div key={r.id} className="border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={`/responsibilities/${r.id}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] capitalize">
                    {responsibilityTypeLabel(r.type)}
                  </a>
                  {r.assignments.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {r.assignments.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                          <span className="truncate">{a.membership.account.displayName}</span>
                          {isActive && a.membershipId !== currentMembershipId && (
                            <form action={recallResponsibilityAction}>
                              <input type="hidden" name="groupId" value={groupId} />
                              <input type="hidden" name="assignmentId" value={a.id} />
                              <button type="submit" className="shrink-0 text-amber-700 hover:text-amber-600 transition">Petition recall</button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className={`shrink-0 px-2 py-0.5 text-xs font-medium ${hasHolders ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                  {hasHolders ? "Covered" : "Needed"}
                </span>
              </div>
              {isActive && !isHolder && (
                <FormWithNotice action={volunteerForResponsibilityAction} className="mt-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="type" value={r.type} />
                  <SubmitButton variant="secondary">Volunteer</SubmitButton>
                </FormWithNotice>
              )}
              {isHolder && (
                <form action={resignResponsibilityAction} className="mt-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="type" value={r.type} />
                  <button type="submit" className="text-xs text-amber-700 hover:text-amber-600 transition">Resign</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {isActive && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new responsibility</summary>
          <FormWithNotice action={proposeResponsibilityAction} className="mt-3 space-y-3">
            <input type="hidden" name="groupId" value={groupId} />
            <label className="block">
              <span className="field-label">Type</span>
              <input name="type" type="text" required maxLength={64} className="field-input" placeholder="e.g. Communications" />
            </label>
            <label className="block">
              <span className="field-label">Purpose</span>
              <textarea name="description" required maxLength={500} rows={3} className="field-input resize-none" placeholder="What does this role coordinate, and who does it serve?" />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                On approval, this seeds an editable &quot;Purpose&quot; living document for the role — the group can revise it later through the normal living-document petition flow.
              </span>
            </label>
            <fieldset className="space-y-1.5">
              <legend className="field-label">Abilities</legend>
              {PROPOSABLE_RESPONSIBILITY_ABILITIES.map(({ ability, label }) => (
                <div key={ability} className="flex items-center gap-3 text-sm text-[var(--text)]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name={`ability_${ability}`} value="on" />
                    {label}
                  </label>
                  <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <input type="radio" name={`availability_${ability}`} value="always_available" defaultChecked />
                    Always
                  </label>
                  <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <input type="radio" name={`availability_${ability}`} value="available_during_emergency" />
                    Emergency only
                  </label>
                </div>
              ))}
            </fieldset>
            <SubmitButton variant="secondary">Open proposal petition</SubmitButton>
          </FormWithNotice>
        </details>
      )}
    </CollapsibleSection>
  );
}
