// plan.md Step 4: YouTube 페이로드 → AlgoProfile.
//
// 가중치:
//   - 구독 채널의 topicCategories      → +2 per topic per channel (recency 가중)
//   - 좋아요 비디오의 videoCategory    → +5 per video (강한 신호)
//   - 좋아요 비디오의 topicDetails     → +3 per topic per video
//   - 본인 playlist 내 영상의 category → +4 per video (명시적 큐레이션)
//   - activities.list 의 like/추가     → 최근일수록 +α boost (recency 가중)
//   - 좋아요 비디오의 tags / channel keywords → 키워드 누적
//
// categoryName 은 0-100 으로 정규화된 백분율을 반환한다 (UI 측 차트가
// 그대로 사용).

import type { TopChannel } from "./types";

export interface ProfileMetrics {
  // rslt.md §4: 카테고리 엔트로피 / 집중도.
  diversity: number;       // 0-100, 엔트로피 정규화
  concentration: number;   // 0-100, top1 점유율
  shortsRatio: number;     // 0-100, ≤60s 비율 (좋아요 영상 기준)
  longFormRatio: number;   // 0-100, ≥10min 비율
  languageDistribution: Record<string, number>; // ko/en/... → 백분율
  primaryLanguage: string | null;
  mainstreamScore: number; // 0-100, 좋아요 영상 viewCount 중앙값 → log 스케일
  nicheChannelScore: number; // 0-100, 채널 평균 subscriberCount 의 inverse-log
}

export interface ProfileResult {
  categories: Record<string, number>;
  topKeywords: string[];
  topChannels: TopChannel[];
  sampleVideoIds: string[];
  metrics: ProfileMetrics;
}

type Any = Record<string, any>;

const SUB_WEIGHT = 2;
const LIKE_WEIGHT = 5;
const LIKE_TOPIC_WEIGHT = 3;
const PLAYLIST_WEIGHT = 4;
const ACTIVITY_LIKE_WEIGHT = 1.5;
const MAX_CHANNELS = 10;
const MAX_KEYWORDS = 12;
const MAX_SAMPLES = 20;

// 구독 시작 시각이 최근일수록 가중. 365일 기준 1.0 ↔ 5년 0.4.
function recencyMultiplier(iso: string | undefined | null, now: number): number {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  // 1년 = 1.0, 이후 절반-수명 ~ 2년 으로 천천히 감쇠. 최소 0.4.
  return Math.max(0.4, 1 / (1 + ageDays / 730));
}

// 한 신호의 publishedAt 이 최근일수록 boost (활성 신호 가중치 추가).
function recencyBoost(iso: string | undefined | null, now: number): number {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  if (ageDays < 30) return 1.5;
  if (ageDays < 90) return 1.25;
  if (ageDays < 365) return 1.0;
  return 0.8;
}

// ISO 8601 duration (PT#H#M#S) → seconds.
function parseIsoDuration(iso?: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}

function topicNameFromUrl(url: string): string | null {
  const tail = url.split("/").pop();
  return tail ? tail.replace(/_/g, " ") : null;
}

