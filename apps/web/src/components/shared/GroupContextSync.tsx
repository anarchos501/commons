"use client";

import { useEffect } from "react";

export function GroupContextSync({ syncAction }: { syncAction: () => Promise<void> }) {
  useEffect(() => {
    syncAction();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
