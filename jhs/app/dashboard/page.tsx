import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProfile } from "@/lib/profile-service";
import { buildFeed } from "@/lib/feed-builder";
import { CategoryRadar } from "@/components/category-radar";
import { CategoryBar } from "@/components/category-bar";
import { ChannelList } from "@/components/channel-list";
import { KeywordCloud } from "@/components/keyword-cloud";
import { VideoGrid } from "@/components/video-grid";
import { ProfileMetricsCard } from "@/components/profile-metrics";
import { SimilarUsers } from "@/components/similar-users";
import { SyncButton } from "@/components/sync-button";
import { VisibilityToggle } from "@/components/visibility-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  const profile = await getProfile(userId);
  if (!profile) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.name ?? "안녕하세요"} 님, 환영합니다.
          </h1>
          <p className="text-sm text-muted-foreground">
            아직 알고리즘 프로필이 없습니다. YouTube 와 한 번 동기화하면
            카테고리 / 채널 / 키워드 카드가 만들어집니다.
          </p>
        </header>
        <Card className="p-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            아래 버튼을 누르면 구독 채널과 좋아요 영상을 분석합니다 (약 5–15초).
          </p>
          <div className="flex justify-center">
            <SyncButton label="첫 동기화 시작" />
          </div>
        </Card>
      </section>
    );
  }

  const radar = Object.entries(profile.categories).map(([category, pct]) => ({
    category,
    a: pct,
  }));
  const bars = Object.entries(profile.categories)
    .map(([category, pct]) => ({ category, pct }))
    .sort((a, b) => b.pct - a.pct);

  const feed = await buildFeed(userId, userId, 12);
  const videos = feed.ok ? feed.videos : [];

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {user.image ? <AvatarImage src={user.image} alt={user.name ?? ""} /> : null}
            <AvatarFallback>
              {(user.name ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {user.name ?? "나"} 의 알고리즘
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                Last synced {new Date(profile.lastSyncedAt).toLocaleString()}
              </span>
              {feed.ok ? (
                <Badge variant="muted">
                  feed {feed.counts.channel}+{feed.counts.keyword}+{feed.counts.category}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggle initialPublic={user.isPublic} />
          <SyncButton label="Re-sync" />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Category fingerprint</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryRadar rows={radar} aLabel={user.name ?? "Me"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top categories</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBar data={bars} />
          </CardContent>
        </Card>
      </div>

      <ProfileMetricsCard metrics={profile.metrics} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top channels</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelList channels={profile.topChannels} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordCloud keywords={profile.topKeywords} />
          </CardContent>
        </Card>
      </div>

      <SimilarUsers userId={userId} />


      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          오늘의 피드 — 내 알고리즘 기준 (channel 30 / keyword 40 / category 30)
        </h2>
        {!feed.ok ? (
          <p className="text-sm text-muted-foreground">
            {feed.reason === "unavailable"
              ? "외부 소스(RSS) 일시 불가. 잠시 후 다시 시도해 주세요."
              : "피드를 가져올 수 없습니다."}
          </p>
        ) : (
          <VideoGrid videos={videos} />
        )}
      </section>
    </section>
  );
}
