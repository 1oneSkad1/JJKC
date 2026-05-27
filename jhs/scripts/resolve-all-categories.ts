// top100.txt 의 14 카테고리 × 100 이름을 channelId 로 해결하는 오케스트레이터.
//
//   npx tsx scripts/resolve-all-categories.ts /path/to/top100.txt
//
// 동작:
//   - top100.txt 를 카테고리별로 파싱
//   - 카테고리별로 순차 처리, 결과는 /tmp/resolved-by-cat/<slug>.json 에 저장
//   - 이미 결과 파일이 있으면 skip (재실행으로 재개 가능)
//   - YouTube 차단 회피: 5~9s 간격, 매 20건마다 75s burst pause
//   - 진행상황을 stderr 로 줄단위 출력 (background 에서도 추적)

import fs from "node:fs";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OUT_DIR = "/tmp/resolved-by-cat";
const BASE_DELAY_MS = 5000;
const JITTER_MS = 4000;
const BURST_EVERY = 20;
const BURST_PAUSE_MS = 75_000;

// 파일의 카테고리 헤더 → lexicon 표준 이름.
const CATEGORY_MAP: Record<string, string> = {
  "Entertainment": "Entertainment",
  "People & Blogs": "People & Blogs",
  "Pets & Animals": "Pets & Animals",
  "Film": "Film & Animation",
  "Music": "Music",
  "Sports": "Sports",
  "Science & Technology": "Science & Technology",
  "How To & Style": "Howto & Style",
  "News & Politics": "News & Politics",
  "Education": "Education",
  "Comedy": "Comedy",
  "Nonprofit & Activism": "Nonprofits & Activism",
  "Auto & Vehicles": "Autos & Vehicles",
  "Travel": "Travel & Events",
};

type Hit = { channelId: string; title: string };

function findChannelRenderer(node: any, out: Hit[]) {
  if (Array.isArray(node)) {
    for (const v of node) findChannelRenderer(v, out);
  } else if (node && typeof node === "object") {
    if (node.channelRenderer) {
      const cr = node.channelRenderer;
      const title =
        cr.title?.simpleText ?? cr.title?.runs?.[0]?.text ?? "";
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
      cookie: "CONSENT=YES+1; SOCS=CAI",
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;
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
  if (t.includes(q) || q.includes(t)) return true;
  const head = q.slice(0, Math.min(5, q.length));
  if (head.length >= 3 && t.includes(head)) return true;
  return false;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const RANK_RE = /^\d+(st|nd|rd|th)$/;

type ParsedCategory = { category: string; names: string[] };

function parseFile(filePath: string): ParsedCategory[] {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const out: ParsedCategory[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(
      /^Top \d+ (.+?) YouTube Creators in South Korea by Subscribers$/,
    );
    if (!m) {
      i++;
      continue;
    }
    const rawCat = m[1].trim();
    const category = CATEGORY_MAP[rawCat] ?? rawCat;
    i++;
    // 헤더 다음에 빈 줄, "#  Name  subscribers ..." 같은 메타가 올 수 있음. 스킵.
    while (
      i < lines.length &&
      !RANK_RE.test(lines[i].trim()) &&
      !lines[i].match(/^Top \d+/)
    ) {
      i++;
    }
    const names: string[] = [];
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }
      if (line.match(/^Top \d+/)) break;
      if (RANK_RE.test(line)) {
        const nameLine = lines[i + 1]?.trim() ?? "";
        if (nameLine && !RANK_RE.test(nameLine)) {
          names.push(nameLine);
        }
        // 이름 1줄 + 통계 3줄 = 4줄 건너뛰기
        i += 5;
        continue;
      }
      i++;
    }
    out.push({ category, names });
  }
  return out;
}

async function processCategory(category: string, names: string[]) {
  const file = path.join(OUT_DIR, `${slug(category)}.json`);
  if (fs.existsSync(file)) {
    process.stderr.write(`⏭  ${category} — already done (${file})\n`);
    return;
  }
  process.stderr.write(`\n📂 ${category} — ${names.length} names\n`);

  const out: Array<Record<string, unknown>> = [];
  let ok = 0,
    miss = 0,
    skipped = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let hit = await resolveOne(name).catch(() => null);
    if (!hit) {
      await new Promise((r) => setTimeout(r, 8000));
      hit = await resolveOne(name).catch(() => null);
    }
    if (!hit) {
      miss++;
      process.stderr.write(`  ✗ no result: ${name}\n`);
    } else if (!looseMatch(name, hit.title)) {
      skipped++;
      process.stderr.write(
        `  ? low-conf: '${name}' → '${hit.title}' (${hit.channelId})\n`,
      );
    } else {
      ok++;
      out.push({
        id: hit.channelId,
        title: hit.title,
        hintCategory: category,
        _searchedAs: name,
      });
      process.stderr.write(
        `  ✓ [${i + 1}/${names.length}] ${name} → ${hit.title} (${hit.channelId})\n`,
      );
    }

    // 매 BURST_EVERY 마다 긴 휴식, 그 외엔 base + jitter.
    if (i < names.length - 1) {
      if ((i + 1) % BURST_EVERY === 0) {
        process.stderr.write(
          `  ⏸  burst pause ${BURST_PAUSE_MS / 1000}s after ${i + 1} requests\n`,
        );
        await new Promise((r) => setTimeout(r, BURST_PAUSE_MS));
      } else {
        await new Promise((r) =>
          setTimeout(r, BASE_DELAY_MS + Math.random() * JITTER_MS),
        );
      }
    }

    // 매 행마다 incremental save (중단되더라도 진행 보존).
    fs.writeFileSync(file + ".partial", JSON.stringify(out, null, 2));
  }

  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  try {
    fs.unlinkSync(file + ".partial");
  } catch {}
  process.stderr.write(
    `📂 ${category}: ok=${ok} miss=${miss} low-conf=${skipped} → ${file}\n`,
  );
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "usage: tsx scripts/resolve-all-categories.ts <path-to-top100.txt>",
    );
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cats = parseFile(file);
  process.stderr.write(
    `🗂  parsed ${cats.length} categories, ${cats.reduce((a, c) => a + c.names.length, 0)} total names\n`,
  );
  for (const c of cats) {
    await processCategory(c.category, c.names);
  }
  process.stderr.write(`\n✅ all done\n`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
