import { CollapsibleSection } from "../../../../../../components/shared/CollapsibleSection";
import { SubmitButton } from "../../../../../../components/shared/SubmitButton";
import { LocalTime } from "../../../../../../components/shared/LocalTime";
import { GovernanceSignalForm } from "../../../../../../components/shared/GovernanceSignalForm";
import { GovernanceMeter } from "../../../../../../components/shared/GovernanceMeter";
import { CATEGORY_REGISTRY, governanceCategoryDescription, governanceSignalLabels, type GovernanceCategory } from "../../../../../../lib/governance-categories";
import { governanceCategoryLabel } from "../../../../../../lib/petition-evaluation";
import { COMPACT_DATE } from "../_shared/format";
import { declareEmergencyAction, proposeGroupVisibilityAction, proposeMembershipPolicyChangeAction, updateGovernanceSignalAction } from "./actions";

const PARAM_LABELS: Record<string, string> = {
  threshold: "Approval Threshold",
  petitionDuration: "Petition Window",
  reconfirmationPeriod: "Reconfirmation Period",
  duration: "Emergency Duration",
  messageRetentionDays: "Message Retention",
  threadInactivityDays: "Thread Inactivity",
  quietThresholdDays: "Quiet After",
  dormantThresholdDays: "Dormant After",
};

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatParamValue(param: string, value: number): string {
  if (param === "threshold") return formatPercent(value);
  return `${Math.round(value * 10) / 10}d`;
}

export type GovernanceSettingItem = {
  category: GovernanceCategory;
  categorySignal: number;
  temperature: number;
  parameters: Array<{ name: string; value: number; temperature: number; signal: number; hasOwnSignal: boolean }>;
};

