import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProfileWithOwner } from "@/lib/profile-service";
import { buildFeed } from "@/lib/feed-builder";
import { CategoryRadar } from "@/components/category-radar";
import { ChannelList } from "@/components/channel-list";
import { KeywordCloud } from "@/components/keyword-cloud";
import { VideoGrid } from "@/components/video-grid";
import { FollowButton } from "@/components/follow-button";
import { ProfileMetricsCard } from "@/components/profile-metrics";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id;

  const hit = await getProfileWithOwner(userId);
  if (!hit) notFound();
  if (!hit.owner.isPublic && me !== userId) {
    return (
      <section className="py-16 text-center text-sm text-muted-foreground">
        이 프로필은 비공개입니다.
      </section>
    );
  }
  const { owner, profile } = hit;

  const initialFollowing = me
    ? !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: me, followingId: userId } },
      }))
    : false;

  const radarRows = Object.entries(profile.categories).map(([category, pct]) => ({
    category,
    a: pct,
  }));

  const feed = me ? await buildFeed(me, userId, 18) : null;
  const feedVideos = feed && feed.ok ? feed.videos : [];

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {owner.image ? (
              <AvatarImage src={owner.image} alt={owner.name} />
            ) : null}
            <AvatarFallback>{owner.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {owner.name} 의 알고리즘
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
            <CategoryRadar rows={radarRows} aLabel={owner.name} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top channels & keywords</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ChannelList channels={profile.topChannels} />
            <KeywordCloud keywords={profile.topKeywords} />
          </CardContent>
        </Card>
      </div>

      <ProfileMetricsCard metrics={profile.metrics} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          {owner.name} 의 알고리즘으로 보기
        </h2>
        {!me ? (
          <p className="text-sm text-muted-foreground">
            피드를 보려면 로그인이 필요합니다.
          </p>
        ) : feed && !feed.ok ? (
          <p className="text-sm text-muted-foreground">
            {feed.reason === "unavailable"
              ? "외부 소스(RSS) 일시 불가."
              : "피드를 가져올 수 없습니다."}
          </p>
        ) : (
          <VideoGrid videos={feedVideos} />
        )}
      </div>
    </section>
  );
}
