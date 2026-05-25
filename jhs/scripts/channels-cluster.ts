// channel_analyze_plan §4: 채널 카테고리 벡터 → 순수 TS k-means 클러스터링.
//
//   npm run channels:cluster -- [--k 12] [--min 6] [--max 20]
//
// centroid 는 { name: weight } 로 저장 → 추천(recommender)이 사용자 벡터와
// 같은 namespace 코사인으로 바로 비교. (dense 벡터/vocab 은 클러스터링 내부에서만 사용.)

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { kmeans, pickBestK, l2normalize } from "../lib/kmeans";
import { normalizeTopN } from "../lib/category-utils";

// .env 수동 로드 (DATABASE_URL 용).
const envPath = path.resolve(".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const prisma = new PrismaClient();

function arg(name: string, dflt?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
  "#6366f1", "#a855f7", "#ec4899", "#64748b", "#0ea5e9", "#84cc16",
  "#f43f5e", "#10b981", "#8b5cf6", "#d946ef", "#f59e0b", "#06b6d4",
  "#7c3aed", "#dc2626",
];

async function main() {
  const { listAllChannels, replaceClusters } = await import("../lib/channel-service");
  const all = await listAllChannels({ onlyKorean: true });
  const channels = all.filter((c) => Object.keys(c.categories).length > 0);

  if (channels.length < 4) {
    console.error(`❌ 클러스터링할 채널이 부족합니다 (${channels.length}개). 먼저 channels:collect 를 실행하세요.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // 전역 vocabulary.
  const vocabSet = new Set<string>();
  channels.forEach((c) => Object.keys(c.categories).forEach((k) => vocabSet.add(k)));
  const vocab = [...vocabSet].sort();
  const idx = new Map(vocab.map((v, i) => [v, i]));

  // dense + L2 정규화.
  const X = channels.map((c) => {
    const v = new Array(vocab.length).fill(0);
    for (const [name, val] of Object.entries(c.categories)) {
      v[idx.get(name)!] = val / 100;
    }
    return l2normalize(v);
  });

  console.log(`[cluster] ${channels.length} 채널 × ${vocab.length} 카테고리 차원`);

  // k 결정.
  const forced = arg("k");
  let labels: number[];
  let k: number;
  if (forced) {
    k = parseInt(forced, 10);
    labels = kmeans(X, k, { seed: 42 }).labels;
    console.log(`[cluster] forced k=${k}`);
  } else {
    const min = parseInt(arg("min", "6")!, 10);
    const max = parseInt(arg("max", String(Math.min(20, Math.floor(channels.length / 8))))!, 10);
    const candidates = [];
    for (let kk = min; kk <= max; kk++) candidates.push(kk);
    const best = pickBestK(X, candidates, { seed: 42 });
    k = best.k;
    labels = best.result.labels;
    console.table(best.sweep);
    console.log(`[cluster] silhouette 최고 k=${k} (score=${best.silhouette.toFixed(3)})`);
  }

  // 클러스터별 메타 산출.
  const members: number[][] = Array.from({ length: k }, () => []);
  labels.forEach((c, i) => members[c].push(i));

  const writes = members.map((memberIdxs, ci) => {
    // centroid: 멤버 category 맵 평균 → top-12 정규화.
    const sum: Record<string, number> = {};
    const kwFreq: Record<string, number> = {};
    memberIdxs.forEach((i) => {
      const ch = channels[i];
      for (const [name, val] of Object.entries(ch.categories)) {
        sum[name] = (sum[name] ?? 0) + val;
      }
      ch.keywords.forEach((kw) => (kwFreq[kw] = (kwFreq[kw] ?? 0) + 1));
    });
    const denom = Math.max(memberIdxs.length, 1);
    const meanScores: Record<string, number> = {};
    for (const [name, total] of Object.entries(sum)) meanScores[name] = total / denom;
    const centroid = normalizeTopN(meanScores, 12);

    const topCategories = Object.entries(centroid)
      .sort((a, b) => b[1] - a[1])
      .map(([name, weight]) => ({ name, weight }));
    const topKeywords = Object.entries(kwFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);
    const label =
      topCategories.slice(0, 2).map((t) => t.name).join(" · ") || `cluster ${ci}`;

    return {
      label,
      centroid,
      topCategories,
      topKeywords,
      size: memberIdxs.length,
      color: PALETTE[ci % PALETTE.length],
      memberIds: memberIdxs.map((i) => channels[i].id),
    };
  });

  await replaceClusters(writes);

  console.log("✅ 클러스터 저장 완료:");
  writes
    .sort((a, b) => b.size - a.size)
    .forEach((w) => console.log(`   [${w.size.toString().padStart(4)}] ${w.label}`));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ cluster failed:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
