// dump.sql (외부에서 우리 channels-collect 로 만든 SQL 덤프) → dev.db.
//
//   npx tsx scripts/import-external-dump.ts /path/to/dump.sql
//
// 핵심:
//   - dump 의 id/title/handle/thumbnail/description/subscriberCount/viewCount/
//     videoCount/keywords/metrics 는 그대로 가져옴 (RSS 로 못 얻는 값)
//   - categories 는 description + title + keywords 를 우리 classify() 로 다시 돌려
//     우리 표준 namespace 로 통일 (dump 의 Wikidata 카테고리는 버림)
//   - 이미 같은 id 가 DB 에 있으면 메타데이터만 보강 (subscriberCount 등 0 인 값을
//     dump 값으로 덮어쓰기). 사람이 입력한 정확한 분류가 있는 경우는 보존.
//   - source = 'external-dump' 로 마킹

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { classify } from "../lib/classify";
import { mainstreamScoreOf, nicheScoreOf } from "../lib/category-utils";

const envPath = path.resolve(".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const prisma = new PrismaClient();

type DumpRow = {
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
  categories: string; // JSON (Wikidata namespace, 버릴 것)
  keywords: string; // JSON: string[]
  metrics: string | null; // JSON: { mainstreamScore, nicheScore, uploadsPerMonth }
};

// VALUES 의 인자들을 SQL 표준대로 파싱 (문자열 escape '' 처리).
function parseValues(s: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(s[i])) i++;
    if (i >= n) break;
    if (s[i] === "'") {
      let j = i + 1;
      const buf: string[] = [];
      while (j < n) {
        if (s[j] === "'" && s[j + 1] === "'") {
          buf.push("'");
          j += 2;
        } else if (s[j] === "'") {
          j++;
          break;
        } else {
          buf.push(s[j]);
          j++;
        }
      }
      out.push(buf.join(""));
      i = j;
    } else {
      let j = i;
      while (j < n && s[j] !== "," && s[j] !== "\n") j++;
      const tok = s.slice(i, j).trim();
      if (tok === "NULL") out.push(null);
      else if (tok === "true") out.push(true);
      else if (tok === "false") out.push(false);
      else if (tok === "CURRENT_TIMESTAMP") out.push(null);
      else if (/^-?\d+$/.test(tok)) out.push(parseInt(tok, 10));
      else if (/^-?\d+\.\d+$/.test(tok)) out.push(parseFloat(tok));
      else out.push(tok);
      i = j;
    }
  }
  return out;
}

const COLS = [
  "id",
  "title",
  "handle",
  "thumbnail",
  "description",
  "subscriberCount",
  "videoCount",
  "viewCount",
  "country",
  "isKorean",
  "categories",
  "keywords",
  "metrics",
  "clusterId",
  "source",
  "refreshedAt",
];

