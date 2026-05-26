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
  getVideoCategoriesWithKey,
  getVideosByIds,
  getVideosByIdsWithKey,
} from "./youtube";
import { generateProfile } from "./profiler";
import { saveProfile } from "./profile-service";

const PLAYLIST_PROBE_LIMIT = 5;        // 분석할 playlist 개수 상한 (quota 보호)
const PLAYLIST_VIDEOS_PER = 10;
const PLAYLIST_VIDEOS_TOTAL = 40;      // videos.list 한 번에 50 까지

export async function performTakeoutSync(userId: string, entries: { videoId: string }[]) {
  try {
    const videoIds = Array.from(new Set(entries.map((e) => e.videoId))).slice(0, 50);

    const [categoryMap, videoDetails] = await Promise.all([
      getVideoCategoriesWithKey(),
      getVideosByIdsWithKey(videoIds),
    ]);

    // Takeout 데이터는 시청 기록이므로 likedVideos 항목으로 취급하여 분석기에 전달
    // (분석기는 likedVideos 를 핵심 관심사로 인식함)
    const result = generateProfile({
      subscriptions: [],
      likedVideos: videoDetails,
      channelDetails: [],
      categoryNameById: categoryMap,
      playlistVideos: [],
      activities: [],
    });

    console.log("[takeout-sync] counts", {
      entries: entries.length,
      videoDetails: videoDetails.length,
      categoryMapEntries: Object.keys(categoryMap).length,
    });

    const saved = await saveProfile(userId, result);
    await cache.del(profileCacheKey(userId));
    return saved;
  } catch (e: any) {
    console.error("[takeout-sync] error", e);
    throw e;
  }
}

export async function performAutoSync(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: { where: { provider: "google" }, take: 1 } },
  });

  const token = user?.accessToken ?? user?.accounts[0]?.access_token;
  const scope = user?.accounts[0]?.scope ?? "";

  console.log("[sync] Starting auto sync for user:", userId, {
    hasToken: !!token,
    tokenPrefix: token ? token.substring(0, 7) + "..." : "none",
    scope,
  });

  if (!token) {
    console.error("[sync] No token found for user", userId);
    throw new Error("YouTube 접근 권한이 없습니다. 로그아웃 후 다시 로그인해 주세요.");
  }

  if (!scope.includes("youtube.readonly")) {
    console.warn("[sync] Token lacks youtube.readonly scope", { scope });
    throw new Error("INSUFFICIENT_PERMISSIONS");
  }

  try {
    // 1차 fetch: 카테고리 맵 / 구독 / 좋아요 / playlists / activities 병렬.
    // 필수 데이터(subs, likes)는 에러 발생 시 중단되도록 catch 제거.
    const [categoryMap, subs, likes, playlists, activities] = await Promise.all([
      getVideoCategories(token),
      getSubscriptions(token, 50),
      getLikedVideos(token, 50),
      getMyPlaylists(token, 25).catch(() => []),
      getMyActivities(token, 50).catch(() => []),
    ]);

    if (subs.length === 0 && likes.length === 0) {
      console.warn("[sync] No subs or likes found. Profile might be empty.");
    }

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

    const saved = await saveProfile(userId, result);
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
