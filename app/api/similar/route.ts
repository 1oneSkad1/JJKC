// GET /api/similar?userId= — rslt.md §4 "당신과 닮은 알고리즘" 추천.
// 공개 프로필 중에서 카테고리 cosine + 키워드 Jaccard 종합 점수로 정렬.

import { NextResponse } from "next/server";
import { getProfile, listPublic } from "@/lib/profile-service";
import { profileSimilarity } from "@/lib/profiler";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const limit = Math.min(12, Math.max(1, parseInt(url.searchParams.get("limit") ?? "5", 10) || 5));
  if (!userId) {
    return NextResponse.json({ error: "?userId= required" }, { status: 400 });
  }

  const me = await getProfile(userId);
  if (!me) {
    return NextResponse.json({ error: "no_profile" }, { status: 404 });
  }

  const { items } = await listPublic({ limit: 100 });
  const scored = items
    .filter((it) => it.owner.id !== userId)
    .map((it) => ({
      owner: it.owner,
      profile: it.profile,
      similarity: profileSimilarity(
        { categories: me.categories, topKeywords: me.topKeywords },
        { categories: it.profile.categories, topKeywords: it.profile.topKeywords },
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return NextResponse.json({ items: scored });
}
