// (DEPRECATED) /api/sync — 이전엔 YouTube → AlgoProfile 동기화 진입점이었으나
// YouTube Data API 의존을 걷어내면서 /onboard 폼 기반 입력으로 대체된다.
// Phase 3 에서 /api/onboard 가 신규 진입점이 된다. 그동안 호출되면 410 으로
// 안내한다.

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "deprecated",
      message:
        "YouTube API 동기화는 더 이상 지원되지 않습니다. /onboard 에서 폼으로 알고리즘 프로필을 만들어 주세요.",
      redirect: "/onboard",
    },
    { status: 410 },
  );
}
