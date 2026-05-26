"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function FollowButton({
  targetUserId,
  initialFollowing,
}: {
  targetUserId: string;
  initialFollowing: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={following ? "outline" : "accent"}
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await fetch(`/api/follow/${targetUserId}`, {
              method: following ? "DELETE" : "POST",
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              setError(body?.error ?? "failed");
              return;
            }
            setFollowing(!following);
            router.refresh();
          })
        }
      >
        {pending ? "…" : following ? "Following" : "Follow"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
