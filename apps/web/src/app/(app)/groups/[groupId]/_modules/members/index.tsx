import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { InviteLinkSection } from "../../../../../../components/shared/InviteLinkSection";
import { COMPACT_DATE } from "../_shared/format";
import { sponsorApplicationAction, dismissApplicationAction, generateInviteLinkAction, revokeInviteLinkAction } from "./actions";

export type MembersModuleData = {
  activeParticipantCount: number;
  groupMembers: Array<{
    id: string;
    participationStatus: string;
    account: { displayName: string };
    affiliations: Array<{ id: string; name: string }>;
  }>;
  pendingApplications: Array<{
    id: string;
    account: { displayName: string };
    applicationNote: string | null;
    joinedAt: Date;
    hasOpenSponsorship: boolean;
  }>;
  invitePreview: { tokenPreview: string; expiresAt: Date } | null;
};

export function MembersModule({
  data,
  currentParticipationStatus,
  isActive,
  groupId,
}: {
  data: MembersModuleData;
  currentParticipationStatus: string | null;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="members" title="Members" eyebrow="Participation" storageKey={`group:${groupId}:section:members`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="space-y-2 text-sm text-[var(--soft-text)]">
        <p>{data.activeParticipantCount} fully active {data.activeParticipantCount === 1 ? "member" : "members"}</p>
        {currentParticipationStatus && (
          <p className="text-xs text-[var(--muted)]">Your status: <span className="capitalize">{currentParticipationStatus}</span></p>
        )}
      </div>

      {/* Member roster — visible to active members */}
      {isActive && data.groupMembers.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs font-medium text-[var(--muted)] mb-2">All members</p>
          <div className="space-y-1">
            {data.groupMembers.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 py-1 text-sm">
                <div className="min-w-0">
                  <span className="text-[var(--text)]">{m.account.displayName}</span>
                  {m.affiliations.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                      <span>Also a member of</span>
                      {m.affiliations.map((group) => (
                        <a key={group.id} href={`/groups/${group.id}`} className="text-[var(--accent)] hover:underline">
                          {group.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs capitalize text-[var(--muted)]">{m.participationStatus}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending membership applications — visible to active members */}
      {isActive && data.pendingApplications.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
          <p className="text-xs font-medium text-[var(--muted)]">Pending applications ({data.pendingApplications.length})</p>
          {data.pendingApplications.map((app) => (
            <div key={app.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
              <p className="text-sm font-medium text-[var(--text)]">{app.account.displayName}</p>
              {app.applicationNote && (
                <p className="mt-1 text-xs text-[var(--soft-text)]">{app.applicationNote}</p>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">Applied <LocalTime value={app.joinedAt.toISOString()} options={COMPACT_DATE} /></p>
              <div className="mt-3 flex gap-2">
                {app.hasOpenSponsorship ? (
                  <p className="text-xs text-[var(--soft-text)]">Sponsorship petition open</p>
                ) : (
                  <FormWithNotice action={sponsorApplicationAction}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="pendingMembershipId" value={app.id} />
                    <SubmitButton variant="secondary">Sponsor</SubmitButton>
                  </FormWithNotice>
                )}
                <form action={dismissApplicationAction}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="pendingMembershipId" value={app.id} />
                  <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                    Dismiss
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite link — visible to active members only */}
      {isActive && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs font-medium text-[var(--muted)] mb-3">Invite link</p>
          <InviteLinkSection
            groupId={groupId}
            invitePreview={data.invitePreview}
            generateAction={generateInviteLinkAction}
            revokeAction={revokeInviteLinkAction}
          />
        </div>
      )}
    </CollapsibleSection>
  );
}