export function GovernanceModule({
  group,
  activeEmergency,
  governanceSettings,
  isActive,
  groupId,
}: {
  group: { visibility: string; membershipPolicy: string };
  activeEmergency: { expiresAt: Date } | null;
  governanceSettings: GovernanceSettingItem[];
  isActive: boolean;
  groupId: string;
}) {
  return (
    <CollapsibleSection id="governance" title="Governance Settings" eyebrow="Decision friction" storageKey={`group:${groupId}:section:governance`} className="bg-[var(--surface)] p-5 sm:p-6">
      <div className="space-y-4">

        {/* Collective visibility — bidirectional & reversible */}
        {group.visibility === "private" ? (
          <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
            <p className="text-sm font-medium text-[var(--text)]">Visibility</p>
            <p className="mt-1 text-xs text-[var(--soft-text)]">
              This collective is private and will not appear on the Find Collectives page.
              {isActive && " Active members can petition to make it publicly discoverable."}
            </p>
            {isActive && (
              <form action={proposeGroupVisibilityAction} className="mt-3">
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="target" value="public" />
                <SubmitButton variant="secondary">Propose Public Visibility</SubmitButton>
              </form>
            )}
          </div>
        ) : (
          <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
            <p className="text-sm font-medium text-[var(--text)]">Visibility</p>
            <p className="mt-1 text-xs text-[var(--soft-text)]">
              This collective is publicly visible on the Find Collectives page.
              {isActive && " Active members can petition to make it private again."}
            </p>
            {isActive && (
              <form action={proposeGroupVisibilityAction} className="mt-3">
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="target" value="private" />
                <SubmitButton variant="secondary">Propose Private Visibility</SubmitButton>
              </form>
            )}
          </div>
        )}

        {/* Membership model — open vs application-based, changeable by petition (feedback #2).
            Nested with Visibility as a collective-wide setting; the petition uses the group's
            membership thresholds. */}
        <div className="border border-[var(--border)] bg-[var(--subtle)] p-3">
          <p className="text-sm font-medium text-[var(--text)]">Membership model</p>
          {group.membershipPolicy === "open" ? (
            <>
              <p className="mt-1 text-xs text-[var(--soft-text)]">
                Anyone may join this collective directly.
                {isActive && " Active members can petition to require an approved application to join."}
              </p>
              {isActive && (
                <form action={proposeMembershipPolicyChangeAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="target" value="request_required" />
                  <SubmitButton variant="secondary">Propose application-based membership</SubmitButton>
                </form>
              )}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-[var(--soft-text)]">
                Joining requires an approved membership application.
                {isActive && " Active members can petition to switch to open membership."}
              </p>
              {isActive && (
                <form action={proposeMembershipPolicyChangeAction} className="mt-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="target" value="open" />
                  <SubmitButton variant="secondary">Propose open membership</SubmitButton>
                </form>
              )}
            </>
          )}
        </div>

        <div className="border border-[var(--border)] divide-y divide-[var(--border)]">
        {governanceSettings.map((setting) => (
          <div key={setting.category} className="bg-[var(--subtle)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">{governanceCategoryLabel(setting.category)}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--soft-text)]">
                  {governanceCategoryDescription(setting.category)}
                </p>
              </div>
              {/* Temperature indicator: -1 (blue/careful) → 0 (neutral) → +1 (green/permissive) */}
              <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 ${
                setting.temperature > 0.2 ? "bg-green-100 text-green-800" :
                setting.temperature < -0.2 ? "bg-blue-100 text-blue-800" :
                "bg-[var(--subtle)] text-[var(--muted)]"
              }`}>
                {setting.temperature > 0.2 ? "Permissive" : setting.temperature < -0.2 ? "Careful" : "Neutral"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {setting.parameters.map((p) => `${PARAM_LABELS[p.name] ?? p.name}: ${formatParamValue(p.name, p.value)}`).join(" · ")}
            </p>
            <div className="mt-3">
              <GovernanceSignalForm
                action={updateGovernanceSignalAction}
                groupId={groupId}
                category={setting.category}
                parameter="_"
                currentSignal={setting.categorySignal}
                labels={governanceSignalLabels(setting.category as GovernanceCategory, "_")}
                size="md"
              />
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--text)] select-none">
                Characteristics
              </summary>
              <div className="mt-2 space-y-3 border-l border-[var(--border)] pl-3">
                {setting.parameters.map((parameter) => {
                  // Anchors are [restrictive (−1), default (0), permissive (+1)]; label the gauge
                  // ends with the factual extreme values rather than value-laden words.
                  const anchors = CATEGORY_REGISTRY[setting.category]?.[parameter.name]?.anchors;
                  return (
                  <div key={parameter.name} className="flex flex-col gap-1.5">
                    <span className="text-xs text-[var(--soft-text)]">
                      {PARAM_LABELS[parameter.name] ?? parameter.name} · {formatParamValue(parameter.name, parameter.value)}
                      {!parameter.hasOwnSignal && setting.categorySignal !== 0 ? " · using bulk vote" : ""}
                    </span>
                    <GovernanceMeter
                      temperature={parameter.temperature}
                      minLabel={anchors ? formatParamValue(parameter.name, anchors[0]) : undefined}
                      maxLabel={anchors ? formatParamValue(parameter.name, anchors[2]) : undefined}
                    />
                    <GovernanceSignalForm
                      action={updateGovernanceSignalAction}
                      groupId={groupId}
                      category={setting.category}
                      parameter={parameter.name}
                      currentSignal={parameter.signal}
                      labels={governanceSignalLabels(setting.category as GovernanceCategory, parameter.name)}
                    />
                  </div>
                  );
                })}
              </div>
            </details>
          </div>
        ))}
        </div>

        {/* Emergency declaration — placed last and behind a confirm gate so it's hard to
            trigger by accident. Declaring opens an emergency petition (may activate quickly). */}
        {activeEmergency ? (
          <div className="border border-amber-400 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Emergency period active</p>
            <p className="mt-0.5 text-xs text-amber-700">
              Expires <LocalTime value={activeEmergency.expiresAt.toISOString()} options={COMPACT_DATE} />
            </p>
          </div>
        ) : isActive && (
          <details className="border border-[var(--border)] bg-[var(--subtle)] p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-amber-700 hover:text-amber-600 transition select-none">
              Declare emergency period…
            </summary>
            <div className="mt-2">
              <p className="text-xs leading-5 text-[var(--soft-text)]">
                This opens an emergency declaration petition, which can activate quickly once it reaches the approval threshold. Emergency periods temporarily change how the collective governs itself — only declare one if your collective genuinely needs it.
              </p>
              <form action={declareEmergencyAction} className="mt-3">
                <input type="hidden" name="groupId" value={groupId} />
                <SubmitButton variant="secondary">Confirm — declare emergency period</SubmitButton>
              </form>
            </div>
          </details>
        )}
      </div>
    </CollapsibleSection>
  );
}
