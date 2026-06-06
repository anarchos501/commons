"use client";
import { useActionState, useState } from "react";
import { type FormState, type InviteFormState, FORM_IDLE, INVITE_FORM_IDLE } from "./form-state";
import { CopyInviteLinkButton } from "./CopyInviteLinkButton";
import { SubmitButton } from "./SubmitButton";

type InvitePreview = { tokenPreview: string; expiresAt: Date } | null;

export function InviteLinkSection({
  groupId,
  invitePreview,
  generateAction,
  revokeAction,
}: {
  groupId: string;
  invitePreview: InvitePreview;
  generateAction: (prev: InviteFormState, fd: FormData) => Promise<InviteFormState>;
  revokeAction: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [displayedInviteUrl, setDisplayedInviteUrl] = useState<string | null>(null);

  async function generate(
    previousState: InviteFormState,
    formData: FormData,
  ): Promise<InviteFormState> {
    const state = await generateAction(previousState, formData);
    if (state.kind === "success") setDisplayedInviteUrl(state.inviteUrl);
    return state;
  }

  async function revoke(
    previousState: FormState,
    formData: FormData,
  ): Promise<FormState> {
    const state = await revokeAction(previousState, formData);
    if (state.kind === "success") setDisplayedInviteUrl(null);
    return state;
  }

  const [generateState, generateFormAction, generatePending] = useActionState(generate, INVITE_FORM_IDLE);
  const [revokeState, revokeFormAction, revokePending] = useActionState(revoke, FORM_IDLE);
  const pending = generatePending || revokePending;

  const hasActiveInvite = displayedInviteUrl !== null || invitePreview !== null;

  return (
    <div className="space-y-2">
      {displayedInviteUrl ? (
        <>
          <p className="text-xs text-[var(--soft-text)]">Copy this link now — it will not be shown again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={displayedInviteUrl}
              className="flex-1 field-input text-xs font-mono"
            />
            <CopyInviteLinkButton url={displayedInviteUrl} />
          </div>
        </>
      ) : invitePreview ? (
        <p className="text-xs text-[var(--soft-text)]">
          Active invite: <span className="font-mono">{invitePreview.tokenPreview}…</span>
          {" "}· Expires {new Date(invitePreview.expiresAt).toLocaleDateString()}
        </p>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <form action={generateFormAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <SubmitButton variant="secondary" disabled={pending}>
            {hasActiveInvite ? "Regenerate" : "Generate Invite Link"}
          </SubmitButton>
        </form>
        {hasActiveInvite && (
          <form action={revokeFormAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <button
              type="submit"
              disabled={pending}
              className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition disabled:opacity-50"
            >
              Revoke
            </button>
          </form>
        )}
      </div>

      {generateState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{generateState.message}</p>
      )}
      {revokeState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{revokeState.message}</p>
      )}
    </div>
  );
}
