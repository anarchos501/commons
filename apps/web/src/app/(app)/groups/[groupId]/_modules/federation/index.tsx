import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { EmptyState } from "../../../../../../components/shared/EmptyState";
import { FormWithNotice } from "../../../../../../components/shared/FormWithNotice";
import { proposeFederatedStanceAction } from "./actions";

export type FederationModulePeer = {
  peerNodeId: string;
  label: string;
  domain: string;
  agreementActive: boolean;
  stance: "closed" | "visible" | "interactive";
  suspended: boolean;
};

export type FederationModuleData = {
  isPrivate: boolean;
  peers: FederationModulePeer[];
  remoteCoalitions: Array<{ presenceId: string; name: string; homeDomain: string; status: string }>;
};

const STANCE_HELP: Record<string, string> = {
  closed: "Invisible to that node's federated surfaces (the default).",
  visible: "Discoverable in that node's federated listings, but not interactive.",
  interactive: "That node's members may join or interact through the normal processes.",
};

export function FederationModule({
  data,
  isActive,
  groupId,
}: {
  data: FederationModuleData;
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection
      id="federation"
      title="Federation"
      eyebrow="This collective, toward peer nodes"
      storageKey={`group:${groupId}:section:federation`}
      className="bg-[var(--surface)] p-5 sm:p-6"
    >
      <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
        This node&apos;s federation agreements let this collective open itself toward a specific peer node —
        but nothing is exposed until you choose to. Every collective starts <strong>closed</strong> toward
        every peer.
      </p>

      {data.remoteCoalitions.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Cross-node coalitions</p>
          {data.remoteCoalitions.map((coalition) => (
            <a
              key={coalition.presenceId}
              href={`/coalitions/remote/${coalition.presenceId}`}
              className="block border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
            >
              {coalition.name}
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">@ {coalition.homeDomain} · {coalition.status}</span>
            </a>
          ))}
        </div>
      )}

      {data.isPrivate ? (
        // register D-4/A3: private groups hold no stance — a deliberate-acts
        // explainer stands in for the panel, and the honest-scope line makes
        // clear the grant layer is not what protects a private group.
        <div className="border border-[var(--border)] bg-[var(--subtle)] p-3 text-xs leading-5 text-[var(--soft-text)]">
          <p className="font-medium text-[var(--text)]">This is a private collective.</p>
          <p className="mt-1">
            Private collectives cannot hold a visibility stance toward a peer node — there is nothing for a
            stance to open, because a private collective is never part of any node&apos;s ambient federated
            surface. Its only cross-node exposure is a <strong>deliberate shared act</strong>: joining a
            cross-node coalition or co-hosting a project. The act itself is the consent, and disclosure is
            scoped to that shared entity&apos;s membership — never to the peer node broadly.
          </p>
        </div>
      ) : data.peers.length === 0 ? (
        <EmptyState text="This node has no federated peer nodes yet." />
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-[var(--muted)]">
            Stances govern the <strong>federated layer</strong> only — discovery in a peer&apos;s listings and
            inbound interaction. This collective&apos;s public page is already readable by anyone on the open
            web, including a peer node&apos;s members; no stance can retract that.
          </p>
          {data.peers.map((peer) => (
            <div key={peer.peerNodeId} className="border border-[var(--border)] bg-[var(--subtle)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text)]">{peer.label}</p>
                <span className="text-xs capitalize text-[var(--muted)]">
                  {peer.suspended ? "suspended" : peer.stance}
                  {!peer.agreementActive ? " · no active agreement" : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">{peer.domain}</p>
              {peer.suspended && (
                <p className="mt-1 text-xs text-[var(--soft-text)]">
                  Grants toward this node are suspended because the federation agreement ended. They resume if
                  the node federates again.
                </p>
              )}
              {isActive && peer.agreementActive && (
                <FormWithNotice action={proposeFederatedStanceAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="peerNodeId" value={peer.peerNodeId} />
                  <label className="block">
                    <span className="field-label">Propose stance</span>
                    <select name="target" className="field-input" defaultValue={peer.stance}>
                      {(["closed", "visible", "interactive"] as const).map((stance) => (
                        <option key={stance} value={stance}>
                          {stance}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton variant="secondary">Open stance petition</SubmitButton>
                </FormWithNotice>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">{STANCE_HELP[peer.stance]}</p>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
