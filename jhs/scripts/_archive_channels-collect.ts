// channel_analyze_plan §2: 한국 채널(구독자 ≥ 10만) 수집.
//
//   npm run channels:collect -- [--target 1000] [--budget 9000]
//                                [--no-search] [--no-uploads] [--mock 300]
//
// 인증 우선순위:
//   1) YOUTUBE_API_KEY (공개 데이터 읽기 — 권장, 사용자 컨텍스트 불필요)
//   2) DB 의 가장 최근 Google OAuth 토큰 (자동 refresh)
//   3) --mock N : API 없이 합성 채널 N개 생성 (파이프라인 검증용)
//
// 재개 가능: CollectionRun 에 frontier/visited/quotaSpent 를 저장 → budget 도달 시
// pause, 다음 실행이 이어받는다.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import {
  getYouTubeClient,
  getYouTubeClientByKey,
  type YouTubeClient,
  searchChannelIds,
  mostPopularChannelIds,
  getFeaturedChannelIds,
  listChannelsByIds,
  listUploadIds,
  listVideosByIdsClient,
  videoCategoryMap,
} from "../lib/youtube";
import {
  extractChannelFeatures,
  type ChannelFeatures,
} from "../lib/channel-features";

// ── .env 수동 로드 (dotenv 의존 없이) ─────────────────────────
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

// ── args ──
function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const TARGET = parseInt(arg("target", "1000")!, 10);
const BUDGET = parseInt(arg("budget", "9000")!, 10);
const MOCK_N = flag("mock") ? parseInt(arg("mock", "300")!, 10) : 0;
const USE_SEARCH = !flag("no-search");
const ENRICH_UPLOADS = !flag("no-uploads");
const MIN_SUBS = 100_000;
const REGION = "KR";

// 트렌딩 seed 에 쓰는 KR videoCategoryId (흔히 등장하는 것).
const SEED_CATEGORY_IDS = ["10", "20", "22", "23", "24", "25", "26", "28"];
// search type=channel seed 토픽.
const SEED_TOPICS = [
  "예능", "게임", "먹방", "브이로그", "뷰티", "IT", "음악", "키즈",
  "스포츠", "교육", "주식", "여행", "요리", "리뷰", "영화", "코미디",
];

let quotaSpent = 0;
function spend(u: number) {
  quotaSpent += u;
}
function budgetLeft() {
  return BUDGET - quotaSpent;
}

// ── 합성(mock) 데이터 ─────────────────────────────────────────
function genMock(n: number): ChannelFeatures[] {
  const archetypes: { cats: Record<string, number>; kws: string[]; tag: string }[] = [
    { cats: { Gaming: 70, Entertainment: 30 }, kws: ["롤", "fps", "공략", "스트리머"], tag: "game" },
    { cats: { Music: 80, Entertainment: 20 }, kws: ["커버", "라이브", "발라드", "kpop"], tag: "music" },
    { cats: { "Food": 60, "Howto & Style": 40 }, kws: ["먹방", "레시피", "맛집", "요리"], tag: "food" },
    { cats: { "Science & Technology": 75, Education: 25 }, kws: ["it", "리뷰", "코딩", "ai"], tag: "tech" },
    { cats: { Entertainment: 55, "People & Blogs": 45 }, kws: ["브이로그", "일상", "예능", "토크"], tag: "vlog" },
    { cats: { "Howto & Style": 70, Entertainment: 30 }, kws: ["메이크업", "뷰티", "패션", "하울"], tag: "beauty" },
    { cats: { Sports: 80, News: 20 }, kws: ["축구", "야구", "하이라이트", "분석"], tag: "sport" },
    { cats: { Education: 65, "Science & Technology": 35 }, kws: ["강의", "공부", "수능", "영어"], tag: "edu" },
  ];
  const out: ChannelFeatures[] = [];
  // 결정적 의사난수.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const a = archetypes[Math.floor(rnd() * archetypes.length)];
    // 카테고리에 약간의 잡음.
    const cats: Record<string, number> = {};
    const entries = Object.entries(a.cats);
    let tot = 0;
    const noisy = entries.map(([k, v]) => {
      const nv = Math.max(1, Math.round(v + (rnd() - 0.5) * 20));
      tot += nv;
      return [k, nv] as const;
    });
    noisy.forEach(([k, v]) => (cats[k] = Math.round((v / tot) * 100)));
    const subs = Math.round(100_000 + rnd() * 9_900_000);
    out.push({
      id: `MOCK_${a.tag}_${i}`,
      title: `${a.tag} 채널 ${i}`,
      handle: `@mock_${a.tag}_${i}`,
      thumbnail: "",
      description: `${a.kws.join(" ")} 한국 채널`,
      subscriberCount: subs,
      videoCount: Math.round(50 + rnd() * 2000),
      viewCount: subs * Math.round(50 + rnd() * 300),
      country: "KR",
      isKorean: true,
      categories: cats,
      keywords: a.kws,
      metrics: {
        mainstreamScore: Math.round(rnd() * 100),
        nicheScore: Math.round(rnd() * 100),
        uploadsPerMonth: +(rnd() * 30).toFixed(1),
      },
    });
  }
  return out;
}

