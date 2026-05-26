import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProfileWithOwner } from "@/lib/profile-service";
import { buildFeed } from "@/lib/feed-builder";
import { CategoryRadar } from "@/components/category-radar";
import { CategoryBar } from "@/components/category-bar";
import { ChannelList } from "@/components/channel-list";
import { KeywordCloud } from "@/components/keyword-cloud";
import { VideoGrid } from "@/components/video-grid";
import { FollowButton } from "@/components/follow-button";
import { ProfileMetricsCard } from "@/components/profile-metrics";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id;

  // 게스트 소유권 확인 (쿠키)
  const cookieStore = await cookies();
  const isGuestOwner = cookieStore.get(`guest_owner_${userId}`)?.value === "true";

  const hit = await getProfileWithOwner(userId);
  if (!hit) notFound();
  
  // 공개 프로필이 아니면서, 본인도 아니고, 익명 소유자(쿠키)도 아니라면 차단
  if (!hit.owner.isPublic && me !== userId && !isGuestOwner) {
    return (
      <section className="py-16 text-center text-sm text-muted-foreground">
        이 프로필은 비공개입니다.
      </section>
    );
  }
  const { owner, profile } = hit;
  
  // 구글 계정이 연결되어 있거나 비밀번호가 설정되어 있으면 정식 회원으로 간주.
  // 둘 다 없는 경우에만(JSON 업로드만 한 경우) 게스트로 취급.
  const isGuest = !owner.password && !owner.googleId;
  
  // 이름 결정 로직: 
  // 본인(로그인 유저 또는 쿠키 소유자)인 경우 "당신"으로 표시, 그 외에는 저장된 이름(Guest #N 등) 그대로 표시
  const isMe = me === owner.id || isGuestOwner;
  const displayName = isMe ? "당신" : (owner.name || "User");

  const initialFollowing = me
    ? !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: me, followingId: userId } },
      }))
    : false;

  const radarRows = Object.entries(profile.categories).map(([category, pct]) => ({
    category,
    a: pct,
  }));

  const bars = Object.entries(profile.categories)
    .map(([category, pct]) => ({ category, pct }))
    .sort((a, b) => b.pct - a.pct);

  const feed = me ? await buildFeed(me, userId, 18) : null;
  const feedVideos = feed && feed.ok ? feed.videos : [];

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {owner.image ? (
              <AvatarImage src={owner.image} alt={displayName} />
            ) : null}
            <AvatarFallback>
              {isGuest ? (
                <User className="h-8 w-8 text-muted-foreground" />
              ) : (
                displayName.slice(0, 1).toUpperCase()
              )}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName}의 알고리즘
            </h1>
            <p className="text-xs text-muted-foreground">
              Last synced {new Date(profile.lastSyncedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me && me !== owner.id ? (
            <FollowButton
              targetUserId={owner.id}
              initialFollowing={initialFollowing}
            />
          ) : null}
          {me ? (
            <Link
              href={`/compare?a=${me}&b=${owner.id}`}
              className="rounded-full border px-4 py-1.5 text-xs hover:bg-muted"
            >
              Compare with me
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Category fingerprint</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryRadar rows={radarRows} aLabel={displayName} />
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

      <ProfileMetricsCard metrics={profile.metrics} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          {displayName}의 알고리즘으로 보기
        </h2>
        {!me ? (
          <p className="text-sm text-muted-foreground">
            피드를 보려면 로그인이 필요합니다.
          </p>
        ) : feed && !feed.ok ? (
          <p className="text-sm text-muted-foreground">
            {feed.reason === "no_token"
              ? "YouTube 권한 갱신이 필요합니다."
              : "피드를 가져올 수 없습니다."}
          </p>
        ) : (
          <VideoGrid videos={feedVideos} />
        )}
      </div>
    </section>
  );
}
