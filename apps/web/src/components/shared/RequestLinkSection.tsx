"use client";
import { useActionState, useState } from "react";
import { type FormState, type InviteFormState, FORM_IDLE, INVITE_FORM_IDLE } from "./form-state";
import { CopyInviteLinkButton } from "./CopyInviteLinkButton";
import { SubmitButton } from "./SubmitButton";

// Manage a private group's durable, shareable request link (feedback #9). Mirrors
// InviteLinkSection, but the link never expires — so revocation is the only off-switch and
// the Revoke control is given equal visual weight to Generate/Copy, not a tiny text link.
type RequestLinkPreview = { tokenPreview: string } | null;

export function RequestLinkSection({
  groupId,
  linkPreview,
  generateAction,
  revokeAction,
}: {
  groupId: string;
  linkPreview: RequestLinkPreview;
  generateAction: (prev: InviteFormState, fd: FormData) => Promise<InviteFormState>;
  revokeAction: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null);

  async function generate(previousState: InviteFormState, formData: FormData): Promise<InviteFormState> {
    const state = await generateAction(previousState, formData);
    if (state.kind === "success") setDisplayedUrl(state.inviteUrl);
    return state;
  }

  async function revoke(previousState: FormState, formData: FormData): Promise<FormState> {
    const state = await revokeAction(previousState, formData);
    if (state.kind === "success") setDisplayedUrl(null);
    return state;
  }

  const [generateState, generateFormAction, generatePending] = useActionState(generate, INVITE_FORM_IDLE);
  const [revokeState, revokeFormAction, revokePending] = useActionState(revoke, FORM_IDLE);
  const pending = generatePending || revokePending;

  const hasActiveLink = displayedUrl !== null || linkPreview !== null;

  return (
    <div className="space-y-2">
      {displayedUrl ? (
        <>
          <p className="text-xs text-[var(--soft-text)]">
            Copy this link now — the full link is shown only once. Anyone with it can request support from this
            collective. It stays active until you revoke it.
          </p>
          <div className="flex gap-2">
            <input readOnly value={displayedUrl} className="flex-1 field-input text-xs font-mono" />
            <CopyInviteLinkButton url={displayedUrl} />
          </div>
        </>
      ) : linkPreview ? (
        <p className="text-xs text-[var(--soft-text)]">
          Active request link: <span className="font-mono">{linkPreview.tokenPreview}…</span> · stays active until revoked.
        </p>
      ) : (
        <p className="text-xs text-[var(--soft-text)]">
          Generate an unlisted link so people can request support from this private collective without it becoming
          publicly discoverable.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={generateFormAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <SubmitButton variant="secondary" disabled={pending}>
            {hasActiveLink ? "Regenerate link" : "Generate request link"}
          </SubmitButton>
        </form>
        {hasActiveLink && (
          <form action={revokeFormAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <SubmitButton variant="secondary" disabled={pending}>Revoke link</SubmitButton>
          </form>
        )}
      </div>

      {generateState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{generateState.message}</p>
      )}
      {revokeState.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">{revokeState.message}</p>
      )}
      {revokeState.kind === "success" && (
        <p aria-live="polite" className="text-xs text-[var(--muted)]">{revokeState.message}</p>
      )}
    </div>
  );
}
