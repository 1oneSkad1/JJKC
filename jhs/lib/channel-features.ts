// channel_analyze_plan §3: 채널 원시 응답 → AlgoProfile 호환 벡터.
//
// profiler.ts 가 사용자 신호로 만드는 것과 같은 카테고리 namespace 를 쓰도록
// category-utils 의 공용 헬퍼를 재사용한다. 핵심(§0.1): 채널 단독 topicCategories
// 만으론 사용자 벡터의 videoCategory 축과 정렬이 어긋나므로, 최근 업로드의
// videoCategoryId 를 강신호(+5)로 보강한다.

import type { ChannelMetrics } from "./types";
import {
  bump,
  mainstreamScoreOf,
  median,
  nicheScoreOf,
  normalizeTopN,
  topicNameFromUrl,
} from "./category-utils";

type Any = Record<string, any>;

const CH_TOPIC_WEIGHT = 2;        // 채널 topicCategories
const UP_CATEGORY_WEIGHT = 5;     // 업로드 videoCategoryId (강신호, 사용자 축과 정렬)
const UP_TOPIC_WEIGHT = 3;        // 업로드 topicCategories
const MAX_KEYWORDS = 12;

// 한글 음절 비율 (가–힣). 한국 채널 판정 휴리스틱의 핵심 신호.
function hangulRatio(text: string): number {
  let hangul = 0;
  let letters = 0;
  for (const ch of text) {
    if (/[가-힣]/.test(ch)) {
      hangul++;
      letters++;
    } else if (/[a-zA-Z]/.test(ch)) {
      letters++;
    }
  }
  return letters > 0 ? hangul / letters : 0;
}

const KEYWORD_STOP = new Set([
  "the", "and", "for", "with", "you", "your", "this", "that", "official",
  "channel", "youtube", "subscribe", "video", "videos", "구독", "채널", "영상",
]);

