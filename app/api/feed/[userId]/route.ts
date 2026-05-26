// GET /api/feed/[userId] — viewer 의 OAuth 토큰으로 target 의 알고리즘
// 기반 피드를 합성. 캐싱은 buildFeed 가 직접 한다 (version-keyed).

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { buildFeed } from "@/lib/feed-builder";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const me = await getSessionUserId();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { userId } = await params;
  const total = Math.min(
    36,
    Math.max(6, parseInt(new URL(req.url).searchParams.get("limit") ?? "18", 10) || 18),
  );

  const result = await buildFeed(me, userId, total);
  if (!result.ok) {
    const status =
      result.reason === "private" ? 403
      : result.reason === "no_token" ? 401
      : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json(result);
}
