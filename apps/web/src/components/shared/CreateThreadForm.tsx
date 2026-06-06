"use client";
import { useActionState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { THREAD_FORM_IDLE, type ThreadFormState } from "./form-state";
import { SubmitButton } from "./SubmitButton";

export function CreateThreadForm({
  action,
  groupId,
}: {
  action: (prev: ThreadFormState, fd: FormData) => Promise<ThreadFormState>;
  groupId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(action, THREAD_FORM_IDLE);

  useEffect(() => {
    if (state.kind !== "success") return;
    if (searchParams.get("discussionThread") === state.threadId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("discussionThread", state.threadId);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [state, pathname, router, searchParams]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <label className="block">
        <span className="field-label">New thread</span>
        <input
          name="title"
          type="text"
          required
          disabled={pending}
          className="field-input"
          placeholder="A focused coordination topic"
        />
      </label>
      <SubmitButton variant="secondary" disabled={pending}>
        {pending ? "Creating…" : "Create thread"}
      </SubmitButton>
      {state.kind === "error" && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-600">
          {state.message}
        </p>
      )}
    </form>
  );
}