function tokenizeKeywords(raw: string): string[] {
  // 한국어는 형태소 분석 대신 공백/기호 토큰화 (향후 mecab-ko 고려 — plan §9).
  return raw
    .split(/[\s,./|·#"'`()\[\]{}<>:;!?~\-—]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !KEYWORD_STOP.has(t));
}

export interface ChannelFeatureInput {
  channel: Any;        // channels.list 항목
  uploads?: Any[];     // 최근 업로드 videos.list 항목들 (보강, 선택)
  categoryNameById?: Record<string, string>;
}

export interface ChannelFeatures {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string;
  description: string | null;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  country: string | null;
  isKorean: boolean;
  categories: Record<string, number>;
  keywords: string[];
  metrics: ChannelMetrics;
}

// snippet.country / branding.country / 한글비율 / 업로드 언어 다수결.
export function isKoreanChannel(channel: Any, uploads: Any[] = []): boolean {
  const country: string | undefined =
    channel.snippet?.country ?? channel.brandingSettings?.channel?.country;
  if (country === "KR") return true;
  if (country && country !== "KR") {
    // 명시적 비-KR 이면 한글 비율이 아주 높을 때만 인정.
    const text = `${channel.snippet?.title ?? ""} ${channel.snippet?.description ?? ""}`;
    return hangulRatio(text) >= 0.5;
  }
  const text = `${channel.snippet?.title ?? ""} ${channel.snippet?.description ?? ""}`;
  if (hangulRatio(text) >= 0.3) return true;

  // 업로드 언어 다수결.
  let ko = 0;
  let total = 0;
  uploads.forEach((v) => {
    const lang: string | undefined =
      v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage;
    if (lang) {
      total++;
      if (lang.toLowerCase().startsWith("ko")) ko++;
    }
  });
  if (total > 0 && ko / total >= 0.5) return true;
  return false;
}

export function extractChannelFeatures(input: ChannelFeatureInput): ChannelFeatures {
  const { channel: c, uploads = [], categoryNameById = {} } = input;

  const categoryScore: Record<string, number> = {};
  const keywordScore: Record<string, number> = {};

  // 채널 topicCategories.
  (c.topicDetails?.topicCategories ?? []).forEach((url: string) => {
    const name = topicNameFromUrl(url);
    if (name) bump(categoryScore, name, CH_TOPIC_WEIGHT);
  });

  // 채널 자기정의 keywords.
  const branding: string | undefined = c.brandingSettings?.channel?.keywords;
  if (branding) {
    const tokens =
      branding.match(/"[^"]+"|\S+/g)?.map((t) =>
        t.replace(/^"|"$/g, "").toLowerCase(),
      ) ?? [];
    tokens.forEach((t) => {
      if (t.length >= 2 && !KEYWORD_STOP.has(t)) bump(keywordScore, t, 2);
    });
  }

  // 제목/설명 토큰.
  tokenizeKeywords(
    `${c.snippet?.title ?? ""} ${c.snippet?.description ?? ""}`,
  ).forEach((t) => bump(keywordScore, t, 1));

  // ── 업로드 보강 (§0.1) ──────────────────────────────────────
  const uploadViews: number[] = [];
  const uploadDates: number[] = [];
  uploads.forEach((v) => {
    const catId = v.snippet?.categoryId;
    const catName = (catId && categoryNameById[catId]) || null;
    if (catName) bump(categoryScore, catName, UP_CATEGORY_WEIGHT);

    (v.topicDetails?.topicCategories ?? []).forEach((url: string) => {
      const name = topicNameFromUrl(url);
      if (name) bump(categoryScore, name, UP_TOPIC_WEIGHT);
    });

    (v.snippet?.tags ?? []).forEach((t: string) => {
      const k = t.trim().toLowerCase();
      if (k.length >= 2 && !KEYWORD_STOP.has(k)) bump(keywordScore, k, 1);
    });

    const vc = parseInt(v.statistics?.viewCount ?? "0", 10);
    if (Number.isFinite(vc) && vc > 0) uploadViews.push(vc);
    const t = Date.parse(v.snippet?.publishedAt ?? "");
    if (!Number.isNaN(t)) uploadDates.push(t);
  });

  const subscriberCount = parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0;
  const videoCount = parseInt(c.statistics?.videoCount ?? "0", 10) || 0;
  const viewCount = parseInt(c.statistics?.viewCount ?? "0", 10) || 0;

  // mainstream: 업로드 median view, 없으면 채널 평균(view/video).
  const medUploadViews =
    uploadViews.length > 0
      ? median(uploadViews)
      : videoCount > 0
        ? Math.round(viewCount / videoCount)
        : 0;

  // uploadsPerMonth: 업로드 publishedAt 범위로 추정.
  let uploadsPerMonth = 0;
  if (uploadDates.length >= 2) {
    const span = Math.max(...uploadDates) - Math.min(...uploadDates);
    const days = span / 86_400_000;
    if (days > 0) uploadsPerMonth = +((uploadDates.length / days) * 30).toFixed(1);
  }

  const metrics: ChannelMetrics = {
    mainstreamScore: mainstreamScoreOf(medUploadViews),
    nicheScore: nicheScoreOf(subscriberCount),
    uploadsPerMonth,
  };

  const keywords = Object.entries(keywordScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([k]) => k);

  return {
    id: c.id,
    title: c.snippet?.title ?? "(untitled)",
    handle: c.snippet?.customUrl ?? null,
    thumbnail:
      c.snippet?.thumbnails?.medium?.url ??
      c.snippet?.thumbnails?.default?.url ??
      "",
    description: c.snippet?.description ?? null,
    subscriberCount,
    videoCount,
    viewCount,
    country: c.snippet?.country ?? c.brandingSettings?.channel?.country ?? null,
    isKorean: isKoreanChannel(c, uploads),
    categories: normalizeTopN(categoryScore, 10),
    keywords,
    metrics,
  };
}
