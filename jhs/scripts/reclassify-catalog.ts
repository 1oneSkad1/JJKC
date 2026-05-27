// DB 의 모든 채널을 (description + title + keywords) 만으로 classify() 재호출 →
// categories 필드 갱신. lexicon 튜닝 후 일괄 재분류용. RSS 호출 0.
//
//   npx tsx scripts/reclassify-catalog.ts
//   npx tsx scripts/reclassify-catalog.ts --only-empty   # categories 비었거나 wikidata 잔재만
//   npx tsx scripts/reclassify-catalog.ts --dry          # 실제로 update 안 함

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { classify } from "../lib/classify";

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
const flag = (n: string) => process.argv.includes(`--${n}`);
const DRY = flag("dry");
const ONLY_EMPTY = flag("only-empty");

// 우리 표준 15 카테고리 namespace. 이 외 키가 categories 에 있으면 wikidata
// 잔재(예: "Role-playing video game") 로 보고 재분류 대상.
const KNOWN = new Set([
  "Film & Animation",
  "Autos & Vehicles",
  "Music",
  "Pets & Animals",
  "Sports",
  "Travel & Events",
  "Gaming",
  "People & Blogs",
  "Comedy",
  "Entertainment",
  "News & Politics",
  "Howto & Style",
  "Education",
  "Science & Technology",
  "Nonprofits & Activism",
]);

function isWikidataLeak(cats: Record<string, number>): boolean {
  return Object.keys(cats).some((k) => !KNOWN.has(k));
}

async function main() {
  const rows = await prisma.channel.findMany({
    select: {
      id: true,
      title: true,
      description: true,
      keywords: true,
      categories: true,
    },
  });
  console.log(
    `🔁 reclassify-catalog: ${rows.length} channels  dry=${DRY}  only-empty=${ONLY_EMPTY}`,
  );

  let scanned = 0,
    changed = 0,
    unchanged = 0,
    skipped = 0,
    leakFixed = 0,
    emptyFilled = 0;

  for (const r of rows) {
    scanned++;
    let existing: Record<string, number> = {};
    try {
      existing = JSON.parse(r.categories || "{}");
    } catch {}

    if (ONLY_EMPTY) {
      const empty = Object.keys(existing).length === 0;
      const leak = isWikidataLeak(existing);
      if (!empty && !leak) {
        skipped++;
        continue;
      }
    }

    let kw: string[] = [];
    try {
      kw = JSON.parse(r.keywords || "[]");
    } catch {}

    const text = [r.title || "", r.description || "", kw.join(" ")].join("\n");
    const { categories } = classify({ text, hintCategory: null });

    if (Object.keys(categories).length === 0) {
      unchanged++;
      continue;
    }

    // 변경 여부 — JSON 직렬화 비교.
    const before = JSON.stringify(existing);
    const after = JSON.stringify(categories);
    if (before === after) {
      unchanged++;
      continue;
    }

    if (Object.keys(existing).length === 0) emptyFilled++;
    if (isWikidataLeak(existing)) leakFixed++;
    changed++;

    if (!DRY) {
      await prisma.channel.update({
        where: { id: r.id },
        data: { categories: after },
      });
    }

    if (changed <= 8) {
      console.log(
        `  ${r.id}  ${r.title?.slice(0, 30) ?? ""}\n    before: ${before.slice(0, 120)}\n    after:  ${after.slice(0, 120)}`,
      );
    }
  }

  console.log(
    `\n✅ scanned=${scanned}  changed=${changed}  unchanged=${unchanged}  skipped=${skipped}` +
      `\n   (of changed: leak-fixed=${leakFixed}, empty-filled=${emptyFilled})`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ reclassify failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
