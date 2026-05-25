// GET /api/channels/recommend?userId=&limit= — channel_analyze_plan §6.
// 사용자 AlgoProfile → 클러스터 배정 + 미구독 채널 랭킹. 서빙 YouTube 호출 0u.

import { NextResponse } from "next/server";
import { recommendForUser } from "@/lib/channel-recommender";
import { cache, TTL } from "@/lib/cache";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10) || 24));
  if (!userId) {
    return NextResponse.json({ error: "?userId= required" }, { status: 400 });
  }

  const ckey = `rec:${userId}:${limit}`;
  const cached = await cache.get<Awaited<ReturnType<typeof recommendForUser>>>(ckey);
  if (cached) return NextResponse.json({ ...cached, cacheHit: true });

  const result = await recommendForUser(userId, { limit });
  if (!result.ok && result.reason === "no_profile") {
    return NextResponse.json({ error: "no_profile" }, { status: 404 });
  }
  // 빈 카탈로그/콜드스타트는 200 으로 메시지와 함께 (UI 가 안내).
  await cache.set(ckey, result, TTL.feed);
  return NextResponse.json({ ...result, cacheHit: false });
}