// ── 인증 client 확보 ──────────────────────────────────────────
async function resolveClient(): Promise<YouTubeClient> {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    console.log("[auth] using YOUTUBE_API_KEY");
    return getYouTubeClientByKey(key);
  }
  console.log("[auth] no API key — falling back to DB OAuth token");
  const account = await prisma.account.findFirst({
    where: { provider: "google" },
    orderBy: { expires_at: "desc" },
  });
  if (!account?.access_token) {
    throw new Error(
      "수집할 인증 수단이 없습니다. .env 에 YOUTUBE_API_KEY 를 넣거나, 앱에서 Google 로그인 후 다시 실행하거나, --mock 으로 합성 데이터를 쓰세요.",
    );
  }
  // 만료 임박이면 refresh.
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });
  const expMs = (account.expires_at ?? 0) * 1000;
  if ((!expMs || expMs < Date.now() + 60_000) && account.refresh_token) {
    const { credentials } = await auth.refreshAccessToken();
    await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: account.providerAccountId,
        },
      },
      data: {
        access_token: credentials.access_token ?? account.access_token,
        expires_at: credentials.expiry_date
          ? Math.floor(credentials.expiry_date / 1000)
          : account.expires_at,
      },
    });
    return getYouTubeClient(credentials.access_token ?? account.access_token!);
  }
  return getYouTubeClient(account.access_token);
}

