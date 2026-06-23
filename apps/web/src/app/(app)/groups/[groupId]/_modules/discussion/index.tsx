import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { DiscussionMessage } from "../../../../../../components/shared/DiscussionMessage";
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
  discussionMessages: Array<{ id: string; body: string; authorId: string; author: { displayName: string }; createdAt: Date }>;
};

export function DiscussionModule({
  data,
  isActive,
  groupId,
  viewerAccountId,
}: {
  data: DiscussionModuleData;
  isActive: boolean;
  groupId: string;
  viewerAccountId: string | null;
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
                <div className="mb-3">
                  <p className="text-sm font-semibold text-[var(--text)]">{data.selectedThread.title}</p>
                  <p className="text-xs text-[var(--muted)]">Messages expire automatically.</p>
                </div>
                {data.discussionMessages.length > 0 ? (
                  <div className="mb-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                    {data.discussionMessages.map((msg) => (
                      <DiscussionMessage
                        key={msg.id}
                        body={msg.body}
                        authorName={msg.author.displayName}
                        authorId={msg.authorId}
                        viewerAccountId={viewerAccountId}
                        createdAtIso={msg.createdAt.toISOString()}
                      />
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
                {/* Closing a thread is a deliberate, low-prominence action: a small corner
                    text link, not a button, so it can't be triggered by accident. */}
                {isActive && (
                  <div className="mt-3 flex justify-end">
                    <FormWithNotice action={openThreadClosurePetitionAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="threadId" value={data.selectedThread.id} />
                      <button
                        type="submit"
                        className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--soft-text)] hover:underline transition"
                      >
                        Propose closure
                      </button>
                    </FormWithNotice>
                  </div>
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