function bump(map: Record<string, number>, key: string, by: number) {
  map[key] = (map[key] ?? 0) + by;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// 카테고리 엔트로피 (Shannon) → 0-100 normalize.
function entropyScore(scores: Record<string, number>): {
  diversity: number;
  concentration: number;
} {
  const values = Object.values(scores).filter((v) => v > 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || values.length <= 1) {
    return { diversity: 0, concentration: 100 };
  }
  let H = 0;
  for (const v of values) {
    const p = v / total;
    H -= p * Math.log(p);
  }
  const Hmax = Math.log(values.length);
  const diversity = Hmax > 0 ? Math.round((H / Hmax) * 100) : 0;
  const top = Math.max(...values);
  const concentration = Math.round((top / total) * 100);
  return { diversity, concentration };
}

export interface GenerateProfileInput {
  subscriptions: Any[];
  likedVideos: Any[];
  channelDetails: Any[];
  categoryNameById: Record<string, string>;
  playlistVideos?: Any[];   // playlists 의 영상들 — videos.list 결과 형태
  activities?: Any[];       // activities.list 결과
  now?: number;             // 테스트용
}

export function generateProfile(input: GenerateProfileInput): ProfileResult;
// 구버전 호환 시그니처도 그대로 받는다.
export function generateProfile(
  subscriptions: Any[],
  likedVideos: Any[],
  channelDetails: Any[],
  categoryNameById: Record<string, string>,
): ProfileResult;
export function generateProfile(
  a: GenerateProfileInput | Any[],
  b?: Any[],
  c?: Any[],
  d?: Record<string, string>,
): ProfileResult {
  const input: GenerateProfileInput = Array.isArray(a)
    ? {
        subscriptions: a,
        likedVideos: b ?? [],
        channelDetails: c ?? [],
        categoryNameById: d ?? {},
      }
    : a;

  const {
    subscriptions,
    likedVideos,
    channelDetails,
    categoryNameById,
    playlistVideos = [],
    activities = [],
    now = Date.now(),
  } = input;

  const categoryScore: Record<string, number> = {};
  const keywordScore: Record<string, number> = {};
  const langScore: Record<string, number> = {};
  const channels: TopChannel[] = [];
  const sampleVideoIds: string[] = [];

  // ── 구독 채널 ────────────────────────────────────────────────
  // subscription.snippet.publishedAt 기반 recency 가중.
  const subRecencyByChannelId = new Map<string, number>();
  subscriptions.forEach((s: any) => {
    const cid = s.snippet?.resourceId?.channelId;
    if (typeof cid === "string") {
      subRecencyByChannelId.set(cid, recencyMultiplier(s.snippet?.publishedAt, now));
    }
  });

  const subscriberCounts: number[] = [];

  channelDetails.forEach((c) => {
    const cid: string | undefined = typeof c.id === "string" ? c.id : undefined;
    const mult = cid ? subRecencyByChannelId.get(cid) ?? 1 : 1;

    const topics: string[] = c.topicDetails?.topicCategories ?? [];
    topics.forEach((url) => {
      const name = topicNameFromUrl(url);
      if (!name) return;
      bump(categoryScore, name, SUB_WEIGHT * mult);
    });

    // 채널이 자기 정의한 keywords (brandingSettings) — 따옴표 안 토큰 + 공백 토큰 둘 다.
    const branding: string | undefined = c.brandingSettings?.channel?.keywords;
    if (branding) {
      const tokens =
        branding.match(/"[^"]+"|\S+/g)?.map((t) =>
          t.replace(/^"|"$/g, "").toLowerCase(),
        ) ?? [];
      tokens.forEach((t) => {
        if (!t || t.length < 2) return;
        bump(keywordScore, t, 1);
      });
    }

    const subCnt = parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0;
    if (subCnt > 0) subscriberCounts.push(subCnt);

    if (c.snippet?.title && typeof c.id === "string") {
      channels.push({
        id: c.id,
        name: c.snippet.title,
        thumbnail:
          c.snippet.thumbnails?.medium?.url ??
          c.snippet.thumbnails?.default?.url ??
          "",
        videoCount: parseInt(c.statistics?.videoCount ?? "0", 10) || 0,
      });
    }
  });

  // ── 좋아요 영상 ──────────────────────────────────────────────
  let shortsCount = 0;
  let longCount = 0;
  let durSampled = 0;
  const viewCounts: number[] = [];

  likedVideos.forEach((v) => {
    const boost = recencyBoost(v.snippet?.publishedAt, now);

    const catId = v.snippet?.categoryId;
    const catName = (catId && categoryNameById[catId]) || "Other";
    bump(categoryScore, catName, LIKE_WEIGHT * boost);

    (v.topicDetails?.topicCategories ?? []).forEach((url: string) => {
      const name = topicNameFromUrl(url);
      if (!name) return;
      bump(categoryScore, name, LIKE_TOPIC_WEIGHT * boost);
    });

    (v.snippet?.tags ?? []).forEach((t: string) => {
      const k = t.trim().toLowerCase();
      if (!k) return;
      bump(keywordScore, k, 1);
    });

    const dur = parseIsoDuration(v.contentDetails?.duration);
    if (dur !== null) {
      durSampled++;
      if (dur <= 60) shortsCount++;
      else if (dur >= 600) longCount++;
    }

    const lang: string | undefined =
      v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage;
    if (lang) {
      // "en-US" → "en" 로 정규화.
      const base = lang.split("-")[0].toLowerCase();
      bump(langScore, base, 1);
    }

    const vc = parseInt(v.statistics?.viewCount ?? "0", 10);
    if (Number.isFinite(vc) && vc > 0) viewCounts.push(vc);

    if (sampleVideoIds.length < MAX_SAMPLES && typeof v.id === "string") {
      sampleVideoIds.push(v.id);
    }
  });

  // ── 본인 playlist 의 영상 ────────────────────────────────────
  playlistVideos.forEach((v) => {
    const boost = recencyBoost(v.snippet?.publishedAt, now);
    const catId = v.snippet?.categoryId;
    const catName = (catId && categoryNameById[catId]) || "Other";
    bump(categoryScore, catName, PLAYLIST_WEIGHT * boost);

    (v.snippet?.tags ?? []).forEach((t: string) => {
      const k = t.trim().toLowerCase();
      if (!k) return;
      bump(keywordScore, k, 1);
    });
  });

  // ── activities.list (최근 활동) ──────────────────────────────
  // activities.snippet.type: "like" | "subscription" | "upload" | "playlistItem" …
  // 최근 30일 활동에 카테고리/채널 가중치 boost.
  activities.forEach((a: any) => {
    const type = a.snippet?.type as string | undefined;
    const t = a.snippet?.publishedAt as string | undefined;
    if (!type || !t) return;
    const boost = recencyBoost(t, now);

    if (type === "like" || type === "favorite") {
      const cid = a.contentDetails?.like?.resourceId?.channelId;
      if (typeof cid === "string") {
        const mult = subRecencyByChannelId.get(cid) ?? 1;
        // 좋아요한 영상의 채널 topic 을 한 번 더 강화.
        const ch = channelDetails.find((c: any) => c.id === cid);
        (ch?.topicDetails?.topicCategories ?? []).forEach((url: string) => {
          const name = topicNameFromUrl(url);
          if (!name) return;
          bump(categoryScore, name, ACTIVITY_LIKE_WEIGHT * boost * mult);
        });
      }
    } else if (type === "subscription") {
      const cid = a.contentDetails?.subscription?.resourceId?.channelId;
      const ch = channelDetails.find((c: any) => c.id === cid);
      (ch?.topicDetails?.topicCategories ?? []).forEach((url: string) => {
        const name = topicNameFromUrl(url);
        if (!name) return;
        bump(categoryScore, name, ACTIVITY_LIKE_WEIGHT * boost);
      });
    }
  });

  // ── 정규화 ───────────────────────────────────────────────────
  const total = Object.values(categoryScore).reduce((a, b) => a + b, 0);
  let categories: Record<string, number> = {};
  if (total > 0) {
    const top = Object.entries(categoryScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const topTotal = top.reduce((a, [, v]) => a + v, 0) || 1;
    top.forEach(([name, score]) => {
      categories[name] = Math.round((score / topTotal) * 100);
    });
  } else {
    categories = { Discovery: 100 };
  }

  const topKeywords = Object.entries(keywordScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([k]) => k);

  // ── metrics ─────────────────────────────────────────────────
  const { diversity, concentration } = entropyScore(categoryScore);

  const shortsRatio = durSampled > 0
    ? Math.round((shortsCount / durSampled) * 100)
    : 0;
  const longFormRatio = durSampled > 0
    ? Math.round((longCount / durSampled) * 100)
    : 0;

  const langTotal = Object.values(langScore).reduce((a, b) => a + b, 0);
  const languageDistribution: Record<string, number> = {};
  let primaryLanguage: string | null = null;
  if (langTotal > 0) {
    const sorted = Object.entries(langScore).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, n]) => {
      languageDistribution[l] = Math.round((n / langTotal) * 100);
    });
    primaryLanguage = sorted[0][0];
  }

  const medViews = median(viewCounts);
  // 1k views ≈ 0, 100M ≈ 100. log10 scale.
  const mainstreamScore = medViews > 0
    ? Math.max(0, Math.min(100, Math.round(((Math.log10(medViews) - 3) / 5) * 100)))
    : 0;

  const medSubs = median(subscriberCounts);
  // 1k subs ≈ 100 (niche), 10M ≈ 0 (mega).
  const nicheChannelScore = medSubs > 0
    ? Math.max(0, Math.min(100, Math.round(100 - ((Math.log10(medSubs) - 3) / 4) * 100)))
    : 0;

  return {
    categories,
    topKeywords,
    topChannels: channels.slice(0, MAX_CHANNELS),
    sampleVideoIds,
    metrics: {
      diversity,
      concentration,
      shortsRatio,
      longFormRatio,
      languageDistribution,
      primaryLanguage,
      mainstreamScore,
      nicheChannelScore,
    },
  };
}

// rslt.md §4: 두 사용자의 categories 벡터 cosine similarity.
export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  keys.forEach((k) => {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  });
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// rslt.md §4: 두 키워드 집합의 Jaccard similarity.
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  sa.forEach((x) => {
    if (sb.has(x)) inter++;
  });
  const uni = sa.size + sb.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// 두 프로필의 종합 유사도 (0–100). 카테고리 0.7 + 키워드 0.3.
export function profileSimilarity(
  a: { categories: Record<string, number>; topKeywords: string[] },
  b: { categories: Record<string, number>; topKeywords: string[] },
): number {
  const cos = cosineSimilarity(a.categories, b.categories);
  const jac = jaccardSimilarity(a.topKeywords, b.topKeywords);
  return Math.round((0.7 * cos + 0.3 * jac) * 100);
}
