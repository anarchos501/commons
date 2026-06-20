import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { ThreadList } from "../../../../../../components/shared/ThreadList";
import { CreateThreadForm } from "../../../../../../components/shared/CreateThreadForm";
import { COMPACT_DATE } from "../_shared/format";
import { createDiscussionThreadAction, postDiscussionMessageAction, openThreadClosurePetitionAction } from "./actions";

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", COMPACT_DATE).format(date);
}

export type DiscussionModuleData = {
  discussionThreads: Array<{ id: string; title: string; messageCount: number; lastActivityAt: Date }>;
  selectedThread: { id: string; title: string } | null;
  discussionMessages: Array<{ id: string; body: string; author: { displayName: string }; createdAt: Date }>;
};

export function DiscussionModule({
  data,
  isActive,
  groupId,
}: {
  data: DiscussionModuleData;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="discussion" title="Discussion" eyebrow="Temporary coordination" storageKey={`group:${groupId}:section:discussion`} className="bg-[var(--surface)] p-5 sm:p-6">
      {data.discussionThreads.length > 0 ? (
        <div className="mb-4 grid gap-4 md:grid-cols-[minmax(180px,0.42fr)_minmax(0,1fr)]">
          <ThreadList
            threads={data.discussionThreads.map((thread) => ({
              id: thread.id,
              title: thread.title,
              messageCount: thread.messageCount,
              lastActivityLabel: formatRelativeDate(thread.lastActivityAt),
            }))}
            selectedThreadId={data.selectedThread?.id ?? null}
          />
          <div className="border border-[var(--border)] p-3">
            {data.selectedThread ? (
              <>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{data.selectedThread.title}</p>
                    <p className="text-xs text-[var(--muted)]">Messages expire automatically.</p>
                  </div>
                  {isActive && (
                    <FormWithNotice action={openThreadClosurePetitionAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="threadId" value={data.selectedThread.id} />
                      <SubmitButton variant="secondary">Propose closure</SubmitButton>
                    </FormWithNotice>
                  )}
                </div>
                {data.discussionMessages.length > 0 ? (
                  <div className="mb-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                    {data.discussionMessages.map((msg) => (
                      <div key={msg.id} className="bg-[var(--subtle)] px-3 py-2">
                        <p className="text-sm leading-6 text-[var(--soft-text)]">{msg.body}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {msg.author.displayName} &middot; <LocalTime value={msg.createdAt.toISOString()} options={COMPACT_DATE} />
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No active messages in this thread." />
                )}
                {isActive ? (
                  <form action={postDiscussionMessageAction} className="space-y-2">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="threadId" value={data.selectedThread.id} />
                    <textarea name="body" required rows={3} className="field-input resize-none" placeholder="Add a temporary coordination note." />
                    <SubmitButton variant="secondary">Post message</SubmitButton>
                  </form>
                ) : (
                  <p className="text-xs text-[var(--muted)]">Quiet members can read discussion but cannot post.</p>
                )}
              </>
            ) : (
              <EmptyState text="No active discussion thread selected." />
            )}
          </div>
        </div>
      ) : (
        <EmptyState text="No active discussion threads yet." />
      )}
      {isActive && (
        <CreateThreadForm action={createDiscussionThreadAction} groupId={groupId} />
      )}
    </CollapsibleSection>
  );
}
