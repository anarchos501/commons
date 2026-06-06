"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type FormState, FORM_IDLE } from "./form-state";

function FormControls({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset disabled={pending} className="contents">
      {children}
    </fieldset>
  );
}

export function FormWithNotice({
  action,
  children,
  className,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, FORM_IDLE);
  return (
    <form action={formAction} className={className}>
      <FormControls>{children}</FormControls>
      {state.kind === "success" && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--soft-text)]">
          {state.message}
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" aria-live="assertive" className="mt-2 text-xs text-red-600">
          {state.message}
        </p>
      )}
    </form>
  );
}
