// /api/sync 의 본체. plan.md Step 4 의 파이프라인.
//
//   tokens 확보 → (categories | subs | likes | playlists | activities) 병렬
//   → channel detail + playlist video detail 보강
//   → profiler.generateProfile → DB upsert → cache invalidate

import { prisma } from "./prisma";
import { cache } from "./cache";
import { profileCacheKey } from "./keys";
import {
  getChannels,
  getLikedVideos,
  getMyActivities,
  getMyPlaylists,
  getPlaylistVideoIds,
  getSubscriptions,
  getVideoCategories,
  getVideosByIds,
} from "./youtube";
import { generateProfile } from "./profiler";
import { saveProfile } from "./profile-service";

const PLAYLIST_PROBE_LIMIT = 5;        // 분석할 playlist 개수 상한 (quota 보호)
const PLAYLIST_VIDEOS_PER = 10;
const PLAYLIST_VIDEOS_TOTAL = 40;      // videos.list 한 번에 50 까지

export async function performAutoSync(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: { where: { provider: "google" }, take: 1 } },
  });

  const token = user?.accessToken ?? user?.accounts[0]?.access_token;
  if (!token) {
    throw new Error("No access token. Please sign in with Google again.");
  }

  try {
    // 1차 fetch: 카테고리 맵 / 구독 / 좋아요 / playlists / activities 병렬.
    const [categoryMap, subs, likes, playlists, activities] = await Promise.all([
      getVideoCategories(token),
      getSubscriptions(token, 50),
      getLikedVideos(token, 50),
      getMyPlaylists(token, 25).catch(() => []),
      getMyActivities(token, 50).catch(() => []),
    ]);

    const channelIds: string[] = subs
      .map((s: any) => s.snippet?.resourceId?.channelId)
      .filter((x: unknown): x is string => typeof x === "string");

    // 2차 fetch: 채널 디테일 + playlist 영상 ID 수집.
    const probedPlaylists = (playlists as any[])
      .filter((p) => {
        // 본인이 만든 playlist 중에서도 "Liked videos" / "Watch later" 등 시스템 항목은
        // mine=true 응답에 보통 안 들어오지만 안전하게 제외 — title 기반.
        const t: string = (p.snippet?.title ?? "").toLowerCase();
        return !["liked videos", "watch later"].includes(t);
      })
      .slice(0, PLAYLIST_PROBE_LIMIT);

    const [channelDetails, ...playlistIdLists] = await Promise.all([
      getChannels(token, channelIds),
      ...probedPlaylists.map((p: any) =>
        p.id ? getPlaylistVideoIds(token, p.id, PLAYLIST_VIDEOS_PER).catch(() => []) : Promise.resolve([] as string[]),
      ),
    ]);

    const playlistVideoIds = Array.from(
      new Set(
        (playlistIdLists as string[][])
          .flat()
          .filter((id) => typeof id === "string"),
      ),
    ).slice(0, PLAYLIST_VIDEOS_TOTAL);

    // 3차 fetch: playlist 영상 메타.
    const playlistVideos = playlistVideoIds.length
      ? await getVideosByIds(token, playlistVideoIds).catch(() => [])
      : [];

    const result = generateProfile({
      subscriptions: subs,
      likedVideos: likes,
      channelDetails,
      categoryNameById: categoryMap,
      playlistVideos,
      activities,
    });

    console.log("[sync] counts", {
      subs: subs.length,
      likes: likes.length,
      channelDetails: channelDetails.length,
      playlists: (playlists as any[]).length,
      playlistVideos: playlistVideos.length,
      activities: activities.length,
      categoryMapEntries: Object.keys(categoryMap).length,
    });
    console.log("[sync] result.metrics", result.metrics);
    console.log("[sync] result.categories", result.categories);

    // channel_analyze_plan §1: 구독 채널 id 를 프로필에 저장(추가 쿼터 0) —
    // /discover 추천에서 "이미 구독한 채널 제외" 에 사용.
    const saved = await saveProfile(userId, result, channelIds);
    console.log("[sync] saved.metrics length", (saved as any).metrics?.length ?? null);
    // 프로필 캐시만 명시적으로 무효화.
    // 피드 캐시는 version-keyed (lastSyncedAt) — 새 sync 후 자동으로 새 key
    // 가 만들어져 stale key 가 자연 만료된다.
    await cache.del(profileCacheKey(userId));
    return saved;
  } catch (e: any) {
    if (e?.response?.status === 401 || e?.code === 401) {
      throw new Error(
        "YouTube 권한 만료. 로그아웃 후 다시 Google 로 로그인해 'YouTube 계정 보기' 권한을 허용해 주세요.",
      );
    }
    throw e;
  }
}
