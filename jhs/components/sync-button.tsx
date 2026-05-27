"use client";

// Phase 0 임시: YouTube 동기화는 더 이상 없음. 버튼은 /onboard 로 라우팅한다.
// Phase 3 에서 onboard 페이지 완성 후 dashboard 의 호출처를 갱신하며 정리한다.

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncButton({ label = "알고리즘 입력하기" }: { label?: string }) {
  return (
    <Button asChild variant="accent" size="sm">
      <Link href="/onboard">
        <Pencil className="h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );
}
