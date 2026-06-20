import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { COMPACT_DATE } from "../_shared/format";
import {
  archiveBulletinAction,
  archivePublicationAction,
  proposeBulletinCreationAction,
  proposePublicationCreationAction,
  proposeLivingDocumentCreationAction,
  proposePubEntryCreationAction,
  proposeLivingDocumentRevisionAction,
} from "./actions";

export type LibraryModuleData = {
  bulletins: Array<{ id: string; title: string; body: string; author: { displayName: string }; publishedAt: Date }>;
  publications: Array<{ id: string; title: string; creator: { displayName: string }; _count: { entries: number } }>;
  livingDocuments: Array<{ id: string; title: string; currentBody: string; lastRevisedAt: Date }>;
};

export function LibraryModule({
  data,
  isActive,
  groupId,
}: {
  data: LibraryModuleData;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="library" title="Library" eyebrow="Resources" storageKey={`group:${groupId}:section:library`} className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="divide-y divide-[var(--border)] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-3">

        {/* Bulletins nested */}
        <details id="bulletins" className="group/lib">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Updates</span>
              <span className="mt-1 block text-xl font-bold tracking-tight">Bulletins</span>
            </span>
            <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
            <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
          </summary>
          <div className="px-5 sm:px-6 pb-5 space-y-3">
            {data.bulletins.length > 0 ? (
              <div className="mb-4 space-y-3">
                {data.bulletins.map((b) => (
                  <div key={b.id} className="border border-[var(--border)] p-3">
                    <p className="text-sm font-medium text-[var(--text)]">{b.title}</p>
                    <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-3">{b.body}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--muted)]">
                        {b.author.displayName} &middot; <LocalTime value={b.publishedAt.toISOString()} options={COMPACT_DATE} />
                      </p>
                      {isActive && (
                        <form action={archiveBulletinAction}>
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="bulletinId" value={b.id} />
                          <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                            Archive
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No bulletins yet." />
            )}
            {isActive && (
              <FormWithNotice action={proposeBulletinCreationAction} className="space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="A short title" />
                </label>
                <label className="block">
                  <span className="field-label">Body</span>
                  <textarea name="body" required rows={4} className="field-input resize-none" placeholder="Update text" />
                </label>
                <SubmitButton variant="secondary">Propose bulletin</SubmitButton>
              </FormWithNotice>
            )}
          </div>
        </details>

        {/* Publications nested */}
        <details id="publications" className="group/lib">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Knowledge collections</span>
              <span className="mt-1 block text-xl font-bold tracking-tight">Publications</span>
            </span>
            <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
            <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
          </summary>
          <div className="px-5 sm:px-6 pb-5 space-y-3">
            {data.publications.length > 0 ? (
              <div className="mb-4 space-y-3">
                {data.publications.map((p) => (
                  <div key={p.id} className="border border-[var(--border)] p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{p.title}</p>
                      <span className="shrink-0 text-xs text-[var(--muted)]">{p._count.entries} {p._count.entries === 1 ? "entry" : "entries"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--muted)]">{p.creator.displayName}</p>
                      {isActive && (
                        <form action={archivePublicationAction}>
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="publicationId" value={p.id} />
                          <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--soft-text)] transition">
                            Archive
                          </button>
                        </form>
                      )}
                    </div>
                    {isActive && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose an entry</summary>
                        <FormWithNotice action={proposePubEntryCreationAction} className="mt-2 space-y-2">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="publicationId" value={p.id} />
                          <label className="block">
                            <span className="field-label text-xs">Title (optional)</span>
                            <input name="title" type="text" className="field-input text-sm" placeholder="Entry title" />
                          </label>
                          <label className="block">
                            <span className="field-label text-xs">Body</span>
                            <textarea name="body" required rows={3} className="field-input resize-none text-sm" placeholder="Entry content" />
                          </label>
                          <SubmitButton variant="secondary">Propose entry</SubmitButton>
                        </FormWithNotice>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No publications yet." />
            )}
            {isActive && (
              <FormWithNotice action={proposePublicationCreationAction} className="space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="e.g. Community Resources" />
                </label>
                <SubmitButton variant="secondary">Propose publication</SubmitButton>
              </FormWithNotice>
            )}
          </div>
        </details>

        {/* Living Documents nested */}
        <details id="documents" className="group/lib">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-6 py-4">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Current reference texts</span>
              <span className="mt-1 block text-xl font-bold tracking-tight">Living Documents</span>
            </span>
            <span className="text-sm text-[var(--muted)] select-none group-open/lib:hidden">Expand</span>
            <span className="hidden text-sm text-[var(--muted)] select-none group-open/lib:inline">Collapse</span>
          </summary>
          <div className="px-5 sm:px-6 pb-5 space-y-4">
            {data.livingDocuments.length > 0 ? (
              <div className="mb-4 space-y-4">
                {data.livingDocuments.map((doc) => (
                  <div key={doc.id} className="border border-[var(--border)] p-3 space-y-2">
                    <p className="text-sm font-semibold text-[var(--text)]">{doc.title}</p>
                    <p className="text-xs leading-5 text-[var(--soft-text)] line-clamp-3">{doc.currentBody}</p>
                    <p className="text-xs text-[var(--muted)]">Last revised <LocalTime value={doc.lastRevisedAt.toISOString()} options={COMPACT_DATE} /></p>
                    {isActive && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a revision</summary>
                        <form action={proposeLivingDocumentRevisionAction} className="mt-2 space-y-2">
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="livingDocumentId" value={doc.id} />
                          <textarea name="body" required rows={4} defaultValue={doc.currentBody} className="field-input resize-none text-sm" />
                          <SubmitButton variant="secondary">Open revision petition</SubmitButton>
                        </form>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No living documents yet." />
            )}
            {isActive && (
              <FormWithNotice action={proposeLivingDocumentCreationAction} className="space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <label className="block">
                  <span className="field-label">Title</span>
                  <input name="title" type="text" required className="field-input" placeholder="e.g. Mission, Charter, Code of Conduct" />
                </label>
                <label className="block">
                  <span className="field-label">Body</span>
                  <textarea name="body" required rows={4} className="field-input resize-none" placeholder="The current text of this document." />
                </label>
                <SubmitButton variant="secondary">Propose document</SubmitButton>
              </FormWithNotice>
            )}
          </div>
        </details>

      </div>
    </CollapsibleSection>
  );
}
