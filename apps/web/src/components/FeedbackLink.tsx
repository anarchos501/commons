"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function FeedbackLink({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentPath = `${pathname}${query ? `?${query}` : ""}`;
  return (
    <Link href={`/feedback?path=${encodeURIComponent(currentPath)}`} className={className}>
      Report Feedback
    </Link>
  );
}
