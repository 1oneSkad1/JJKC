// channel_analyze_plan §6: /discover — 클러스터 기반 채널 추천 페이지.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ChannelRecommendations } from "@/components/channel-recommendations";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/");

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">채널 발견</h1>
        <p className="text-sm text-muted-foreground">
          한국 유튜브 채널(구독자 10만+)을 클러스터링해, 당신의 알고리즘에 맞는
          채널을 추천합니다.
        </p>
      </header>
      <ChannelRecommendations userId={userId} />
    </section>
  );
}
