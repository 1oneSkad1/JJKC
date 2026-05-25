// channel_analyze_plan §5: 사용자 AlgoProfile → (a) 클러스터 배정 + (b) 채널 랭킹.
//
// 모든 입력이 DB 에 있으므로 YouTube 호출 0u. 사용자↔사용자 추천과 같은 척도를
// 쓰려고 profiler 의 cosineSimilarity / profileSimilarity 를 그대로 재사용한다.

import type {
  AlgoProfileShape,
  ChannelRecommendation,
  ChannelRecord,
  ClusterAssignment,
  ClusterRecord,
} from "./types";
import { cosineSimilarity, profileSimilarity } from "./profiler";
import { getProfile } from "./profile-service";
import { listAllChannels, listClusters } from "./channel-service";

const SIM_W = 0.8;
const METRIC_W = 0.1;
const QUALITY_W = 0.1;

// 사용자 카테고리 벡터 ↔ 각 클러스터 centroid 코사인.
export function assignClusters(
  userCategories: Record<string, number>,
  clusters: ClusterRecord[],
  topN = 2,
): ClusterAssignment[] {
  return clusters
    .map((cluster) => ({
      cluster,
      score: Math.round(cosineSimilarity(userCategories, cluster.centroid) * 100),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// 사용자 niche/mainstream 취향과 채널 지표의 일치도 (0-100).
function metricMatch(user: AlgoProfileShape, ch: ChannelRecord): number {
  const nicheDiff = Math.abs(user.metrics.nicheChannelScore - ch.metrics.nicheScore);
  const mainDiff = Math.abs(user.metrics.mainstreamScore - ch.metrics.mainstreamScore);
  return Math.max(0, Math.min(100, 100 - (nicheDiff + mainDiff) / 2));
}

// 구독자수 기반 약한 popularity prior (10만=0, 1억=100).
function qualityPrior(ch: ChannelRecord): number {
  if (ch.subscriberCount <= 0) return 0;
  const v = ((Math.log10(ch.subscriberCount) - 5) / 3) * 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface RankOptions {
  limit?: number;
  maxPerCluster?: number;   // 다양성: 한 클러스터 최대 노출 (MMR 류)
  excludeIds?: Set<string>;
}

export function rankChannels(
  user: AlgoProfileShape,
  channels: ChannelRecord[],
  clusterLabelById: Map<number, string>,
  opts: RankOptions = {},
): ChannelRecommendation[] {
  const limit = opts.limit ?? 24;
  const exclude = opts.excludeIds ?? new Set<string>();

  const scored = channels
    .filter((ch) => !exclude.has(ch.id))
    .map((ch) => {
      const sim = profileSimilarity(
        { categories: user.categories, topKeywords: user.topKeywords },
        { categories: ch.categories, topKeywords: ch.keywords },
      );
      const score = Math.round(
        SIM_W * sim + METRIC_W * metricMatch(user, ch) + QUALITY_W * qualityPrior(ch),
      );
      return {
        channel: ch,
        score,
        clusterId: ch.clusterId,
        clusterLabel: ch.clusterId != null ? clusterLabelById.get(ch.clusterId) ?? null : null,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (!opts.maxPerCluster) return scored.slice(0, limit);

  // 다양성 패스: 클러스터별 노출 상한을 두고 점수 순으로 채운 뒤 나머지로 보충.
  const perCluster = new Map<number, number>();
  const primary: ChannelRecommendation[] = [];
  const overflow: ChannelRecommendation[] = [];
  for (const r of scored) {
    const cid = r.clusterId ?? -1;
    const used = perCluster.get(cid) ?? 0;
    if (used < opts.maxPerCluster) {
      perCluster.set(cid, used + 1);
      primary.push(r);
    } else {
      overflow.push(r);
    }
  }
  return [...primary, ...overflow].slice(0, limit);
}

export interface RecommendResult {
  ok: boolean;
  reason?: "no_profile" | "empty_catalog";
  coldStart: boolean;
  assignments: ClusterAssignment[];
  recommendations: ChannelRecommendation[];
  catalogSize: number;
  clusterCount: number;
}

// DB 기반 오케스트레이션. API 라우트에서 캐시로 감싼다.
export async function recommendForUser(
  userId: string,
  opts: { limit?: number; maxPerCluster?: number } = {},
): Promise<RecommendResult> {
  const [profile, channels, clusters] = await Promise.all([
    getProfile(userId),
    listAllChannels({ onlyKorean: true }),
    listClusters(),
  ]);

  if (!profile) {
    return {
      ok: false,
      reason: "no_profile",
      coldStart: true,
      assignments: [],
      recommendations: [],
      catalogSize: channels.length,
      clusterCount: clusters.length,
    };
  }
  if (channels.length === 0) {
    return {
      ok: false,
      reason: "empty_catalog",
      coldStart: false,
      assignments: [],
      recommendations: [],
      catalogSize: 0,
      clusterCount: clusters.length,
    };
  }

  const catKeys = Object.keys(profile.categories);
  const coldStart = catKeys.length === 0 || (catKeys.length === 1 && catKeys[0] === "Discovery");

  const clusterLabelById = new Map(clusters.map((c) => [c.id, c.label]));
  const assignments = assignClusters(profile.categories, clusters, 2);

  // 제외: 이미 구독한 채널 + 프로필의 대표 채널.
  const exclude = new Set<string>([
    ...profile.subscribedChannelIds,
    ...profile.topChannels.map((c) => c.id),
  ]);

  const recommendations = rankChannels(profile, channels, clusterLabelById, {
    limit: opts.limit ?? 24,
    maxPerCluster: opts.maxPerCluster ?? 6,
    excludeIds: exclude,
  });

  return {
    ok: true,
    coldStart,
    assignments,
    recommendations,
    catalogSize: channels.length,
    clusterCount: clusters.length,
  };
}