function parseDump(filePath: string): DumpRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  const rows: DumpRow[] = [];
  // /s 플래그로 줄바꿈 포함 매칭. ON CONFLICT 까지가 한 INSERT.
  const re =
    /INSERT INTO "Channel"[^V]*VALUES \(([\s\S]*?)\)\s*ON CONFLICT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const vals = parseValues(m[1]);
    if (vals.length < COLS.length) continue;
    const row: any = {};
    for (let i = 0; i < COLS.length; i++) row[COLS[i]] = vals[i];
    if (typeof row.id !== "string" || !row.id.startsWith("UC")) continue;
    rows.push(row as DumpRow);
  }
  return rows;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/import-external-dump.ts <dump.sql>");
    process.exit(1);
  }
  const rows = parseDump(file);
  console.log(`📥 parsed ${rows.length} Channel rows from ${file}`);

  let added = 0,
    updated = 0,
    skipped = 0;

  for (const r of rows) {
    // 1) 우리 classify() 로 카테고리 재계산.
    let kwArr: string[] = [];
    try {
      kwArr = JSON.parse(r.keywords || "[]");
    } catch {
      kwArr = [];
    }
    const text = [r.title || "", r.description || "", kwArr.join(" ")].join(
      "\n",
    );
    const { categories, keywords } = classify({
      text,
      hintCategory: null, // dump 는 hint 없음
    });

    // 2) metrics: dump 가 있으면 그대로, 없으면 우리 식으로 계산
    let metrics: { mainstreamScore: number; nicheScore: number; uploadsPerMonth: number };
    if (r.metrics) {
      try {
        metrics = JSON.parse(r.metrics);
      } catch {
        metrics = {
          mainstreamScore: 0,
          nicheScore: nicheScoreOf(r.subscriberCount),
          uploadsPerMonth: 0,
        };
      }
    } else {
      metrics = {
        mainstreamScore: mainstreamScoreOf(
          r.videoCount > 0 ? Math.round(r.viewCount / r.videoCount) : 0,
        ),
        nicheScore: nicheScoreOf(r.subscriberCount),
        uploadsPerMonth: 0,
      };
    }

    // 3) 기존 row 가 있는지 확인.
    const existing = await prisma.channel.findUnique({ where: { id: r.id } });

    const baseData = {
      title: r.title || "(untitled)",
      handle: r.handle,
      thumbnail: r.thumbnail || "",
      description: r.description,
      subscriberCount: r.subscriberCount || 0,
      videoCount: r.videoCount || 0,
      viewCount: BigInt(Math.max(0, Math.round(r.viewCount || 0))),
      country: r.country,
      isKorean: r.isKorean !== false,
      categories: JSON.stringify(categories),
      keywords: JSON.stringify(keywords.length ? keywords : kwArr.slice(0, 12)),
      metrics: JSON.stringify(metrics),
    };

    if (!existing) {
      await prisma.channel.create({
        data: { id: r.id, ...baseData, source: "external-dump" },
      });
      added++;
    } else {
      // 보강 정책:
      // - subscriberCount/viewCount/videoCount: dump 값이 더 크면 채택 (더 최신/정확)
      // - description/handle/thumbnail: 기존 빈값이면 dump 값 사용
      // - categories: 우리 classify() 가 더 풍부하면 (Object.keys.length 더 많음) 갱신
      // - source: 'external-dump' 로 갱신해 출처 표시
      const update: any = { source: "external-dump" };
      if ((existing.subscriberCount || 0) < r.subscriberCount)
        update.subscriberCount = r.subscriberCount;
      if (Number(existing.viewCount) < r.viewCount)
        update.viewCount = BigInt(Math.max(0, Math.round(r.viewCount)));
      if ((existing.videoCount || 0) < r.videoCount)
        update.videoCount = r.videoCount;
      if (!existing.description && r.description)
        update.description = r.description;
      if (!existing.handle && r.handle) update.handle = r.handle;
      if (!existing.thumbnail && r.thumbnail) update.thumbnail = r.thumbnail;

      // categories: 우리 classify 가 항목 더 많으면 갱신 (드물게 dump 응답이
      // description 부실한 경우엔 우리 결과가 빈약할 수 있어 안전장치).
      let existingCatCount = 0;
      try {
        existingCatCount = Object.keys(JSON.parse(existing.categories)).length;
      } catch {}
      if (Object.keys(categories).length > existingCatCount) {
        update.categories = JSON.stringify(categories);
      }

      // keywords 도 마찬가지: dump 의 더 풍부한 키워드 우선.
      if (keywords.length > 0 || kwArr.length > 0) {
        update.keywords = JSON.stringify(
          keywords.length ? keywords : kwArr.slice(0, 12),
        );
      }
      update.metrics = JSON.stringify(metrics);

      if (Object.keys(update).length > 1) {
        await prisma.channel.update({ where: { id: r.id }, data: update });
        updated++;
      } else {
        skipped++;
      }
    }
  }

  console.log(
    `\n✅ done — added=${added}  updated=${updated}  skipped=${skipped}  total=${rows.length}`,
  );

  // 최종 DB 상태 요약.
  const counts = await prisma.$queryRaw<{ source: string; n: number }[]>`
    SELECT source, COUNT(*) AS n FROM "Channel" GROUP BY source ORDER BY n DESC
  `;
  console.log(`\nDB source breakdown:`);
  for (const c of counts) console.log(`  ${c.source}: ${c.n}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ import failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
