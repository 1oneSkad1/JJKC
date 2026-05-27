// 이름 리스트 → channelId 일괄 해결.
//
//   echo "쏴비TV\n혜안" | npx tsx scripts/resolve-channel-ids.ts Gaming > out.json
//
// 동작:
//   - 각 줄을 query 로 받아 youtube.com 검색 (sp=EgIQAg= 채널 필터) 호출
//   - 응답 HTML 에서 ytInitialData 추출 → 첫 channelRenderer 의 (id, title)
//   - 입력 query 와 응답 title 의 유사도 검사 (포함관계 ≥1 토큰 이상)
//   - 일치하면 { id, title, hintCategory, _searchedAs } 수집
//   - 불일치/no-result 는 stderr 로 경고
//
// 외부 호출: youtube.com 공개 검색 페이지. key 없음. rate-limit 회피 위해
// concurrency 2 + jitter sleep.

import readline from "node:readline";

const HINT = process.argv[2] || "Gaming";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// YouTube 의 anti-scrape 회피용. 동시요청 1, 요청 간 2.5~4s. ~100건에 5~7분.
const CONCURRENCY = 1;
const BASE_DELAY_MS = 2500;
const JITTER_MS = 1500;

type Hit = { channelId: string; title: string };

function findChannelRenderer(node: any, out: Hit[]) {
  if (Array.isArray(node)) {
    for (const v of node) findChannelRenderer(v, out);
  } else if (node && typeof node === "object") {
    if (node.channelRenderer) {
      const cr = node.channelRenderer;
      const title =
        cr.title?.simpleText ??
        cr.title?.runs?.[0]?.text ??
        "";
      if (cr.channelId) out.push({ channelId: cr.channelId, title });
    }
    for (const v of Object.values(node)) findChannelRenderer(v, out);
  }
}

async function resolveOne(query: string): Promise<Hit | null> {
  const url =
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(query) +
    "&sp=EgIQAg%253D%253D";
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      // EU consent dialog 우회 — 없으면 ytInitialData 가 비어 옴.
      cookie: "CONSENT=YES+1; SOCS=CAI",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/var ytInitialData = ({.*?});<\/script>/);
  if (!m) return null;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const hits: Hit[] = [];
  findChannelRenderer(data, hits);
  return hits[0] ?? null;
}

function looseMatch(query: string, title: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = title.toLowerCase().replace(/\s+/g, "");
  if (!q || !t) return false;
  // 부분 포함 양방향 + 첫 5자 prefix 일치
  if (t.includes(q) || q.includes(t)) return true;
  const head = q.slice(0, Math.min(5, q.length));
  if (head.length >= 3 && t.includes(head)) return true;
  return false;
}

async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i]);
      await new Promise((r) =>
        setTimeout(r, BASE_DELAY_MS + Math.random() * JITTER_MS),
      );
    }
  });
  await Promise.all(lanes);
  return out;
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const names: string[] = [];
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    names.push(line);
  }
  process.stderr.write(`📥 ${names.length} names, hint=${HINT}\n`);

  let ok = 0,
    miss = 0,
    skipped = 0;
  const out: Array<Record<string, unknown>> = [];

  // incremental save: 진행상황을 stderr 에 매 행 찍어 retry 시 잃지 않게.
  await runConcurrent(
    names,
    async (name) => {
      let hit = await resolveOne(name).catch(() => null);
      // 빈 응답이면 한 번만 더 시도 (rate-limit 일시적).
      if (!hit) {
        await new Promise((r) => setTimeout(r, 5000));
        hit = await resolveOne(name).catch(() => null);
      }
      if (!hit) {
        miss++;
        process.stderr.write(`  ✗ no result: ${name}\n`);
        return;
      }
      if (!looseMatch(name, hit.title)) {
        skipped++;
        process.stderr.write(
          `  ? low-conf: '${name}' → '${hit.title}' (${hit.channelId}) — skipped\n`,
        );
        return;
      }
      ok++;
      const entry = {
        id: hit.channelId,
        title: hit.title,
        hintCategory: HINT,
        _searchedAs: name,
      };
      out.push(entry);
      process.stderr.write(
        `  ✓ ${name} → ${hit.title} (${hit.channelId})\n`,
      );
    },
    CONCURRENCY,
  );

  process.stderr.write(
    `\n✅ ok=${ok} miss=${miss} low-conf-skipped=${skipped}\n`,
  );
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
