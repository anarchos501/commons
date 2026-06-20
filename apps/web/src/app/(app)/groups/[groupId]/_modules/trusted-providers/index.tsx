import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { formatTrustedByLabel } from "../../../../../../lib/trusted-providers";
import { proposeTrustedProviderRevocationAction } from "../_shared/trusted-provider-actions";
import type { CategoryWithProviders } from "../contribution-categories";

export function TrustedProvidersModule({
  contributionCategories,
  isActive,
  groupId,
}: {
  contributionCategories: CategoryWithProviders[];
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="trusted-providers" title="Trusted Providers" eyebrow="Recognized contributors" storageKey={`group:${groupId}:section:trusted-providers`} className="bg-[var(--surface)] p-5 sm:p-6">
      {contributionCategories.some((cat) => cat.trustedProviders.length > 0) ? (
        <div className="space-y-2">
          {contributionCategories.flatMap((cat) =>
            cat.trustedProviders.map((tp) => ({
              ...tp,
              categoryName: cat.name,
              offeringEntityName: cat.offeringEntityName,
            }))
          ).map((tp) => (
            <div key={tp.id} className="flex items-center justify-between border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">{tp.memberDisplayName}</p>
                <p className="text-xs text-[var(--muted)]">
                  {tp.categoryName}
                  {tp.offeringEntityName ? ` — ${formatTrustedByLabel(tp.offeringEntityType, tp.offeringEntityName)}` : ""}
                </p>
              </div>
              {isActive && (
                <FormWithNotice action={proposeTrustedProviderRevocationAction}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="targetMembershipId" value={tp.membershipId} />
                  <input type="hidden" name="statusIds" value={tp.id} />
                  <SubmitButton variant="secondary">Revoke</SubmitButton>
                </FormWithNotice>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No trusted providers recognized yet. Propose one from the Contribution Categories section." />
      )}
    </CollapsibleSection>
  );
}
