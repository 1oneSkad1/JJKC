// plan.md Step 7: 타인 프로필 → 영상 피드.
//
// 비율: channels 30% / keywords 40% / categories 30%.
// 같은 viewer (= 호출자) 의 accessToken 으로 YouTube 를 친다 — 따라서
// "다른 사람의 알고리즘으로 보기" 가 viewer 자신의 quota 를 소모한다.
// 시연 단계에서는 단순함이 더 가치 있다.
//
// 캐싱 전략: cache key 에 target 의 `lastSyncedAt` epoch ms 를 version 으로
// 박는다. sync 가 일어나면 lastSyncedAt 가 바뀌어 새 key 가 만들어지고,
// 이전 key 는 자연 만료된다 — 명시적 invalidation 불필요.

import { prisma } from "./prisma";
import type { FeedVideo } from "./types";
import { getProfile } from "./profile-service";
import { cache, TTL } from "./cache";
import {
  getChannelUploads,
  getPopularByCategoryId,
  searchVideos,
} from "./youtube";

// YouTube category name → ID (region KR 기준 흔히 등장하는 것만).
const NAME_TO_CATEGORY_ID: Record<string, string> = {
  "Film & Animation": "1",
  "Autos & Vehicles": "2",
  Music: "10",
  "Pets & Animals": "15",
  Sports: "17",
  "Travel & Events": "19",
  Gaming: "20",
  "People & Blogs": "22",
  Comedy: "23",
  Entertainment: "24",
  "News & Politics": "25",
  "Howto & Style": "26",
  Education: "27",
  "Science & Technology": "28",
  "Nonprofits & Activism": "29",
};

function nameToCategoryId(name: string): string | null {
  return NAME_TO_CATEGORY_ID[name] ?? null;
}

async function viewerToken(viewerId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { accounts: { where: { provider: "google" }, take: 1 } },
  });
  return u?.accessToken ?? u?.accounts[0]?.access_token ?? null;
}

function pickTopK<T>(arr: T[], k: number): T[] {
  return arr.slice(0, k);
}

function interleave(parts: FeedVideo[][], total: number): FeedVideo[] {
  // dedupe across all parts, then round-robin.
  const seen = new Set<string>();
  const queues = parts.map((p) =>
    p.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    }),
  );

  const out: FeedVideo[] = [];
  while (out.length < total && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const v = q.shift();
      if (v) out.push(v);
      if (out.length >= total) break;
    }
  }
  return out;
}

function toVideo(
  source: FeedVideo["source"],
  item: any,
  fallbackTitle: string,
): FeedVideo | null {
  // playlistItems / search / videos 응답 스키마가 모두 달라 흡수.
  const id =
    item?.contentDetails?.videoId ||
    item?.id?.videoId ||
    (typeof item?.id === "string" ? item.id : null) ||
    item?.snippet?.resourceId?.videoId;
  if (!id) return null;
  return {
    id,
    title: item?.snippet?.title ?? fallbackTitle,
    channelId: item?.snippet?.channelId ?? "",
    channelName: item?.snippet?.channelTitle ?? "",
    thumbnail:
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    publishedAt: item?.snippet?.publishedAt ?? new Date().toISOString(),
    source,
  };
}

export type FeedResult =
  | { ok: true; videos: FeedVideo[]; counts: { channel: number; keyword: number; category: number }; cacheHit: boolean }
  | { ok: false; reason: "no_profile" | "no_token" | "private" };

const feedCacheKey = (
  viewerId: string,
  targetId: string,
  total: number,
  version: number,
) => `feed:v${version}:${viewerId}:${targetId}:${total}`;

export async function buildFeed(
  viewerId: string,
  targetUserId: string,
  total = 18,
): Promise<FeedResult> {
  const profile = await getProfile(targetUserId);
  if (!profile) return { ok: false, reason: "no_profile" };

  // 비공개 가드 — 본인은 자기 거 볼 수 있음.
  if (targetUserId !== viewerId) {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { isPublic: true },
    });
    if (!target?.isPublic) return { ok: false, reason: "private" };
  }

  const version = new Date(profile.lastSyncedAt).getTime() || 0;
  const ckey = feedCacheKey(viewerId, targetUserId, total, version);
  const cached = await cache.get<FeedResult>(ckey);
  if (cached && cached.ok) return { ...cached, cacheHit: true };

  const token = await viewerToken(viewerId);
  if (!token) return { ok: false, reason: "no_token" };

  const wantChannel = Math.round(total * 0.3);
  const wantKeyword = Math.round(total * 0.4);
  const wantCategory = total - wantChannel - wantKeyword;

  const channelIds = pickTopK(profile.topChannels.map((c) => c.id), 3);
  const keywords = pickTopK(profile.topKeywords, 4);
  const categoryIds = pickTopK(
    Object.keys(profile.categories)
      .map(nameToCategoryId)
      .filter((x): x is string => !!x),
    3,
  );

  const perChannel = Math.ceil(wantChannel / Math.max(channelIds.length, 1));
  const perKeyword = Math.ceil(wantKeyword / Math.max(keywords.length, 1));
  const perCategory = Math.ceil(wantCategory / Math.max(categoryIds.length, 1));

  const [chRes, kwRes, catRes] = await Promise.all([
    Promise.all(
      channelIds.map((id) =>
        getChannelUploads(token, id, perChannel).catch(() => []),
      ),
    ),
    Promise.all(
      keywords.map((kw) => searchVideos(token, kw, perKeyword).catch(() => [])),
    ),
    Promise.all(
      categoryIds.map((id) =>
        getPopularByCategoryId(token, id, perCategory).catch(() => []),
      ),
    ),
  ]);

  const ch = chRes.flat().map((it) => toVideo("channel", it, "Channel upload")).filter((v): v is FeedVideo => !!v).slice(0, wantChannel);
  const kw = kwRes.flat().map((it) => toVideo("keyword", it, "Search result")).filter((v): v is FeedVideo => !!v).slice(0, wantKeyword);
  const cat = catRes.flat().map((it) => toVideo("category", it, "Trending in category")).filter((v): v is FeedVideo => !!v).slice(0, wantCategory);

  const videos = interleave([ch, kw, cat], total);
  const result: FeedResult = {
    ok: true,
    videos,
    counts: { channel: ch.length, keyword: kw.length, category: cat.length },
    cacheHit: false,
  };
  await cache.set(ckey, result, TTL.feed);
  return result;
}
