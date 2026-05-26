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
import { AutoSyncTrigger } from "@/components/auto-sync-trigger";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User } from "lucide-react";

import Link from "next/link";
import { Zap, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sync?: string }>;
}) {
  const { sync } = await searchParams;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  const profile = await getProfile(userId);

  if (sync === "auto") {
    return (
      <section className="py-20">
        <AutoSyncTrigger />
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="space-y-10 py-10">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            {user.name ?? "안녕하세요"} 님, 환영합니다!
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            알고리즘 분석을 위해 YouTube 데이터를 어떻게 가져올까요?
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
          {/* Option A: Automatic OAuth Sync */}
          <Card className="flex flex-col h-full hover:border-primary/50 transition-colors border-2">
            <CardHeader>
              <div className="mb-4 bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>유튜브 자동 분석</CardTitle>
              <p className="text-sm text-muted-foreground">
                로그인 시 승인한 YouTube 권한을 사용하여 즉시 분석을 시작합니다.
              </p>
            </CardHeader>
            <CardContent className="flex-grow">
              <ul className="text-xs space-y-2 text-muted-foreground list-disc list-inside">
                <li>구독 목록과 좋아요 데이터를 기반으로 합니다.</li>
                <li>한 번의 클릭으로 편리하게 분석합니다.</li>
                <li>API 할당량 초과 시 이용이 제한될 수 있습니다.</li>
              </ul>
            </CardContent>
            <div className="p-6 pt-0 mt-auto">
              <SyncButton label="분석 시작하기" className="w-full" />
            </div>
          </Card>

          {/* Option B: Manual Takeout Upload */}
          <Card className="flex flex-col h-full hover:border-accent/50 transition-colors border-2">
            <CardHeader>
              <div className="mb-4 bg-accent/10 w-12 h-12 rounded-lg flex items-center justify-center">
                <FileUp className="h-6 w-6 text-accent" />
              </div>
              <CardTitle>파일 업로드</CardTitle>
              <p className="text-sm text-muted-foreground">
                Google Takeout에서 다운로드한 시청 기록 파일을 직접 업로드합니다.
              </p>
            </CardHeader>
            <CardContent className="flex-grow">
              <ul className="text-xs space-y-2 text-muted-foreground list-disc list-inside">
                <li>API 할당량 제한 없이 언제나 이용 가능합니다.</li>
                <li>시청 기록을 기반으로 더 정확하게 분석합니다.</li>
                <li>파일을 직접 생성하고 다운로드하는 과정이 필요합니다.</li>
              </ul>
            </CardContent>
            <div className="p-6 pt-0 mt-auto">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/takeout">Takeout 파일 업로드하기</Link>
              </Button>
            </div>
          </Card>
        </div>
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
  
  // 대시보드에 진입했다는 것은 로그인을 했다는 의미이므로, 무조건 정식 회원(isGuest = false)으로 취급합니다.
  const isGuest = false;
  const displayName = user.name?.startsWith("Guest #") ? "당신" : (user.name ?? "나");

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {user.image ? <AvatarImage src={user.image} alt={displayName} /> : null}
            <AvatarFallback>
              {isGuest ? (
                <User className="h-7 w-7 text-muted-foreground" />
              ) : (
                displayName.slice(0, 1).toUpperCase()
              )}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName}의 알고리즘
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
          {!isGuest && <VisibilityToggle initialPublic={user.isPublic} />}
          <SyncButton label="Re-sync" lastSyncedAt={profile.lastSyncedAt} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Category fingerprint</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryRadar rows={radar} aLabel={displayName} />
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

      {isGuest ? (
        <Card className="bg-accent/5 border-accent/20">
          <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-accent">더 많은 기능을 원하시나요?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                정식으로 회원가입을 하시면 내 알고리즘을 공유하고, 다른 사람과 비교할 수 있습니다.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/auth">회원가입 하러 가기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <SimilarUsers userId={userId} />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          오늘의 피드 — {displayName}의 알고리즘 기준 (channel 30 / keyword 40 / category 30)
        </h2>
        {!feed.ok ? (
          <p className="text-sm text-muted-foreground">
            {feed.reason === "no_token"
              ? "YouTube 권한이 만료되었습니다. 로그아웃 후 다시 로그인해 주세요."
              : "피드를 가져올 수 없습니다."}
          </p>
        ) : (
          <VideoGrid videos={videos} />
        )}
      </section>
    </section>
  );
}
