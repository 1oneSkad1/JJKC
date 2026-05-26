// rslt.md §4: 카테고리 cosine + 키워드 Jaccard 로 닮은 사용자 추천.
// 서버 컴포넌트 — listPublic 의 결과를 profileSimilarity 로 점수 매겨 정렬.

import Link from "next/link";
import { getProfile, listPublic } from "@/lib/profile-service";
import { profileSimilarity } from "@/lib/profiler";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function SimilarUsers({
  userId,
  limit = 4,
}: {
  userId: string;
  limit?: number;
}) {
  const me = await getProfile(userId);
  if (!me) return null;

  const { items } = await listPublic({ limit: 60 });
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
    .filter((it) => it.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  if (scored.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">닮은 알고리즘</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            아직 비교할 공개 프로필이 충분하지 않습니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">닮은 알고리즘</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {scored.map(({ owner, similarity, profile }) => {
            const top = Object.entries(profile.categories).sort(
              (a, b) => b[1] - a[1],
            )[0];
            return (
              <li key={owner.id}>
                <Link
                  href={`/compare?a=${userId}&b=${owner.id}`}
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted"
                >
                  <Avatar className="h-9 w-9">
                    {owner.image ? (
                      <AvatarImage src={owner.image} alt={owner.name} />
                    ) : null}
                    <AvatarFallback>
                      {owner.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {owner.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {top ? `${top[0]} · ${top[1]}%` : "—"}
                    </div>
                  </div>
                  <Badge variant="accent">{similarity}%</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
