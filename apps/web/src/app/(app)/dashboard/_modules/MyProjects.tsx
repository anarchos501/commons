import { CollapsibleSection } from "../../../../components/shared/CollapsibleSection";
import { EmptyState } from "../../../../components/shared/EmptyState";

// Threads, not stats: render the projects you're part of as a navigable list (length is incidental),
// each linking into its scoped lens. Never a leading total.
export type MyProject = { id: string; name: string; status: string };

export function MyProjects({ projects }: { projects: MyProject[] }) {
  return (
    <CollapsibleSection id="my-projects" title="My projects" eyebrow="Projects you're part of" storageKey="dashboard:my-projects" className="bg-[var(--surface)] p-5 sm:p-6">
      {projects.length ? (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
              <a href={`/projects/${p.id}`} className="text-sm text-[var(--text)] hover:text-[var(--accent)]">{p.name}</a>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">{p.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="You're not part of any project yet." />
      )}
    </CollapsibleSection>
  );
}
