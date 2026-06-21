import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { PetitionFilter } from "../../../../../../components/shared/PetitionFilter";
import { proposalFamilyLabel } from "../../../../../../lib/petition-evaluation";
import type { PetitionFilterValue } from "../../../../../../lib/petitions";
import { COMPACT_DATE } from "../_shared/format";
import { supportPetitionAction, withdrawPetitionSupportAction, withdrawPetitionAction } from "./actions";

export type SpacePetition = {
  id: string;
  subjectType: string;
  subjectLabel: string;
  proposer: string | null;
  outcome: string;
  detailFields: { label: string; value: string }[];
  status: string;
  closesAt: Date;
  resolvedAt: Date | null;
  supportCount: number;
  requiredSupport: number;
  supportedByCurrentMember: boolean;
  createdByMembershipId: string | null;
};

function PetitionCard({ petition, canSupport, groupId, currentMembershipId }: { petition: SpacePetition; canSupport: boolean; groupId: string; currentMembershipId: string | null }) {
  const isOpen = petition.status === "open";
  const isProposer = currentMembershipId !== null && petition.createdByMembershipId === currentMembershipId;
  const canWithdraw = isOpen && isProposer;
  // How the viewer is involved — proposer takes precedence over supporter.
  const involvement = isProposer ? "You proposed" : petition.supportedByCurrentMember ? "You support" : null;
  return (
    <article className="border border-[var(--border)] bg-[var(--subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">{proposalFamilyLabel(petition.subjectType)}</p>
          {petition.subjectLabel && petition.subjectLabel !== proposalFamilyLabel(petition.subjectType) && (
            <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{petition.subjectLabel}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">
            {petition.status}
          </span>
          {involvement && (
            <span className="whitespace-nowrap border border-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              {involvement}
            </span>
          )}
        </div>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-[var(--accent)] hover:underline">Details</summary>
        <dl className="mt-2 grid gap-1 text-[var(--soft-text)]">
          <div><p className="text-[var(--text)]">{petition.outcome}</p></div>
          {petition.proposer && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-[var(--muted)]">Proposed by</dt>
              <dd>{petition.proposer}</dd>
            </div>
          )}
          {petition.detailFields.map((field) => (
            <div key={field.label} className="flex gap-2">
              <dt className="shrink-0 text-[var(--muted)]">{field.label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-3">
        <p>{petition.supportCount} supporting</p>
        <p>{petition.requiredSupport} needed</p>
        <p>
          {isOpen ? (
            <>Closes <LocalTime value={petition.closesAt.toISOString()} options={COMPACT_DATE} /></>
          ) : petition.resolvedAt ? (
            <>Resolved <LocalTime value={petition.resolvedAt.toISOString()} options={COMPACT_DATE} /></>
          ) : (
            "Resolved later"
          )}
        </p>
      </div>
      {isOpen && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canSupport ? (
            petition.supportedByCurrentMember ? (
              <form action={withdrawPetitionSupportAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Withdraw support</SubmitButton>
              </form>
            ) : (
              <form action={supportPetitionAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="petitionId" value={petition.id} />
                <SubmitButton variant="secondary">Support</SubmitButton>
              </form>
            )
          ) : (
            <p className="text-xs text-[var(--muted)]">Only active members may support petitions.</p>
          )}
          {canWithdraw && (
            <FormWithNotice action={withdrawPetitionAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="petitionId" value={petition.id} />
              <SubmitButton variant="secondary">Withdraw petition</SubmitButton>
            </FormWithNotice>
          )}
        </div>
      )}
    </article>
  );
}

export function PetitionsModule({
  petitions,
  petitionFilter,
  isActive,
  currentMembershipId,
  groupId,
}: {
  petitions: SpacePetition[];
  petitionFilter: PetitionFilterValue;
  isActive: boolean;
  currentMembershipId: string | null;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="petitions" title="Petitions" eyebrow="Community decisions" storageKey={`group:${groupId}:section:petitions`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="space-y-4">
        <PetitionFilter currentFilter={petitionFilter} />
        {petitions.length > 0 ? (
          <div className="space-y-3">
            {petitions.map((petition) => (
              <PetitionCard
                key={petition.id}
                petition={petition}
                canSupport={isActive}
                groupId={groupId}
                currentMembershipId={currentMembershipId}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No petitions yet. Proposed document revisions and responsibility volunteers will appear here." />
        )}
      </div>
    </CollapsibleSection>
  );
}
