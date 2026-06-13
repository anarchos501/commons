"use client";

import { useEffect, useState } from "react";

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/**
 * Renders a timestamp in the *viewer's* locale and timezone.
 *
 * Server components that format dates (e.g. `date.toLocaleString()`) use the server's
 * timezone, so everyone sees server time regardless of where they are. This component
 * defers formatting to the browser: the first paint is a deterministic UTC render (so SSR
 * markup is stable), then an effect re-formats in the local timezone once mounted.
 */
export function LocalTime({
  value,
  options = DEFAULT_OPTIONS,
}: {
  value: string; // ISO 8601 timestamp
  options?: Intl.DateTimeFormatOptions;
}) {
  const [text, setText] = useState(() =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value)),
  );
  useEffect(() => {
    setText(new Intl.DateTimeFormat(undefined, options).format(new Date(value)));
  }, [value, options]);
  return (
    <time dateTime={value} suppressHydrationWarning>
      {text}
    </time>
  );
}
