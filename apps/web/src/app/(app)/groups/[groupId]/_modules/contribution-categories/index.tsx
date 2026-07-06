import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { formatTrustedByLabel, type TrustedProviderInfo } from "../../../../../../lib/trusted-providers";
import type { CategoryForScope } from "../../../../../../lib/contribution-categories";
import { proposeTrustedProviderStatusAction, proposeTrustedProviderRevocationAction } from "../_shared/trusted-provider-actions";
import { RequestLinkSection } from "../../../../../../components/shared/RequestLinkSection";
import { proposeCategoryAction, proposeCategoryArchivalAction, proposeCustomRequestsToggleAction, generateRequestLinkAction, revokeRequestLinkAction } from "./actions";

export type CategoryWithProviders = CategoryForScope & { trustedProviders: TrustedProviderInfo[] };

export type ContributionCategoriesModuleData = {
  group: { visibility: string; acceptsCustomRequests: boolean };
  contributionCategories: CategoryWithProviders[];
  groupMembers: Array<{ id: string; account: { displayName: string } }>;
  allProjects: Array<{ id: string; name: string }>;
  hasNoActiveCategories: boolean;
  requestLinkPreview: { tokenPreview: string; activeUrl: string | null } | null;
};

export function ContributionCategoriesModule({
  data,
  isActive,
  groupId,
}: {
  data: ContributionCategoriesModuleData;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="contribution-categories" title="Contribution Categories" eyebrow="What this community offers" storageKey={`group:${groupId}:section:categories`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="space-y-4">
        {/* Custom support requests — any group may opt in to free-text requests. For private
            groups these are reachable only through the token-gated share link (feedback #12). */}
        {isActive && (
          <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
            <p className="text-sm font-medium text-[var(--text)]">Custom support requests</p>
            <p className="mt-1 text-xs text-[var(--soft-text)]">
              {data.group.acceptsCustomRequests
                ? "Custom requests are accepted. They appear as a support type on the request form when at least one member has marked themselves available for them."
                : "Only your defined contribution categories can be requested. Enable custom requests to also accept free-text asks (members opt in to receiving them)."}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Changing this is collective-wide, so it opens a petition rather than taking effect immediately.
            </p>
            <FormWithNotice action={proposeCustomRequestsToggleAction} className="mt-3">
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="accepts" value={data.group.acceptsCustomRequests ? "false" : "true"} />
              <SubmitButton variant="secondary">
                {data.group.acceptsCustomRequests ? "Propose stopping custom requests" : "Propose accepting custom requests"}
              </SubmitButton>
            </FormWithNotice>
          </div>
        )}

        {/* Private groups: offer support via an unlisted, revocable link without becoming public (feedback #9). */}
        {data.group.visibility === "private" && isActive && (
          <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
            <p className="text-sm font-medium text-[var(--text)]">Private request link</p>
            <p className="mt-1 text-xs text-[var(--soft-text)]">
              This collective is private, so its contribution categories are not listed publicly. Share an unlisted
              link to let people request support without making the collective discoverable.
            </p>
            <div className="mt-3">
              <RequestLinkSection
                groupId={groupId}
                activeUrl={data.requestLinkPreview?.activeUrl ?? null}
                linkPreview={data.requestLinkPreview}
                generateAction={generateRequestLinkAction}
                revokeAction={revokeRequestLinkAction}
              />
            </div>
          </div>
        )}

        {data.contributionCategories.length > 0 ? (
          <div className="space-y-3">
            {data.contributionCategories.map((cat) => (
              <div key={cat.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{cat.name}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {cat.offeringEntityType === "group" && cat.offeringEntityName}
                      {cat.offeringEntityType === "project" && `Project: ${cat.offeringEntityName}`}
                      {cat.offeringEntityType === "responsibility" && `Responsibility: ${cat.offeringEntityName}`}
                    </p>
                    {cat.description && <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">{cat.description}</p>}
                  </div>
                  {isActive && (
                    <FormWithNotice action={proposeCategoryArchivalAction} className="shrink-0">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="categoryId" value={cat.id} />
                      <SubmitButton variant="secondary">Archive</SubmitButton>
                    </FormWithNotice>
                  )}
                </div>
                {cat.trustedProviders.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border)] pt-2">
                    <p className="text-xs font-medium text-[var(--soft-text)] mb-1">Trusted providers</p>
                    <div className="space-y-1">
                      {cat.trustedProviders.map((tp) => (
                        <div key={tp.id} className="flex items-center justify-between">
                          <span className="text-xs text-[var(--soft-text)]">
                            {tp.memberDisplayName} — {cat.offeringEntityName ? formatTrustedByLabel(tp.offeringEntityType, cat.offeringEntityName) : ""}
                          </span>
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
                  </div>
                )}
                {isActive && data.groupMembers.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose trusted provider</summary>
                    <FormWithNotice action={proposeTrustedProviderStatusAction} className="mt-2 space-y-2">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="categoryId" value={cat.id} />
                      <select name="targetMembershipId" required className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
                        <option value="">Select member…</option>
                        {data.groupMembers.map((m) => (
                          <option key={m.id} value={m.id}>{m.account.displayName}</option>
                        ))}
                      </select>
                      <SubmitButton variant="secondary">Open petition</SubmitButton>
                    </FormWithNotice>
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No contribution categories defined yet." />
        )}
        {isActive && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new category</summary>
            <FormWithNotice action={proposeCategoryAction} className="mt-3 space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <div>
                <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Name</label>
                <input name="name" required placeholder="Transportation" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Description</label>
                <textarea name="description" required rows={2} placeholder="What kind of assistance does this cover?" className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--soft-text)] mb-1">Offered by</label>
                <select name="offeringEntityType" required className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
                  <option value="group">This collective</option>
                  {data.allProjects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>Project: {p.name}</option>
                  ))}
                </select>
              </div>
              {data.group.visibility === "private" && (
                <p className="text-xs border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-[var(--soft-text)]">
                  This collective is private, so this category stays unlisted. Members can still receive requests for it
                  by sharing the private request link above — the collective does not become publicly discoverable.
                </p>
              )}
              <SubmitButton>Open petition</SubmitButton>
            </FormWithNotice>
          </details>
        )}
      </div>
    </CollapsibleSection>
  );
}
