import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { proposeProjectAction, openProjectHostingWithdrawalAction } from "./actions";

export type ProjectsModuleItem = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  _count: { hostings: number };
};

export function ProjectsModule({ projects, isActive, groupId }: { projects: ProjectsModuleItem[]; isActive: boolean; groupId: string }) {
  return (
    <CollapsibleSection id="projects" title="Hosted Projects" eyebrow="Federated coordination" storageKey={`group:${groupId}:section:projects`} className="bg-[var(--surface)] p-5 sm:p-6">
      <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
        Hosting is this collective&apos;s endorsement and support. It does not give the collective ownership of a project.
      </p>
      {projects.length > 0 ? (
        <div className="space-y-3">
          {projects.map((project) => (
            <div key={project.id} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
              <a href={`/projects/${project.id}`} className="block hover:bg-[var(--hover)] transition">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--text)]">{project.name}</p>
                  <span className="shrink-0 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)]">
                    Hosted here
                  </span>
                </div>
                {project.description && <p className="mt-1 text-xs text-[var(--soft-text)] line-clamp-2">{project.description}</p>}
                <p className="mt-2 text-xs text-[var(--muted)]">
                  <span className="capitalize">{project.status}</span>
                  <span aria-hidden="true"> &middot; </span>
                  {project._count.hostings} {project._count.hostings === 1 ? "host collective" : "host collectives"}
                </p>
              </a>
              {isActive && (
                <form action={openProjectHostingWithdrawalAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <SubmitButton variant="secondary">Open host-withdrawal petition</SubmitButton>
                </form>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="This collective does not currently host any projects." />
      )}
      {isActive && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a new project</summary>
          <form action={proposeProjectAction} className="mt-3 space-y-3">
            <input type="hidden" name="groupId" value={groupId} />
            <label className="block">
              <span className="field-label">Project name</span>
              <input name="name" type="text" required className="field-input" placeholder="e.g. Community Garden" />
            </label>
            <label className="block">
              <span className="field-label">Description</span>
              <textarea name="description" rows={2} className="field-input resize-none" placeholder="What will this project do?" />
            </label>
            <SubmitButton variant="secondary">Open proposal petition</SubmitButton>
          </form>
        </details>
      )}
    </CollapsibleSection>
  );
}
