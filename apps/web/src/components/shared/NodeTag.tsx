// The node tag (F3(3), RFC-009 principle 6): the quiet, always-visible
// honesty affordance on every remote thing — legible boundaries beat
// seamless illusion. Renders "@ domain" (plus an optional status), styled to
// inform without shouting.
export function NodeTag({ domain, status }: { domain: string; status?: string | null }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-[var(--muted)]">
      <span aria-label={`hosted on ${domain}`}>@ {domain}</span>
      {status && status !== "active" && <span className="capitalize">· {status}</span>}
    </span>
  );
}
