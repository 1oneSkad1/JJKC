// channel_analyze_plan §3: profiler 와 channel-features 가 공유하는 순수 헬퍼.
// 외부 IO 없음 — 사용자 프로필과 채널 벡터가 같은 카테고리 namespace 를 쓰도록
// 정규화/파싱 로직을 한 곳에 모은다.

// Wikidata topicCategories URL → 사람이 읽는 카테고리 이름.
//   https://en.wikipedia.org/wiki/Hip_hop_music → "Hip hop music"
export function topicNameFromUrl(url: string): string | null {
  const tail = url.split("/").pop();
  return tail ? tail.replace(/_/g, " ") : null;
}

// ISO 8601 duration (PT#H#M#S) → seconds.
export function parseIsoDuration(iso?: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}

export function bump(map: Record<string, number>, key: string, by: number) {
  map[key] = (map[key] ?? 0) + by;
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// 카테고리 엔트로피 (Shannon) → 0-100 normalize.
export function entropyScore(scores: Record<string, number>): {
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

// 누적 점수 맵 → 상위 N 개만 남기고 합으로 다시 나눠 0-100 백분율.
// profiler 의 categories 정규화와 동일 규약 (둘이 같은 공간을 공유하도록).
export function normalizeTopN(
  scores: Record<string, number>,
  n = 10,
): Record<string, number> {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  const top = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  const topTotal = top.reduce((a, [, v]) => a + v, 0) || 1;
  const out: Record<string, number> = {};
  top.forEach(([name, score]) => {
    out[name] = Math.round((score / topTotal) * 100);
  });
  return out;
}

// mainstream/niche 점수 — profiler 와 channel-features 가 동일 공식을 쓰도록 공유.
// 1k views ≈ 0, 100M ≈ 100. log10 scale.
export function mainstreamScoreOf(medianViews: number): number {
  return medianViews > 0
    ? Math.max(0, Math.min(100, Math.round(((Math.log10(medianViews) - 3) / 5) * 100)))
    : 0;
}

// 1k subs ≈ 100 (niche), 10M ≈ 0 (mega).
export function nicheScoreOf(subscriberCount: number): number {
  return subscriberCount > 0
    ? Math.max(0, Math.min(100, Math.round(100 - ((Math.log10(subscriberCount) - 3) / 4) * 100)))
    : 0;
}
