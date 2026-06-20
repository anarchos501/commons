"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Clock, Languages, MapPin } from "lucide-react";
import { InfoIcon } from "./InfoIcon";

export type GroupOption = {
  groupId: string;
  groupName: string;
  services: string[];
  hasTrustedProviders: boolean;
  // True when this collective accepts custom requests AND a member is available for them.
  // When true, "Custom Request" is offered as a service for this collective.
  acceptsCustom?: boolean;
};

// Synthetic service label shown in the support-type dropdown for free-text custom requests.
export const CUSTOM_REQUEST_LABEL = "Custom Request";

interface Props {
  groupOptions: GroupOption[];
  allServices: string[];
  action: (formData: FormData) => Promise<void> | void;
  submitLabel?: string;
  noGroupsMessage?: string;
}

export function RequestHelpForm({ groupOptions, allServices, action, submitLabel = "Request support", noGroupsMessage = "Join a group first to request support." }: Props) {
  const [selectedService, setSelectedService] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [trustedOnly, setTrustedOnly] = useState(false);

  const anyGroupHasTrustedProviders = groupOptions.some((g) => g.hasTrustedProviders);

  const availableGroups = useMemo(() => {
    return groupOptions.filter((g) => {
      if (selectedService && !g.services.includes(selectedService)) return false;
      if (trustedOnly && !g.hasTrustedProviders) return false;
      return true;
    });
  }, [groupOptions, selectedService, trustedOnly]);

  const availableServices = useMemo(() => {
    return allServices.filter((service) => {
      if (selectedGroup) {
        const grp = groupOptions.find((g) => g.groupId === selectedGroup);
        if (!grp?.services.includes(service)) return false;
      } else if (trustedOnly) {
        return groupOptions.some((g) => g.services.includes(service) && g.hasTrustedProviders);
      }
      return true;
    });
  }, [groupOptions, allServices, selectedGroup, trustedOnly]);

  function handleServiceChange(service: string) {
    setSelectedService(service);
    if (service) {
      const matching = groupOptions.filter(
        (g) => g.services.includes(service) && (!trustedOnly || g.hasTrustedProviders),
      );
      if (matching.length === 1) {
        setSelectedGroup(matching[0].groupId);
      } else if (selectedGroup) {
        const currentGroupStillValid = matching.some((g) => g.groupId === selectedGroup);
        if (!currentGroupStillValid) setSelectedGroup("");
      }
    }
  }

  function handleTrustedToggle(checked: boolean) {
    setTrustedOnly(checked);
    if (checked) {
      if (selectedGroup) {
        const grp = groupOptions.find((g) => g.groupId === selectedGroup);
        if (!grp?.hasTrustedProviders) setSelectedGroup("");
      }
    }
  }

  const hasNoGroups = groupOptions.length === 0;

  return (
    <form action={action} className="space-y-5">
      {hasNoGroups && (
        <p className="text-sm text-[var(--muted)]">{noGroupsMessage}</p>
      )}

      {/* What do you need help with */}
      <div className="block">
        <span className="field-label inline-flex items-center gap-1.5">
          What do you need support with?
          <InfoIcon description="" />
        </span>
        <select
          className="field-input"
          value={selectedService}
          onChange={(e) => handleServiceChange(e.target.value)}
          disabled={hasNoGroups}
          required
          aria-label="Support type"
        >
          <option value="">— Select a service —</option>
          {availableServices.map((s) => (
            <option key={s} value={s}>
              {capitalize(s)}
            </option>
          ))}
        </select>
        {/* Submit "custom" for the synthetic custom option; the category/service name otherwise. */}
        <input type="hidden" name="serviceType" value={selectedService === CUSTOM_REQUEST_LABEL ? "custom" : selectedService} />
        {selectedService === CUSTOM_REQUEST_LABEL && (
          <div className="mt-3">
            <label className="field-label block" htmlFor="rh-customNeed">Describe what you need</label>
            <textarea
              id="rh-customNeed"
              name="customNeed"
              required
              maxLength={1000}
              rows={3}
              className="field-input resize-y"
              placeholder="Briefly describe the help you are looking for."
            />
          </div>
        )}
      </div>

      {/* Which collective */}
      <div className="block">
        <span className="field-label inline-flex items-center gap-1.5">
          Which collective should provide support?
          <InfoIcon description="" />
        </span>
        <select
          name="groupId"
          className="field-input"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          disabled={hasNoGroups}
          required
        >
          <option value="">— Select a collective —</option>
          {availableGroups.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.groupName}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Not sure which collective?{" "}
          <Link href="/groups" className="text-[var(--accent)] hover:underline">
            Browse available collectives
          </Link>
          .
        </p>
      </div>

      {/* Trusted contributors filter */}
      {anyGroupHasTrustedProviders && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={trustedOnly}
            onChange={(e) => handleTrustedToggle(e.target.checked)}
            className="h-4 w-4 accent-[#0d9488]"
          />
          <span className="text-sm text-[var(--soft-text)]">Trusted contributors only</span>
          <InfoIcon description="" />
        </label>
      )}
      <input type="hidden" name="trustPreference" value={trustedOnly ? "elevated" : "lightweight"} />

      {/* Safe contact note */}
      <div className="block">
        <span className="field-label inline-flex items-center gap-1.5">
          Safe contact note
          <InfoIcon description="" />
        </span>
        <input
          name="contact"
          className="field-input"
          placeholder="Phone, email, or a safe way to reach you"
          required
        />
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Only shared after someone agrees to provide support. Kept inside the private request record.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="block">
          <span className="field-label !inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            How soon?
            <InfoIcon description="" />
          </span>
          <select name="urgency" className="field-input" defaultValue="normal">
            <option value="low">Whenever someone can</option>
            <option value="normal">Soon</option>
            <option value="high">Today if possible</option>
            <option value="urgent">Time-sensitive</option>
          </select>
        </div>
        <div className="block">
          <span className="field-label !inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />
            General area
            <InfoIcon description="" />
          </span>
          <input name="location" className="field-input" placeholder="Neighborhood or nearby area" />
        </div>
        <div className="block">
          <span className="field-label !inline-flex items-center gap-1.5">
            <Languages className="h-4 w-4" />
            Language
            <InfoIcon description="" />
          </span>
          <input name="language" className="field-input" placeholder="Optional" />
        </div>
      </div>

      <div className="block">
        <span className="field-label inline-flex items-center gap-1.5">
          How long should this request stay active?
          <InfoIcon description="" />
        </span>
        <select name="activeDays" className="field-input" defaultValue="30">
          <option value="3">3 days</option>
          <option value="7">1 week</option>
          <option value="14">2 weeks</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={hasNoGroups}
        className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
