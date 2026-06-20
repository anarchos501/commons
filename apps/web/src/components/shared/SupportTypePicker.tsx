"use client";

import { useState } from "react";

const CUSTOM_VALUE = "__custom__";

export type SupportTypeCategory = {
  id: string;
  label: string;
};

interface Props {
  categories: SupportTypeCategory[];
  customAvailable: boolean;
}

/**
 * Unified "what do you need support with?" control for the group-scoped request form.
 * Lists the categories that currently have an available provider plus, when the collective
 * accepts custom requests and a member is available for them, a "Custom Request" option.
 * Selecting "Custom Request" reveals a free-text field. Submits plain form fields the server
 * action already understands: `categoryId` (category) or `serviceType="custom"` (+ `customNeed`).
 */
export function SupportTypePicker({ categories, customAvailable }: Props) {
  const firstValue = categories[0]?.id ?? (customAvailable ? CUSTOM_VALUE : "");
  const [selected, setSelected] = useState(firstValue);
  const isCustom = selected === CUSTOM_VALUE;

  return (
    <div className="block">
      <span className="field-label inline-flex items-center gap-1.5">What do you need support with?</span>
      <select
        className="field-input"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Support type"
      >
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.label}
          </option>
        ))}
        {customAvailable && <option value={CUSTOM_VALUE}>Custom Request</option>}
      </select>

      {/* Plain fields the server action reads. For a category: categoryId set, serviceType empty.
          For custom: serviceType="custom", categoryId empty. */}
      <input type="hidden" name="categoryId" value={isCustom ? "" : selected} />
      <input type="hidden" name="serviceType" value={isCustom ? "custom" : ""} />

      {isCustom && (
        <div className="mt-3">
          <label className="field-label block" htmlFor="customNeed">
            Describe what you need
          </label>
          <textarea
            id="customNeed"
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
  );
}
