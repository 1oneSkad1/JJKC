// GET /api/explore — 공개 알고리즘 프로필 목록 (커서 페이지네이션).

import { NextResponse } from "next/server";
import { listPublic } from "@/lib/profile-service";
import { cache, TTL } from "@/lib/cache";
import { exploreCacheKey } from "@/lib/keys";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(48, Math.max(1, parseInt(url.searchParams.get("limit") ?? "12", 10) || 12));

  const key = exploreCacheKey(cursor, limit);
  const cached = await cache.get<any>(key);
  if (cached) {
    return NextResponse.json({ ...cached, cacheHit: true });
  }

  const result = await listPublic({ cursor: cursor ?? undefined, limit });
  await cache.set(key, result, TTL.explore);
  return NextResponse.json({ ...result, cacheHit: false });
}
