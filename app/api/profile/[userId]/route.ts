// GET /api/profile/[userId] — 공개 알고리즘 프로필 조회 + 캐시.

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getProfileWithOwner } from "@/lib/profile-service";
import { cache, TTL } from "@/lib/cache";
import { profileCacheKey } from "@/lib/keys";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const me = await getSessionUserId();

  const key = profileCacheKey(userId);
  const cached = await cache.get<{
    owner: any;
    profile: any;
  }>(key);
  const hit = cached ?? (await getProfileWithOwner(userId));
  if (!hit) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!cached) await cache.set(key, hit, TTL.profile);

  // 비공개 프로필은 본인만 볼 수 있다.
  if (!hit.owner.isPublic && me !== userId) {
    return NextResponse.json({ error: "private" }, { status: 403 });
  }
  return NextResponse.json({
    ...hit,
    cacheHit: !!cached,
  });
}
