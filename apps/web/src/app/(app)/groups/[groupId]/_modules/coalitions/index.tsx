import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { proposeCoalitionFormationAction, proposeCoalitionJoinAction } from "./actions";

export type CoalitionsModuleData = {
  coalitions: Array<{ id: string; name: string; description: string | null; _count: { memberships: number } }>;
  eligibleCoalitionPartners: Array<{ id: string; label: string }>;
  joinableCoalitions: Array<{ id: string; name: string }>;
};

export function CoalitionsModule({ data, isActive, groupId }: { data: CoalitionsModuleData; isActive: boolean; groupId: string }) {
  return (
    <CollapsibleSection id="coalitions" title="Coalitions" eyebrow="Collective-to-collective coordination" storageKey={`group:${groupId}:section:coalitions`} className="bg-[var(--surface)] p-5 sm:p-6">
      {data.coalitions.length > 0 ? (
        <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
          {data.coalitions.map((coalition) => (
            <a
              key={coalition.id}
              href={`/coalitions/${coalition.id}`}
              className="block px-3 py-3 transition hover:bg-[var(--hover)]"
            >
              <p className="text-sm font-medium text-[var(--text)]">{coalition.name}</p>
              {coalition.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--soft-text)]">{coalition.description}</p>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">
                {coalition._count.memberships} member {coalition._count.memberships === 1 ? "collective" : "collectives"}
              </p>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState text="This collective does not currently belong to a coalition." />
      )}
      {isActive && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose forming a new coalition</summary>
          {data.eligibleCoalitionPartners.length > 0 ? (
            <FormWithNotice action={proposeCoalitionFormationAction} className="mt-3 space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <label className="block">
                <span className="field-label">Coalition name</span>
                <input name="name" type="text" required className="field-input" placeholder="e.g. Riverside Mutual Aid Network" />
              </label>
              <label className="block">
                <span className="field-label">Description</span>
                <textarea name="description" rows={2} className="field-input resize-none" placeholder="What is this coalition for?" />
              </label>
              <label className="block">
                <span className="field-label">Rationale</span>
                <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should these collectives federate?" />
              </label>
              <fieldset className="space-y-1.5">
                <legend className="field-label">Partner collectives (select at least one)</legend>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  Each selected collective receives its own internal petition, decided independently by its members.
                </p>
                {data.eligibleCoalitionPartners.map((partner) => (
                  <label key={partner.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                    <input type="checkbox" name="partnerGroupId" value={partner.id} />
                    {partner.label}
                  </label>
                ))}
              </fieldset>
              <SubmitButton variant="secondary">Open formation proposal</SubmitButton>
            </FormWithNotice>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              There are no other collectives on this node to invite into a coalition.
            </p>
          )}
        </details>
      )}
      {isActive && data.joinableCoalitions.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Apply to join a coalition</summary>
          <FormWithNotice action={proposeCoalitionJoinAction} className="mt-3 space-y-3">
            <input type="hidden" name="groupId" value={groupId} />
            <label className="block">
              <span className="field-label">Coalition</span>
              <select name="coalitionId" required className="field-input">
                <option value="">Select a coalition&hellip;</option>
                {data.joinableCoalitions.map((coalition) => (
                  <option key={coalition.id} value={coalition.id}>{coalition.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Rationale</span>
              <textarea name="content" required rows={3} className="field-input resize-none" placeholder="Why should this collective join?" />
            </label>
            <SubmitButton variant="secondary">Open join proposal</SubmitButton>
          </FormWithNotice>
        </details>
      )}
    </CollapsibleSection>
  );
}
