import Link from "next/link";
import { auth } from "@/lib/auth";
import { getProfileWithOwner, listPublic } from "@/lib/profile-service";
import { CategoryRadar } from "@/components/category-radar";
import { KeywordCloud } from "@/components/keyword-cloud";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id;
  const aId = sp.a ?? me;
  const bId = sp.b;

  const { items } = await listPublic({ limit: 24 });
  const others = items.filter((it) => it.owner.id !== aId);

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
        <p className="text-sm text-muted-foreground">
          두 알고리즘의 카테고리 분포와 공통 키워드를 비교합니다.
        </p>
      </header>

      {!aId ? (
        <Card className="p-8 text-center space-y-4">
          <p className="text-muted-foreground">
            비교 기능을 이용하려면 먼저 로그인하거나 회원가입이 필요합니다.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/auth"
              className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              로그인 / 회원가입
            </Link>
          </div>
        </Card>
      ) : null}

      {aId && !bId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">비교할 상대를 선택하세요</CardTitle>
          </CardHeader>
          <CardContent>
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 비교 가능한 공개 프로필이 없습니다.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {others.map(({ owner }) => (
                  <li key={owner.id}>
                    <Link
                      href={`/compare?a=${aId}&b=${owner.id}`}
                      className="flex items-center gap-2 rounded-xl border p-3 hover:bg-muted"
                    >
                      <Avatar className="h-8 w-8">
                        {owner.image ? (
                          <AvatarImage src={owner.image} alt={owner.name} />
                        ) : null}
                        <AvatarFallback>
                          {owner.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm font-medium">
                        {owner.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {aId && bId ? <CompareView aId={aId} bId={bId} /> : null}
    </section>
  );
}

async function CompareView({ aId, bId }: { aId: string; bId: string }) {
  if (aId === bId) {
    return (
      <p className="text-sm text-muted-foreground">
        같은 사용자끼리는 비교할 수 없습니다. 다른 프로필을 선택해 주세요.
      </p>
    );
  }
  const [a, b] = await Promise.all([
    getProfileWithOwner(aId),
    getProfileWithOwner(bId),
  ]);
  if (!a || !b) {
    return (
      <p className="text-sm text-muted-foreground">
        한쪽 프로필을 찾을 수 없습니다.
      </p>
    );
  }
  if (!a.owner.isPublic || !b.owner.isPublic) {
    return (
      <p className="text-sm text-muted-foreground">
        두 프로필 모두 공개 상태여야 비교할 수 있습니다.
      </p>
    );
  }

  const keys = Array.from(
    new Set([
      ...Object.keys(a.profile.categories),
      ...Object.keys(b.profile.categories),
    ]),
  );
  const rows = keys
    .map((cat) => ({
      category: cat,
      a: a.profile.categories[cat] ?? 0,
      b: b.profile.categories[cat] ?? 0,
    }))
    .sort((x, y) => y.a + y.b - (x.a + x.b))
    .slice(0, 10);

  const shared = a.profile.topKeywords.filter((k) =>
    b.profile.topKeywords.includes(k),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {[a, b].map(({ owner }) => (
          <Card key={owner.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <Avatar>
                {owner.image ? (
                  <AvatarImage src={owner.image} alt={owner.name} />
                ) : null}
                <AvatarFallback>
                  {owner.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{owner.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {owner.email}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Category overlay</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryRadar
            rows={rows}
            aLabel={a.owner.name}
            bLabel={b.owner.name}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Shared keywords {shared.length ? `(${shared.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shared.length ? (
            <KeywordCloud keywords={shared} />
          ) : (
            <p className="text-sm text-muted-foreground">
              공통 키워드가 없습니다. 두 알고리즘이 거의 겹치지 않네요.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
