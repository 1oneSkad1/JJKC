"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function VisibilityToggle({ initialPublic }: { initialPublic: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [isPublic, setIsPublic] = useState(initialPublic);

  return (
    <Button
      variant={isPublic ? "outline" : "secondary"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await fetch("/api/profile/visibility", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isPublic: !isPublic }),
          });
          if (res.ok) {
            setIsPublic(!isPublic);
            router.refresh();
          }
        })
      }
    >
      {isPublic ? "Public · 비공개로 전환" : "Private · 공개로 전환"}
    </Button>
  );
}
