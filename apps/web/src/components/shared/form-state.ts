export type FormState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export const FORM_IDLE: FormState = { kind: "idle" };

export type ThreadFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string; threadId: string };

export const THREAD_FORM_IDLE: ThreadFormState = { kind: "idle" };

export type InviteFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string; inviteUrl: string };

export const INVITE_FORM_IDLE: InviteFormState = { kind: "idle" };
