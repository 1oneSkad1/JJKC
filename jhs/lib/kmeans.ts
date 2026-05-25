// channel_analyze_plan §4: 순수 TS k-means++ (의존성 0).
// 입력 행은 호출자가 L2 정규화해서 넘긴다 → 유클리드 거리 ≈ 코사인 거리
// (추천의 cosine 척도와 정렬). 1,000행 × 수백 차원은 수십 ms 수준.

// 결정적 RNG (재현성).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

export function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export interface KMeansResult {
  labels: number[];
  centroids: number[][];
  inertia: number;
}

export function kmeans(
  X: number[][],
  k: number,
  opts: { seed?: number; maxIter?: number } = {},
): KMeansResult {
  const n = X.length;
  const dim = X[0]?.length ?? 0;
  const seed = opts.seed ?? 42;
  const maxIter = opts.maxIter ?? 100;
  const rand = mulberry32(seed);
  const kk = Math.min(k, n);

  // ── k-means++ 초기화 ──
  const centroids: number[][] = [];
  centroids.push(X[Math.floor(rand() * n)].slice());
  const d2 = new Array(n).fill(Infinity);
  while (centroids.length < kk) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const nd = dist2(X[i], centroids[centroids.length - 1]);
      if (nd < d2[i]) d2[i] = nd;
      sum += d2[i];
    }
    let r = rand() * sum;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(X[chosen].slice());
  }

  const labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // assign
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dd = dist2(X[i], centroids[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    // update
    const sums = centroids.map(() => new Array(dim).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c]++;
      const row = X[i];
      const acc = sums[c];
      for (let j = 0; j < dim; j++) acc[j] += row[j];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) {
        // 빈 클러스터 → 가장 먼 점으로 재시드.
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const dd = dist2(X[i], centroids[labels[i]]);
          if (dd > farD) {
            farD = dd;
            far = i;
          }
        }
        centroids[c] = X[far].slice();
      } else {
        centroids[c] = sums[c].map((v) => v / counts[c]);
      }
    }
    if (!changed && iter > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(X[i], centroids[labels[i]]);

  return { labels, centroids, inertia };
}

// 실루엣 점수 (평균). O(n²·dim) 이라 n≈1,000 까진 충분.
export function silhouette(X: number[][], labels: number[], k: number): number {
  const n = X.length;
  if (k <= 1 || n <= k) return 0;
  const byCluster: number[][] = Array.from({ length: k }, () => []);
  labels.forEach((c, i) => byCluster[c].push(i));

  let total = 0;
  for (let i = 0; i < n; i++) {
    const ci = labels[i];
    const own = byCluster[ci];
    if (own.length <= 1) continue;
    let a = 0;
    for (const j of own) if (j !== i) a += Math.sqrt(dist2(X[i], X[j]));
    a /= own.length - 1;

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ci || byCluster[c].length === 0) continue;
      let mean = 0;
      for (const j of byCluster[c]) mean += Math.sqrt(dist2(X[i], X[j]));
      mean /= byCluster[c].length;
      if (mean < b) b = mean;
    }
    const s = b === Infinity ? 0 : (b - a) / Math.max(a, b);
    total += s;
  }
  return total / n;
}

// k 후보를 스윕해 실루엣 최고 k 선택.
export function pickBestK(
  X: number[][],
  candidates: number[],
  opts: { seed?: number } = {},
): { k: number; result: KMeansResult; silhouette: number; sweep: { k: number; silhouette: number; inertia: number }[] } {
  let best: { k: number; result: KMeansResult; silhouette: number } | null = null;
  const sweep: { k: number; silhouette: number; inertia: number }[] = [];
  for (const k of candidates) {
    if (k >= X.length) continue;
    const result = kmeans(X, k, opts);
    const sil = silhouette(X, result.labels, k);
    sweep.push({ k, silhouette: +sil.toFixed(4), inertia: +result.inertia.toFixed(2) });
    if (!best || sil > best.silhouette) best = { k, result, silhouette: sil };
  }
  if (!best) {
    const result = kmeans(X, Math.min(2, X.length), opts);
    return { k: 2, result, silhouette: 0, sweep };
  }
  return { ...best, sweep };
}
