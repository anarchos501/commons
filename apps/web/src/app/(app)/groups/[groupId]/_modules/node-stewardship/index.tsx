import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { openGroupStewardNominationAction, openGroupNoConfidenceAction, openStewardResignationAction, proposeNodeNameAction } from "./actions";

export type NodeGroupOption = { id: string; label: string; isPrivate: boolean };

export function NodeStewardshipModule({
  nodeState,
  nodeGroupOptions,
  nodeId,
  isActive,
  groupId,
}: {
  nodeState: { stewardGroupId: string | null };
  nodeGroupOptions: NodeGroupOption[];
  nodeId: string;
  isActive: boolean;
  groupId: string;
}) {
  const publicGroups = nodeGroupOptions.filter((g) => !g.isPrivate);
  const privateCount = nodeGroupOptions.length - publicGroups.length;
  const stewardLabel = nodeState.stewardGroupId
    ? (nodeGroupOptions.find((g) => g.id === nodeState.stewardGroupId)?.label ?? "a collective")
    : null;

  return (
    <CollapsibleSection id="node-stewardship" title="Node Governance" eyebrow="This node" storageKey={`group:${groupId}:section:node-stewardship`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="mb-4 space-y-2 border-b border-[var(--border)] pb-4">
        <p className="text-xs text-[var(--soft-text)]">
          Steward: {stewardLabel
            ? <span className="font-medium text-[var(--text)]">{stewardLabel}</span>
            : <span className="text-[var(--muted)]">none yet</span>}
        </p>
        <p className="text-xs text-[var(--soft-text)]">
          Collectives on this node: {publicGroups.length > 0 ? publicGroups.map((g) => g.label).join(", ") : "none public"}
          {privateCount > 0 ? ` · +${privateCount} private` : ""}
        </p>
        <a href="/node" className="inline-block text-xs text-[var(--accent)] hover:underline">Open node governance →</a>
      </div>
      <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
        This collective may open stewardship questions. Node users decide appointments and no-confidence votes.
      </p>
      {isActive && !nodeState.stewardGroupId && (
        <form action={openGroupStewardNominationAction} className="space-y-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="nodeId" value={nodeId} />
          <label className="block">
            <span className="field-label">Candidate collective</span>
            <select name="candidateGroupId" className="field-input" required>
              {nodeGroupOptions.filter((candidate) => !candidate.isPrivate).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
              ))}
            </select>
          </label>
          <SubmitButton variant="secondary">Open nomination petition</SubmitButton>
        </form>
      )}
      {isActive && nodeState.stewardGroupId && (
        <form action={openGroupNoConfidenceAction} className="space-y-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="nodeId" value={nodeId} />
          <p className="text-sm text-[var(--soft-text)]">Ask this collective whether to initiate a node-wide no-confidence vote.</p>
          <SubmitButton variant="secondary">Open initiation petition</SubmitButton>
        </form>
      )}
      {isActive && nodeState.stewardGroupId === groupId && (
        <form action={openStewardResignationAction} className="mt-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="nodeId" value={nodeId} />
          <SubmitButton variant="secondary">Open steward resignation petition</SubmitButton>
        </form>
      )}
      {isActive && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--accent)] hover:underline">Propose a node name</summary>
          <form action={proposeNodeNameAction} className="mt-3 space-y-3">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="nodeId" value={nodeId} />
            <label className="block">
              <span className="field-label">Proposed node name</span>
              <input name="proposedName" type="text" required maxLength={100} className="field-input" placeholder="e.g. Northside Commons" />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                If this collective approves, it escalates to a node-wide vote to rename the node.
              </span>
            </label>
            <SubmitButton variant="secondary">Open node name petition</SubmitButton>
          </form>
        </details>
      )}
      <a href="/node" className="mt-4 inline-block text-xs font-medium text-[var(--accent)] hover:underline">
        Open node governance
      </a>
    </CollapsibleSection>
  );
}
