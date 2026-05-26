import Link from "next/link";
import { listPublic } from "@/lib/profile-service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const { items } = await listPublic({ limit: 24 });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="text-sm text-muted-foreground">
          공개된 알고리즘 프로필. 누구의 알고리즘으로 영상을 보고 싶나요?
        </p>
      </header>

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          아직 공개 프로필이 없습니다. 누군가가 로그인 후 sync 하고
          본인 dashboard 에서 "공개" 로 전환해야 여기에 표시됩니다.
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ owner, profile }) => {
            const displayName = owner.name;
            const top = Object.entries(profile.categories).sort(
              (a, b) => b[1] - a[1],
            )[0];
            return (
              <Card key={owner.id}>
                <CardHeader className="flex-row items-center gap-3 space-y-0">
                  <Avatar>
                    {owner.image ? (
                      <AvatarImage src={owner.image} alt={displayName} />
                    ) : null}
                    <AvatarFallback>
                      {owner.name.startsWith("Guest #") ? (
                        <User className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        displayName.slice(0, 1).toUpperCase()
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm">
                      {displayName}
                    </CardTitle>
                    <p className="truncate text-xs text-muted-foreground">
                      {owner.email ?? ""}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-muted-foreground">Top category</div>
                      <div className="font-medium">
                        {top ? `${top[0]} · ${top[1]}%` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Channels</div>
                      <div className="truncate">
                        {profile.topChannels
                          .slice(0, 2)
                          .map((c) => c.name)
                          .join(", ") || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.topKeywords.slice(0, 4).map((kw) => (
                      <Badge key={kw} variant="muted">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Link
                      href={`/profile/${owner.id}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Open profile →
                    </Link>
                    <Link
                      href={`/compare?b=${owner.id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Compare
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </ul>
      )}
    </section>
  );
}
