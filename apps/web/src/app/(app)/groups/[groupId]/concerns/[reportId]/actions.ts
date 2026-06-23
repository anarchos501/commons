"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPrismaClient } from "../../../../../../lib/prisma";
import { getSession } from "../../../../../../lib/session";
import { requiredString } from "../../../../../../lib/support-form";
import { startReview, issueFindings, proposeAction, closeConcern } from "../../../../../../lib/concerns";
import type { FormState } from "../../../../../../components/shared/form-state";
import type { ConcernClosureReason, ConcernFindingOutcome } from "../../../../../../generated/prisma/enums";

// The four lib fns re-check eligibility/ability/state server-side and throw a descriptive Error
// on any violation (see concerns.ts). These wrappers are thin: authenticate, call, translate a
// thrown error into a notice. They add no authorization of their own and must not — the lib is
// the gate (a server action is a directly-callable entry point).
function asError(err: unknown, fallback: string): FormState {
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { kind: "error", message };
}

const FINDING_OUTCOMES: ReadonlySet<string> = new Set<ConcernFindingOutcome>([
  "substantiated",
  "partially_substantiated",
  "unsubstantiated",
  "insufficient_information",
  "withdrawn",
]);

const CLOSURE_REASONS: ReadonlySet<string> = new Set<ConcernClosureReason>([
  "reporter_withdrawal",
  "review_complete_no_action",
  "action_accepted_and_implemented",
  "action_rejected_no_further_proposal",
  "administrative_closure",
]);

function revalidate(groupId: string, reportId: string) {
  revalidatePath(`/groups/${groupId}/concerns/${reportId}`);
  revalidatePath(`/groups/${groupId}`);
}

export async function startReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const reportId = requiredString(formData, "reportId");
  const prisma = createPrismaClient();
  try {
    await startReview(prisma, session.accountId, groupId, reportId);
  } catch (err) {
    return asError(err, "Could not start review.");
  } finally {
    await prisma.$disconnect();
  }
  revalidate(groupId, reportId);
  return { kind: "success", message: "Review started." };
}

export async function issueFindingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const reportId = requiredString(formData, "reportId");
  const outcome = (formData.get("outcome") as string) ?? "";
  const summary = ((formData.get("summary") as string) ?? "").trim();
  if (!FINDING_OUTCOMES.has(outcome)) return { kind: "error", message: "Choose a valid finding outcome." };
  if (!summary) return { kind: "error", message: "Add a short summary for the finding." };
  const prisma = createPrismaClient();
  try {
    await issueFindings(prisma, session.accountId, reportId, outcome as ConcernFindingOutcome, summary);
  } catch (err) {
    return asError(err, "Could not record the finding.");
  } finally {
    await prisma.$disconnect();
  }
  revalidate(groupId, reportId);
  return { kind: "success", message: "Finding recorded." };
}

export async function proposeActionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const reportId = requiredString(formData, "reportId");
  const proposedAction = ((formData.get("proposedAction") as string) ?? "").trim();
  const rationale = ((formData.get("rationale") as string) ?? "").trim();
  if (!proposedAction) return { kind: "error", message: "Describe the proposed action." };
  if (!rationale) return { kind: "error", message: "Add a rationale for the proposed action." };
  const prisma = createPrismaClient();
  try {
    await proposeAction(prisma, session.accountId, groupId, reportId, proposedAction, rationale);
  } catch (err) {
    return asError(err, "Could not submit the proposal.");
  } finally {
    await prisma.$disconnect();
  }
  revalidate(groupId, reportId);
  return { kind: "success", message: "Action proposed." };
}

export async function closeConcernAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const groupId = requiredString(formData, "groupId");
  const reportId = requiredString(formData, "reportId");
  const reason = (formData.get("reason") as string) ?? "";
  if (!CLOSURE_REASONS.has(reason)) return { kind: "error", message: "Choose a valid closure reason." };
  const prisma = createPrismaClient();
  try {
    await closeConcern(prisma, session.accountId, groupId, reportId, reason as ConcernClosureReason);
  } catch (err) {
    return asError(err, "Could not close the concern.");
  } finally {
    await prisma.$disconnect();
  }
  revalidate(groupId, reportId);
  return { kind: "success", message: reason === "reporter_withdrawal" ? "Concern withdrawn." : "Concern closed." };
}
