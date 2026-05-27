// sources/* 모듈의 통합 진입점. feed-builder 와 onboard 가 사용.
//
// 설계:
//   - searchChannels(query): 카탈로그 LIKE 검색 → ChannelRecord[]
//   - channelUploads(channelId, limit): YouTube RSS → 최근 영상 N개
//   - listByCategory / listByKeyword: 카탈로그에서 카테고리·키워드 매칭 채널 → 그 채널들의 RSS 최근 영상
//   - popularByCategory: 카탈로그의 카테고리 top 채널들의 RSS 최근 영상 (트렌딩 대용)
//
// 모든 호출은 YouTube Data API 0u — RSS·oEmbed 또는 DB.

import type { FeedVideo } from "../types";
import { fetchChannelFeed, type RssVideo } from "./rss";
import {
  searchChannels as catalogSearchChannels,
  listByCategory,
  listByKeyword,
} from "./catalog";

// RssVideo → FeedVideo (source label 만 다름)
export function rssToFeedVideo(
  v: RssVideo,
  source: FeedVideo["source"],
): FeedVideo {
  return {
    id: v.videoId,
    title: v.title,
    channelId: v.channelId,
    channelName: v.channelTitle,
    thumbnail: v.thumbnail,
    publishedAt: v.publishedAt,
    source,
  };
}

// 한 채널의 최근 업로드 N개 (RSS) → FeedVideo[]
export async function channelUploads(
  channelId: string,
  limit: number,
  source: FeedVideo["source"] = "channel",
): Promise<FeedVideo[]> {
  const feed = await fetchChannelFeed(channelId).catch(() => null);
  if (!feed) return [];
  return feed.videos.slice(0, limit).map((v) => rssToFeedVideo(v, source));
}

// onboard 폼의 채널 검색 — 카탈로그에서 LIKE 매칭
export { catalogSearchChannels as searchChannels };

// 키워드 → 매칭 채널들 → 각 채널의 RSS 최근 1~2 영상 (검색 영상 대용)
export async function videosByKeyword(
  keyword: string,
  want: number,
  opts: { perChannel?: number; minSubs?: number } = {},
): Promise<FeedVideo[]> {
  const perCh = opts.perChannel ?? 2;
  const candidates = await listByKeyword(keyword, {
    limit: Math.ceil(want / perCh) * 2, // 안전 마진
    minSubs: opts.minSubs,
  });
  // 카탈로그 키워드가 부족하면 title 검색까지 폴백.
  const channels = candidates.length
    ? candidates
    : await catalogSearchChannels(keyword, {
        limit: Math.ceil(want / perCh) * 2,
        minSubs: opts.minSubs,
      });

  const out: FeedVideo[] = [];
  for (const ch of channels) {
    if (out.length >= want) break;
    const videos = await channelUploads(ch.id, perCh, "keyword");
    out.push(...videos);
  }
  return out.slice(0, want);
}

// 카테고리 top-1 인 채널 top N 의 RSS 최근 영상들 (트렌딩 대용)
export async function videosByCategory(
  category: string,
  want: number,
  opts: { topChannels?: number; perChannel?: number; minSubs?: number } = {},
): Promise<FeedVideo[]> {
  const topChannels = opts.topChannels ?? 6;
  const perCh = opts.perChannel ?? 2;
  const channels = await listByCategory(category, {
    limit: topChannels,
    minSubs: opts.minSubs,
  });
  const out: FeedVideo[] = [];
  for (const ch of channels) {
    if (out.length >= want) break;
    const videos = await channelUploads(ch.id, perCh, "category");
    out.push(...videos);
  }
  return out.slice(0, want);
}
