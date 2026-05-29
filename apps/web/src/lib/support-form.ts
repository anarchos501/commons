export const trustPreferenceOptions = [
  { value: "lightweight", label: "Any available contributor" },
  { value: "elevated", label: "Trusted contributors only" },
] as const;

export function buildRequestDescription(input: { contact: string; location?: string; language?: string }) {
  return [
    `Private contact note: ${input.contact}`,
    input.location ? `Rough location: ${input.location}` : null,
    input.language ? `Language preference: ${input.language}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

export function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
