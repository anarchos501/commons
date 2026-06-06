"use client";

import { useEffect } from "react";

export function ClearPendingInviteToken({ groupId }: { groupId: string }) {
  useEffect(() => {
    void fetch(`/groups/${encodeURIComponent(groupId)}/pending-invite-token`, {
      method: "DELETE",
    });
  }, [groupId]);

  return null;
}
