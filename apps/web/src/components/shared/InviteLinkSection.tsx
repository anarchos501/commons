"use client";
import { useActionState, useState } from "react";
import { type FormState, type InviteFormState, FORM_IDLE, INVITE_FORM_IDLE } from "./form-state";
import { CopyInviteLinkButton } from "./CopyInviteLinkButton";
import { SubmitButton } from "./SubmitButton";

// `activeUrl` is the full re-copyable link rebuilt server-side from the stored raw token
// (feedback #2). `invitePreview` covers the legacy case: an active link created before the
// raw token was stored, which can only show a preview until regenerated.
type InvitePreview = { tokenPreview: string; expiresAt: Date } | null;

export function InviteLinkSection({
  groupId,
  activeUrl,
  invitePreview,
  generateAction,
  revokeAction,
}: {
  groupId: string;
  activeUrl: string | null;
  invitePreview: InvitePreview;
  generateAction: (prev: InviteFormState, fd: FormData) => Promise<InviteFormState>;
  revokeAction: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  // After generating in this session, show the fresh URL immediately; on reload `activeUrl`
  // (rebuilt from the stored token) takes over so the link stays copyable.
  const [justGeneratedUrl, setJustGeneratedUrl] = useState<string | null>(null);

  async function generate(previousState: InviteFormState, formData: FormData): Promise<InviteFormState> {
    const state = await generateAction(previousState, formData);
    if (state.kind === "success") setJustGeneratedUrl(state.inviteUrl);
    return state;
  }

  async function revoke(previousState: FormState, formData: FormData): Promise<FormState> {
    const state = await revokeAction(previousState, formData);
    if (state.kind === "success") setJustGeneratedUrl(null);
    return state;
  }

  const [generateState, generateFormAction, generatePending] = useActionState(generate, INVITE_FORM_IDLE);
  const [revokeState, revokeFormAction, revokePending] = useActionState(revoke, FORM_IDLE);
  const pending = generatePending || revokePending;

  const copyableUrl = justGeneratedUrl ?? activeUrl;
  const hasActiveInvite = copyableUrl !== null || invitePreview !== null;

  return (
    <div className="space-y-2">
      {copyableUrl ? (
        <>
          <p className="text-xs text-[var(--soft-text)]">
            Anyone with this link can join. It stays active until it expires or you revoke it — copy it any time.
          </p>
          <div className="flex gap-2">
            <input readOnly value={copyableUrl} className="flex-1 field-input text-xs font-mono" />
            <CopyInviteLinkButton url={copyableUrl} />
          </div>
        </>
      ) : invitePreview ? (
        <p className="text-xs text-[var(--soft-text)]">
          Active invite: <span className="font-mono">{invitePreview.tokenPreview}…</span>
          {" "}· Expires {new Date(invitePreview.expiresAt).toLocaleDateString()}. Regenerate to get a copyable link.
        </p>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <form action={generateFormAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <SubmitButton variant="secondary" disabled={pending}>
            {hasActiveInvite ? "Regenerate (revokes current link)" : "Generate invite link"}
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
      {hasActiveInvite && (
        <p className="text-[11px] text-[var(--muted)]">Regenerating revokes the current link — anyone you already shared it with loses access.</p>
      )}

      {generateState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{generateState.message}</p>
      )}
      {revokeState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{revokeState.message}</p>
      )}
    </div>
  );
}