async function main() {
  console.log("🚀 channels:collect", { TARGET, BUDGET, MOCK_N, USE_SEARCH, ENRICH_UPLOADS });

  // ── mock 경로 ──
  if (MOCK_N > 0) {
    const { upsertChannel, countChannels } = await import("../lib/channel-service");
    const mocks = genMock(MOCK_N);
    for (const f of mocks) await upsertChannel(f, "mock");
    console.log(`✅ mock: ${mocks.length} 채널 upsert. 카탈로그 총 ${await countChannels()}개.`);
    await prisma.$disconnect();
    return;
  }

  const { upsertChannel, countChannels } = await import("../lib/channel-service");
  const yt = await resolveClient();
  const catMap = await videoCategoryMap(yt, REGION);
  spend(1);

  // ── CollectionRun 재개/생성 ──
  let run = await prisma.collectionRun.findFirst({
    where: { status: { in: ["running", "paused"] } },
    orderBy: { updatedAt: "desc" },
  });
  const visited = new Set<string>(run ? JSON.parse(run.visited) : []);
  const frontier: string[] = run ? JSON.parse(run.frontier) : [];
  let accepted = run?.acceptedN ?? (await countChannels());

  if (!run) {
    run = await prisma.collectionRun.create({ data: { status: "running" } });
  }

  // ── seed (frontier 가 적을 때만) ──
  if (frontier.length < 50) {
    console.log("[seed] gathering seed channel ids...");
    for (const catId of SEED_CATEGORY_IDS) {
      if (budgetLeft() < 200) break;
      try {
        const { channelIds } = await mostPopularChannelIds(yt, { categoryId: catId, regionCode: REGION });
        spend(1);
        channelIds.forEach((id) => {
          if (!visited.has(id)) frontier.push(id);
        });
      } catch (e: any) {
        console.warn("[seed] mostPopular fail", catId, e.message);
      }
    }
    if (USE_SEARCH) {
      for (const topic of SEED_TOPICS) {
        if (budgetLeft() < 600) break;
        try {
          const { channelIds } = await searchChannelIds(yt, topic, { regionCode: REGION });
          spend(100);
          channelIds.forEach((id) => {
            if (!visited.has(id)) frontier.push(id);
          });
        } catch (e: any) {
          console.warn("[seed] search fail", topic, e.message);
        }
      }
    }
    console.log(`[seed] frontier=${frontier.length}, quotaSpent=${quotaSpent}`);
  }

  // ── BFS: 50개씩 enrich → filter → upsert → snowball ──
  while (accepted < TARGET && frontier.length > 0 && budgetLeft() > 5) {
    const batchIds: string[] = [];
    while (batchIds.length < 50 && frontier.length > 0) {
      const id = frontier.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      batchIds.push(id);
    }
    if (batchIds.length === 0) break;

    let items: any[] = [];
    try {
      items = await listChannelsByIds(yt, batchIds);
      spend(1);
    } catch (e: any) {
      console.warn("[enrich] channels.list fail", e.message);
      if (e?.code === 401 || e?.response?.status === 401) break;
      continue;
    }

    for (const c of items) {
      if (budgetLeft() <= 5) break;
      let uploads: any[] = [];
      if (ENRICH_UPLOADS) {
        const uploadsPl = c.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPl) {
          try {
            const ids = await listUploadIds(yt, uploadsPl, 10);
            spend(1);
            if (ids.length) {
              uploads = await listVideosByIdsClient(yt, ids);
              spend(1);
            }
          } catch (e: any) {
            console.warn("[enrich] uploads fail", c.id, e.message);
          }
        }
      }
      const f = extractChannelFeatures({ channel: c, uploads, categoryNameById: catMap });
      if (f.subscriberCount < MIN_SUBS || !f.isKorean) continue;

      await upsertChannel(f, USE_SEARCH ? "search" : "trending");
      accepted++;

      // snowball: 수락된 채널의 추천 채널.
      if (budgetLeft() > 5) {
        try {
          const featured = await getFeaturedChannelIds(yt, c.id);
          spend(1);
          featured.forEach((id) => {
            if (!visited.has(id)) frontier.push(id);
          });
        } catch {
          /* channelSections 없을 수 있음 — 무시 */
        }
      }
      if (accepted >= TARGET) break;
    }

    // 진행상황 저장 (재개 대비).
    await prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        acceptedN: accepted,
        frontier: JSON.stringify(frontier.slice(0, 5000)),
        visited: JSON.stringify([...visited].slice(-20000)),
        quotaSpent: (run.quotaSpent ?? 0) + quotaSpent,
        status: "running",
      },
    });
    console.log(`[bfs] accepted=${accepted}/${TARGET} frontier=${frontier.length} quotaSpent=${quotaSpent}`);
  }

  const done = accepted >= TARGET || frontier.length === 0;
  await prisma.collectionRun.update({
    where: { id: run.id },
    data: {
      status: done ? "done" : "paused",
      acceptedN: accepted,
      frontier: JSON.stringify(frontier.slice(0, 5000)),
      visited: JSON.stringify([...visited].slice(-20000)),
      quotaSpent: (run.quotaSpent ?? 0) + quotaSpent,
      note: done ? "complete" : "budget/quota paused — re-run to resume",
    },
  });

  console.log(
    `${done ? "✅ done" : "⏸  paused"} — 카탈로그 ${await countChannels()}개, 이번 실행 quota≈${quotaSpent}u`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ collect failed:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
