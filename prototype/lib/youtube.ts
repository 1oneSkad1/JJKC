// YouTube Data API v3 thin wrapper. plan.md Step 4 + Step 7.
// Daily quota guard belongs at the call site (caching layer); we just
// surface the API verbs here.

import { google } from "googleapis";

export function getYouTubeClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.youtube({ version: "v3", auth });
}

export function getYouTubeClientWithKey() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set in environment variables.");
  }
  return google.youtube({ version: "v3", auth: apiKey });
}

// ---- Sync 단계 (Step 4) ----

export async function getSubscriptions(token: string, max = 50) {
  const yt = getYouTubeClient(token);
  const r = await yt.subscriptions.list({
    // snippet 의 publishedAt 이 "구독 시작 시각" — recency 가중에 사용.
    part: ["snippet", "contentDetails", "subscriberSnippet"],
    mine: true,
    maxResults: max,
    order: "alphabetical",
  });
  return r.data.items || [];
}

export async function getLikedVideos(token: string, max = 50) {
  const yt = getYouTubeClient(token);
  const r = await yt.videos.list({
    // statistics: viewCount/likeCount (대중성), contentDetails.duration: Shorts 비율.
    // snippet 에 defaultAudioLanguage / defaultLanguage 가 포함됨.
    part: ["snippet", "topicDetails", "contentDetails", "statistics"],
    myRating: "like",
    maxResults: max,
  });
  return r.data.items || [];
}

export async function getVideosByIdsWithKey(ids: string[]) {
  if (ids.length === 0) return [];
  const yt = getYouTubeClientWithKey();
  // ids 는 최대 50 개씩 끊어 보내는 게 정석. 호출자가 분할.
  const r = await yt.videos.list({
    part: ["snippet", "topicDetails", "contentDetails", "statistics"],
    id: ids.slice(0, 50),
    maxResults: 50,
  });
  return r.data.items || [];
}

export async function getVideoCategoriesWithKey(regionCode = "KR") {
  const yt = getYouTubeClientWithKey();
  const r = await yt.videoCategories.list({
    part: ["snippet"],
    regionCode,
    hl: "en_US",
  });
  const m: Record<string, string> = {};
  r.data.items?.forEach((it) => {
    if (it.id && it.snippet?.title) m[it.id] = it.snippet.title;
  });
  return m;
}

export async function getChannels(token: string, ids: string[]) {
  if (ids.length === 0) return [];
  const yt = getYouTubeClient(token);
  const r = await yt.channels.list({
    // brandingSettings: 채널이 자기 정의한 keywords — topicCategories 보완.
    part: [
      "snippet",
      "topicDetails",
      "statistics",
      "brandingSettings",
    ],
    id: ids.slice(0, 50),
    maxResults: 50,
  });
  return r.data.items || [];
}

let categoryCache: Record<string, string> | null = null;

export async function getVideoCategories(token: string, regionCode = "KR") {
  if (categoryCache) return categoryCache;

  const yt = getYouTubeClient(token);
  try {
    const r = await yt.videoCategories.list({
      part: ["snippet"],
      regionCode,
      hl: "en_US", 
    });
    const m: Record<string, string> = {};
    r.data.items?.forEach((it) => {
      if (it.id && it.snippet?.title) m[it.id] = it.snippet.title;
    });
    categoryCache = m;
    return m;
  } catch (e) {
    console.error("[youtube] Failed to fetch video categories", e);
    return {};
  }
}

// ---- 새 sync 소스 (rslt.md §2, §6 항목) ----

export async function getMyPlaylists(token: string, max = 25) {
  const yt = getYouTubeClient(token);
  const r = await yt.playlists.list({
    part: ["snippet", "contentDetails"],
    mine: true,
    maxResults: max,
  });
  return r.data.items || [];
}

export async function getPlaylistVideoIds(
  token: string,
  playlistId: string,
  max = 25,
): Promise<string[]> {
  const yt = getYouTubeClient(token);
  const r = await yt.playlistItems.list({
    part: ["contentDetails"],
    playlistId,
    maxResults: max,
  });
  return (r.data.items || [])
    .map((it: any) => it.contentDetails?.videoId)
    .filter((x: unknown): x is string => typeof x === "string");
}

export async function getVideosByIds(token: string, ids: string[]) {
  if (ids.length === 0) return [];
  const yt = getYouTubeClient(token);
  // ids 는 최대 50 개씩 끊어 보내는 게 정석. 호출자가 분할.
  const r = await yt.videos.list({
    part: ["snippet", "topicDetails", "contentDetails", "statistics"],
    id: ids.slice(0, 50),
    maxResults: 50,
  });
  return r.data.items || [];
}

export async function getMyActivities(token: string, max = 50) {
  const yt = getYouTubeClient(token);
  const r = await yt.activities.list({
    part: ["snippet", "contentDetails"],
    mine: true,
    maxResults: max,
  });
  return r.data.items || [];
}

// ---- Feed 단계 (Step 7) ----

export async function getChannelUploads(token: string, channelId: string, max = 5) {
  const yt = getYouTubeClient(token);
  // channels.list 로 uploads playlistId 받아오고 playlistItems 로 영상 조회.
  const chRes = await yt.channels.list({
    part: ["contentDetails", "snippet"],
    id: [channelId],
  });
  const uploads =
    chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const itRes = await yt.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId: uploads,
    maxResults: max,
  });
  return itRes.data.items || [];
}

export async function searchVideos(token: string, query: string, max = 5) {
  const yt = getYouTubeClient(token);
  const r = await yt.search.list({
    part: ["snippet"],
    q: query,
    type: ["video"],
    maxResults: max,
    safeSearch: "moderate",
  });
  return r.data.items || [];
}

export async function getPopularByCategoryId(
  token: string,
  categoryId: string,
  max = 5,
  regionCode = "KR",
) {
  const yt = getYouTubeClient(token);
  const r = await yt.videos.list({
    part: ["snippet", "statistics"],
    chart: "mostPopular",
    videoCategoryId: categoryId,
    maxResults: max,
    regionCode,
  });
  return r.data.items || [];
}
