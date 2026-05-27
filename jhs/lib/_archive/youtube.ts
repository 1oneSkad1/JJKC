// YouTube Data API v3 thin wrapper. plan.md Step 4 + Step 7.
// Daily quota guard belongs at the call site (caching layer); we just
// surface the API verbs here.

import { google } from "googleapis";

export function getYouTubeClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.youtube({ version: "v3", auth });
}

export type YouTubeClient = ReturnType<typeof getYouTubeClient>;

// channel_analyze_plan §2: 배치 수집은 공개 데이터 읽기뿐이라 API key 로 충분
// (OAuth 토큰보다 단순하고 사용자 컨텍스트 불필요). 키가 없으면 collect 스크립트가
// DB 의 OAuth 토큰으로 폴백한다.
export function getYouTubeClientByKey(apiKey: string) {
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

export async function getVideoCategories(token: string, regionCode = "KR") {
  const yt = getYouTubeClient(token);
  const r = await yt.videoCategories.list({
    part: ["snippet"],
    regionCode,
    hl: "en_US", // localized titles in English so they match feed-builder's NAME_TO_CATEGORY_ID
  });
  const m: Record<string, string> = {};
  r.data.items?.forEach((it) => {
    if (it.id && it.snippet?.title) m[it.id] = it.snippet.title;
  });
  return m;
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

// ---- Channel catalog 수집 (channel_analyze_plan §2) ----
// 아래 함수들은 이미 만들어 둔 client(yt)를 받아 재사용한다 — 배치 루프에서 한
// 번만 만들어 돌린다. API key client 와 OAuth client 둘 다 받을 수 있다.

// search.list type=channel — 토픽별 채널 seed. ★ 100u/페이지로 가장 비쌈.
export async function searchChannelIds(
  yt: YouTubeClient,
  q: string,
  opts: { regionCode?: string; pageToken?: string; max?: number } = {},
): Promise<{ channelIds: string[]; nextPageToken?: string }> {
  const r = await yt.search.list({
    part: ["snippet"],
    q,
    type: ["channel"],
    regionCode: opts.regionCode ?? "KR",
    relevanceLanguage: "ko",
    maxResults: opts.max ?? 50,
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
  });
  const ids = (r.data.items || [])
    .map((it: any) => it.snippet?.channelId || it.id?.channelId)
    .filter((x: unknown): x is string => typeof x === "string");
  return { channelIds: ids, nextPageToken: r.data.nextPageToken ?? undefined };
}

// videos.list chart=mostPopular → 트렌딩 영상의 channelId 추출 (1u/페이지, 메인스트림).
export async function mostPopularChannelIds(
  yt: YouTubeClient,
  opts: { categoryId?: string; regionCode?: string; pageToken?: string; max?: number } = {},
): Promise<{ channelIds: string[]; nextPageToken?: string }> {
  const r = await yt.videos.list({
    part: ["snippet"],
    chart: "mostPopular",
    regionCode: opts.regionCode ?? "KR",
    maxResults: opts.max ?? 50,
    ...(opts.categoryId ? { videoCategoryId: opts.categoryId } : {}),
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
  });
  const ids = (r.data.items || [])
    .map((it: any) => it.snippet?.channelId)
    .filter((x: unknown): x is string => typeof x === "string");
  return { channelIds: ids, nextPageToken: r.data.nextPageToken ?? undefined };
}

// channelSections.list → "추천 채널" 섹션의 featuredChannelsUrls (snowball, 1u).
export async function getFeaturedChannelIds(
  yt: YouTubeClient,
  channelId: string,
): Promise<string[]> {
  const r = await yt.channelSections.list({
    part: ["contentDetails", "snippet"],
    channelId,
  });
  const out = new Set<string>();
  (r.data.items || []).forEach((s: any) => {
    (s.contentDetails?.channels ?? []).forEach((c: string) => out.add(c));
  });
  return [...out];
}

// channels.list?id=<≤50> — enrich (snippet/stats/topic/branding/contentDetails).
export async function listChannelsByIds(yt: YouTubeClient, ids: string[]) {
  if (ids.length === 0) return [];
  const r = await yt.channels.list({
    part: [
      "snippet",
      "statistics",
      "topicDetails",
      "brandingSettings",
      "contentDetails",
    ],
    id: ids.slice(0, 50),
    maxResults: 50,
  });
  return r.data.items || [];
}

// uploads playlist → 최근 영상 ID (§0.1 카테고리 정렬용 보강).
export async function listUploadIds(
  yt: YouTubeClient,
  uploadsPlaylistId: string,
  max = 10,
): Promise<string[]> {
  const r = await yt.playlistItems.list({
    part: ["contentDetails"],
    playlistId: uploadsPlaylistId,
    maxResults: max,
  });
  return (r.data.items || [])
    .map((it: any) => it.contentDetails?.videoId)
    .filter((x: unknown): x is string => typeof x === "string");
}

// videos.list?id=<≤50> — 업로드 영상 메타(category/tags/duration/views).
export async function listVideosByIdsClient(yt: YouTubeClient, ids: string[]) {
  if (ids.length === 0) return [];
  const r = await yt.videos.list({
    part: ["snippet", "topicDetails", "contentDetails", "statistics"],
    id: ids.slice(0, 50),
    maxResults: 50,
  });
  return r.data.items || [];
}

// videoCategories id→name 맵 (client 버전).
export async function videoCategoryMap(
  yt: YouTubeClient,
  regionCode = "KR",
): Promise<Record<string, string>> {
  const r = await yt.videoCategories.list({
    part: ["snippet"],
    regionCode,
    hl: "en_US",
  });
  const m: Record<string, string> = {};
  (r.data.items || []).forEach((it: any) => {
    if (it.id && it.snippet?.title) m[it.id] = it.snippet.title;
  });
  return m;
}
