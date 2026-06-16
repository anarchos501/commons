"use client";

import { useSyncExternalStore } from "react";

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

// A store that reports "server" during SSR and the initial hydration render, then "client"
// once mounted — without setState in an effect. The value never changes after hydration, so
// subscribe is a no-op.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Renders a timestamp in the *viewer's* locale and timezone.
 *
 * Server components that format dates (e.g. `date.toLocaleString()`) use the server's
 * timezone, so everyone sees server time regardless of where they are. This component
 * defers formatting to the browser: the first paint is a deterministic UTC render (so SSR
 * markup is stable), then it re-formats in the local timezone once hydrated. The
 * SSR-vs-client switch is driven by `useSyncExternalStore` rather than a mount effect, so
 * there is no synchronous setState during render.
 */
export function LocalTime({
  value,
  options = DEFAULT_OPTIONS,
}: {
  value: string; // ISO 8601 timestamp
  options?: Intl.DateTimeFormatOptions;
}) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const text = isClient
    ? new Intl.DateTimeFormat(undefined, options).format(new Date(value))
    : new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value));
  return (
    <time dateTime={value} suppressHydrationWarning>
      {text}
    </time>
  );
}
