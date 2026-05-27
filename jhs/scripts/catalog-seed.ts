// catalog:seed — seed-channels.json + RSS + lexicon → Channel 카탈로그 upsert.
//
//   npm run catalog:seed
//   npm run catalog:seed -- --limit 20  --concurrency 4  --dry
//
// 외부 호출: youtube.com/feeds/videos.xml?channel_id=...  (RSS, key 불필요)
// DB: Channel 테이블 (channel-service.ts 의 upsertChannel 재사용)
//
// 한 채널당 RSS 1번 → 15개 영상 title/description 합쳐 classify → upsert.
// subscriberCount/viewCount 는 RSS 로 못 받으므로 0 으로 둔다 (Phase 4 의
// onboard 입력·사용자 보강에서 채워질 수 있음). uploadsPerMonth 는 RSS
// publishedAt 범위에서 추정.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { fetchChannelFeed, type RssChannel } from "../lib/sources/rss";
import { classify } from "../lib/classify";
import {
  mainstreamScoreOf,
  nicheScoreOf,
  median,
} from "../lib/category-utils";
import { upsertChannel } from "../lib/channel-service";
import type { ChannelFeatures } from "../lib/channel-features";

// .env 수동 로드.
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

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const LIMIT = parseInt(arg("limit", "0")!, 10) || 0;
const CONCURRENCY = parseInt(arg("concurrency", "4")!, 10);
const DRY = flag("dry");

type SeedEntry = {
  id: string;
  title?: string;
  hintCategory?: string;
};

function loadSeed(): SeedEntry[] {
  const filePath = path.resolve("data/seed-channels.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(raw) as Array<Record<string, any>>;
  return arr
    .filter((row) => typeof row.id === "string" && row.id.startsWith("UC"))
    .map((row) => ({
      id: row.id as string,
      title: typeof row.title === "string" ? row.title : undefined,
      hintCategory:
        typeof row.hintCategory === "string" ? row.hintCategory : undefined,
    }));
}

function uploadsPerMonth(feed: RssChannel): number {
  const dates = feed.videos
    .map((v) => Date.parse(v.publishedAt))
    .filter((t) => Number.isFinite(t));
  if (dates.length < 2) return 0;
  const span = Math.max(...dates) - Math.min(...dates);
  const days = span / 86_400_000;
  if (days <= 0) return 0;
  return +((dates.length / days) * 30).toFixed(1);
}

// Atom feed 의 published 는 채널 생성일. 그걸로 평균 영상 간격을 거꾸로
// 잡지는 못해서 RSS 만으로는 mainstreamScore 를 산출하기 어렵다.
// 데모 단계에서는 0 으로 두고, Phase 4 의 cron refresh 가 채널 페이지를
// 스크래핑해 viewCount 를 보강하는 옵션을 둔다 (현재 단계에서는 0).
function featuresFromRss(
  seed: SeedEntry,
  feed: RssChannel,
): ChannelFeatures {
  const combinedText = [
    feed.title,
    ...feed.videos.map((v) => `${v.title} ${v.description}`),
  ].join("\n");

  const { categories, keywords } = classify({
    text: combinedText,
    hintCategory: seed.hintCategory ?? null,
  });

  return {
    id: seed.id,
    title: feed.title || seed.title || "(untitled)",
    handle: null,
    thumbnail: "",
    description: null,
    subscriberCount: 0,
    videoCount: feed.videos.length,
    viewCount: 0,
    country: "KR",
    isKorean: true,
    categories,
    keywords,
    metrics: {
      mainstreamScore: mainstreamScoreOf(0),
      nicheScore: nicheScoreOf(0),
      uploadsPerMonth: uploadsPerMonth(feed),
    },
  };
}

async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}

async function main() {
  const seed = loadSeed();
  const slice = LIMIT > 0 ? seed.slice(0, LIMIT) : seed;
  console.log(
    `🌱 catalog:seed — ${slice.length}/${seed.length} channels, concurrency=${CONCURRENCY}, dry=${DRY}`,
  );

  let ok = 0;
  let fail = 0;

  await runConcurrent(
    slice,
    async (s, idx) => {
      const feed = await fetchChannelFeed(s.id).catch(() => null);
      if (!feed) {
        console.warn(`[${idx + 1}/${slice.length}] ✗ ${s.id} — RSS 404 / parse fail`);
        fail++;
        return;
      }
      const f = featuresFromRss(s, feed);
      if (!DRY) {
        await upsertChannel(f, "seed");
      }
      ok++;
      console.log(
        `[${idx + 1}/${slice.length}] ✓ ${s.id} — ${f.title}` +
          ` cats=${Object.keys(f.categories).slice(0, 3).join(",")}` +
          ` kws=${f.keywords.slice(0, 3).join(",")}` +
          ` uploads/mo=${f.metrics.uploadsPerMonth}`,
      );
    },
    CONCURRENCY,
  );

  console.log(`\n✅ done — ok=${ok}  fail=${fail}  dry=${DRY}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ catalog:seed failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
