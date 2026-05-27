// plan.md Step 7: 타인 프로필 → 영상 피드. YouTube Data API 0u 버전.
//
// 비율 (원본 그대로): channels 30% / keywords 40% / categories 30%.
// 데이터 소스:
//   - 채널 30%: target.topChannels 의 RSS 직접 호출
//   - 키워드 40%: catalog 에서 키워드 매칭 채널 → 그 채널들 RSS
//   - 카테고리 30%: catalog 에서 카테고리 top 채널 → 그 채널들 RSS
//
// 캐싱 전략: cache key 에 target 의 lastSyncedAt epoch ms 를 version 으로 박는다.
// onboard 재제출 시 lastSyncedAt 가 바뀌어 새 key 가 만들어진다 — 자연 만료.

import { prisma } from "./prisma";
import type { FeedVideo } from "./types";
import { getProfile } from "./profile-service";
import { cache, TTL } from "./cache";
import {
  channelUploads,
  videosByCategory,
  videosByKeyword,
} from "./sources";

function pickTopK<T>(arr: T[], k: number): T[] {
  return arr.slice(0, k);
}

function interleave(parts: FeedVideo[][], total: number): FeedVideo[] {
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

export type FeedResult =
  | {
      ok: true;
      videos: FeedVideo[];
      counts: { channel: number; keyword: number; category: number };
      cacheHit: boolean;
    }
  | { ok: false; reason: "no_profile" | "private" | "unavailable" };

const feedCacheKey = (
  viewerId: string,
  targetId: string,
  total: number,
  version: number,
) => `feed:v2:${version}:${viewerId}:${targetId}:${total}`;

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

  const wantChannel = Math.round(total * 0.3);
  const wantKeyword = Math.round(total * 0.4);
  const wantCategory = total - wantChannel - wantKeyword;

  const channelIds = pickTopK(
    profile.topChannels.map((c) => c.id),
    3,
  );
  const keywords = pickTopK(profile.topKeywords, 4);
  const categories = pickTopK(Object.keys(profile.categories), 3);

  const perChannel = Math.max(
    1,
    Math.ceil(wantChannel / Math.max(channelIds.length, 1)),
  );
  const perKeyword = Math.max(
    1,
    Math.ceil(wantKeyword / Math.max(keywords.length, 1)),
  );
  const perCategory = Math.max(
    1,
    Math.ceil(wantCategory / Math.max(categories.length, 1)),
  );

  // 3 갈래를 병렬로 — 각 갈래 안에서는 RSS 호출이 sequential 하지만 갈래
  // 간에는 동시 진행 (Promise.all).
  const [chResults, kwResults, catResults] = await Promise.all([
    Promise.all(
      channelIds.map((id) =>
        channelUploads(id, perChannel, "channel").catch(() => []),
      ),
    ),
    Promise.all(
      keywords.map((kw) =>
        videosByKeyword(kw, perKeyword, { perChannel: 2 }).catch(() => []),
      ),
    ),
    Promise.all(
      categories.map((cat) =>
        videosByCategory(cat, perCategory, {
          topChannels: 4,
          perChannel: 2,
        }).catch(() => []),
      ),
    ),
  ]);

  const ch = chResults.flat().slice(0, wantChannel);
  const kw = kwResults.flat().slice(0, wantKeyword);
  const cat = catResults.flat().slice(0, wantCategory);

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
