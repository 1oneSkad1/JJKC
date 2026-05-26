// Headless sync runner. Replays sync-service for a given userId using the
// access token stored in DB. Useful when the dev server's previous sync
// dropped fields due to a stale Prisma client.
//
//   node scripts/run-sync.mjs <userId>

import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

const userId = process.argv[2] || "cmp694kr10000h1887ibzjjmk";
const prisma = new PrismaClient();

// ── profiler.ts port (kept in sync with lib/profiler.ts) ──────────────
const SUB_WEIGHT = 2;
const LIKE_WEIGHT = 5;
const LIKE_TOPIC_WEIGHT = 3;
const PLAYLIST_WEIGHT = 4;
const ACTIVITY_LIKE_WEIGHT = 1.5;
const MAX_CHANNELS = 10;
const MAX_KEYWORDS = 12;
const MAX_SAMPLES = 20;

const recencyMultiplier = (iso, now) => {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  return Math.max(0.4, 1 / (1 + ageDays / 730));
};
const recencyBoost = (iso, now) => {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  if (ageDays < 30) return 1.5;
  if (ageDays < 90) return 1.25;
  if (ageDays < 365) return 1.0;
  return 0.8;
};
const parseIsoDuration = (iso) => {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (parseInt(m[1] ?? "0", 10)) * 3600 +
    (parseInt(m[2] ?? "0", 10)) * 60 +
    (parseInt(m[3] ?? "0", 10));
};
const topicNameFromUrl = (url) => {
  const tail = url.split("/").pop();
  return tail ? tail.replace(/_/g, " ") : null;
};
const bump = (map, key, by) => {
  map[key] = (map[key] ?? 0) + by;
};
const median = (arr) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};
const entropyScore = (scores) => {
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
};

function generateProfile({
  subscriptions, likedVideos, channelDetails, categoryNameById,
  playlistVideos = [], activities = [], now = Date.now(),
}) {
  const categoryScore = {};
  const keywordScore = {};
  const langScore = {};
  const channels = [];
  const sampleVideoIds = [];

  const subRecencyByChannelId = new Map();
  subscriptions.forEach((s) => {
    const cid = s.snippet?.resourceId?.channelId;
    if (typeof cid === "string") {
      subRecencyByChannelId.set(cid, recencyMultiplier(s.snippet?.publishedAt, now));
    }
  });
  const subscriberCounts = [];

  channelDetails.forEach((c) => {
    const cid = typeof c.id === "string" ? c.id : undefined;
    const mult = cid ? subRecencyByChannelId.get(cid) ?? 1 : 1;
    const topics = c.topicDetails?.topicCategories ?? [];
    topics.forEach((url) => {
      const name = topicNameFromUrl(url);
      if (!name) return;
      bump(categoryScore, name, SUB_WEIGHT * mult);
    });
    const branding = c.brandingSettings?.channel?.keywords;
    if (branding) {
      const tokens = branding.match(/"[^"]+"|\S+/g)?.map((t) =>
        t.replace(/^"|"$/g, "").toLowerCase()) ?? [];
      tokens.forEach((t) => {
        if (!t || t.length < 2) return;
        bump(keywordScore, t, 1);
      });
    }
    const subCnt = parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0;
    if (subCnt > 0) subscriberCounts.push(subCnt);
    if (c.snippet?.title && typeof c.id === "string") {
      channels.push({
        id: c.id,
        name: c.snippet.title,
        thumbnail: c.snippet.thumbnails?.medium?.url ?? c.snippet.thumbnails?.default?.url ?? "",
        videoCount: parseInt(c.statistics?.videoCount ?? "0", 10) || 0,
      });
    }
  });

  let shortsCount = 0, longCount = 0, durSampled = 0;
  const viewCounts = [];

  likedVideos.forEach((v) => {
    const boost = recencyBoost(v.snippet?.publishedAt, now);
    const catId = v.snippet?.categoryId;
    const catName = (catId && categoryNameById[catId]) || "Other";
    bump(categoryScore, catName, LIKE_WEIGHT * boost);
    (v.topicDetails?.topicCategories ?? []).forEach((url) => {
      const name = topicNameFromUrl(url);
      if (!name) return;
      bump(categoryScore, name, LIKE_TOPIC_WEIGHT * boost);
    });
    (v.snippet?.tags ?? []).forEach((t) => {
      const k = t.trim().toLowerCase();
      if (!k) return;
      bump(keywordScore, k, 1);
    });
    const dur = parseIsoDuration(v.contentDetails?.duration);
    if (dur !== null) {
      durSampled++;
      if (dur <= 60) shortsCount++;
      else if (dur >= 600) longCount++;
    }
    const lang = v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage;
    if (lang) {
      const base = lang.split("-")[0].toLowerCase();
      bump(langScore, base, 1);
    }
    const vc = parseInt(v.statistics?.viewCount ?? "0", 10);
    if (Number.isFinite(vc) && vc > 0) viewCounts.push(vc);
    if (sampleVideoIds.length < MAX_SAMPLES && typeof v.id === "string") {
      sampleVideoIds.push(v.id);
    }
  });

  playlistVideos.forEach((v) => {
    const boost = recencyBoost(v.snippet?.publishedAt, now);
    const catId = v.snippet?.categoryId;
    const catName = (catId && categoryNameById[catId]) || "Other";
    bump(categoryScore, catName, PLAYLIST_WEIGHT * boost);
    (v.snippet?.tags ?? []).forEach((t) => {
      const k = t.trim().toLowerCase();
      if (!k) return;
      bump(keywordScore, k, 1);
    });
  });

  activities.forEach((a) => {
    const type = a.snippet?.type;
    const t = a.snippet?.publishedAt;
    if (!type || !t) return;
    const boost = recencyBoost(t, now);
    if (type === "like" || type === "favorite") {
      const cid = a.contentDetails?.like?.resourceId?.channelId;
      if (typeof cid === "string") {
        const mult = subRecencyByChannelId.get(cid) ?? 1;
        const ch = channelDetails.find((c) => c.id === cid);
        (ch?.topicDetails?.topicCategories ?? []).forEach((url) => {
          const name = topicNameFromUrl(url);
          if (!name) return;
          bump(categoryScore, name, ACTIVITY_LIKE_WEIGHT * boost * mult);
        });
      }
    } else if (type === "subscription") {
      const cid = a.contentDetails?.subscription?.resourceId?.channelId;
      const ch = channelDetails.find((c) => c.id === cid);
      (ch?.topicDetails?.topicCategories ?? []).forEach((url) => {
        const name = topicNameFromUrl(url);
        if (!name) return;
        bump(categoryScore, name, ACTIVITY_LIKE_WEIGHT * boost);
      });
    }
  });

  const total = Object.values(categoryScore).reduce((a, b) => a + b, 0);
  let categories = {};
  if (total > 0) {
    const top = Object.entries(categoryScore).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topTotal = top.reduce((a, [, v]) => a + v, 0) || 1;
    top.forEach(([name, score]) => {
      categories[name] = Math.round((score / topTotal) * 100);
    });
  } else {
    categories = { Discovery: 100 };
  }

  const topKeywords = Object.entries(keywordScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([k]) => k);

  const { diversity, concentration } = entropyScore(categoryScore);
  const shortsRatio = durSampled > 0 ? Math.round((shortsCount / durSampled) * 100) : 0;
  const longFormRatio = durSampled > 0 ? Math.round((longCount / durSampled) * 100) : 0;

  const langTotal = Object.values(langScore).reduce((a, b) => a + b, 0);
  const languageDistribution = {};
  let primaryLanguage = null;
  if (langTotal > 0) {
    const sorted = Object.entries(langScore).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, n]) => {
      languageDistribution[l] = Math.round((n / langTotal) * 100);
    });
    primaryLanguage = sorted[0][0];
  }

  const medViews = median(viewCounts);
  const mainstreamScore = medViews > 0
    ? Math.max(0, Math.min(100, Math.round(((Math.log10(medViews) - 3) / 5) * 100)))
    : 0;
  const medSubs = median(subscriberCounts);
  const nicheChannelScore = medSubs > 0
    ? Math.max(0, Math.min(100, Math.round(100 - ((Math.log10(medSubs) - 3) / 4) * 100)))
    : 0;

  return {
    categories,
    topKeywords,
    topChannels: channels.slice(0, MAX_CHANNELS),
    sampleVideoIds,
    metrics: {
      diversity, concentration, shortsRatio, longFormRatio,
      languageDistribution, primaryLanguage, mainstreamScore, nicheChannelScore,
    },
  };
}

// ── main ──────────────────────────────────────────────────────────────
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

// Load .env manually (no dotenv dep).
const envPath = path.resolve(".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    const v = m[2].replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  });
}

const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { accounts: { where: { provider: "google" }, take: 1 } },
});
const account = user?.accounts[0];
if (!account) {
  console.error("No google account for", userId);
  process.exit(1);
}

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);
auth.setCredentials({
  access_token: account.access_token,
  refresh_token: account.refresh_token,
  expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
});

// Force a refresh if expired.
const nowMs = Date.now();
const expMs = (account.expires_at ?? 0) * 1000;
if (!expMs || expMs < nowMs + 60_000) {
  console.log("[auth] refreshing token (expired or near expiry)...");
  const { credentials } = await auth.refreshAccessToken();
  console.log("[auth] new expiry:", new Date(credentials.expiry_date ?? 0).toISOString());
  await prisma.account.update({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId: account.providerAccountId,
      },
    },
    data: {
      access_token: credentials.access_token ?? account.access_token,
      expires_at: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : account.expires_at,
      refresh_token: credentials.refresh_token ?? account.refresh_token,
    },
  });
  // Also mirror onto User.accessToken if the app reads that.
  await prisma.user.update({
    where: { id: userId },
    data: { accessToken: credentials.access_token ?? account.access_token },
  });
}

const yt = google.youtube({ version: "v3", auth });

console.log("[fetch] starting...");
const [subsR, likesR, catR, plsR, actR] = await Promise.all([
  yt.subscriptions.list({ part: ["snippet", "contentDetails", "subscriberSnippet"], mine: true, maxResults: 50, order: "alphabetical" }),
  yt.videos.list({ part: ["snippet", "topicDetails", "contentDetails", "statistics"], myRating: "like", maxResults: 50 }),
  yt.videoCategories.list({ part: ["snippet"], regionCode: "KR", hl: "en_US" }),
  yt.playlists.list({ part: ["snippet", "contentDetails"], mine: true, maxResults: 25 }).catch((e) => { console.warn("playlists failed:", e.message); return { data: { items: [] } }; }),
  yt.activities.list({ part: ["snippet", "contentDetails"], mine: true, maxResults: 50 }).catch((e) => { console.warn("activities failed:", e.message); return { data: { items: [] } }; }),
]);

const subs = subsR.data.items ?? [];
const likes = likesR.data.items ?? [];
const categoryMap = {};
(catR.data.items ?? []).forEach((it) => { if (it.id && it.snippet?.title) categoryMap[it.id] = it.snippet.title; });
const playlists = plsR.data.items ?? [];
const activities = actR.data.items ?? [];

const channelIds = subs.map((s) => s.snippet?.resourceId?.channelId).filter((x) => typeof x === "string");
const chR = await yt.channels.list({
  part: ["snippet", "topicDetails", "statistics", "brandingSettings"],
  id: channelIds.slice(0, 50),
  maxResults: 50,
});
const channelDetails = chR.data.items ?? [];

const probedPlaylists = playlists.filter((p) => {
  const t = (p.snippet?.title ?? "").toLowerCase();
  return !["liked videos", "watch later"].includes(t);
}).slice(0, 5);
const playlistIdLists = await Promise.all(probedPlaylists.map(async (p) => {
  if (!p.id) return [];
  try {
    const r = await yt.playlistItems.list({ part: ["contentDetails"], playlistId: p.id, maxResults: 10 });
    return (r.data.items ?? []).map((it) => it.contentDetails?.videoId).filter((x) => typeof x === "string");
  } catch (e) { console.warn("playlistItems fail:", e.message); return []; }
}));
const playlistVideoIds = [...new Set(playlistIdLists.flat())].slice(0, 40);
let playlistVideos = [];
if (playlistVideoIds.length) {
  const r = await yt.videos.list({ part: ["snippet", "topicDetails", "contentDetails", "statistics"], id: playlistVideoIds.slice(0, 50), maxResults: 50 });
  playlistVideos = r.data.items ?? [];
}

console.log("[fetch] counts", {
  subs: subs.length, likes: likes.length, channelDetails: channelDetails.length,
  playlists: playlists.length, playlistVideos: playlistVideos.length,
  activities: activities.length, categoryMap: Object.keys(categoryMap).length,
});

const result = generateProfile({ subscriptions: subs, likedVideos: likes, channelDetails, categoryNameById: categoryMap, playlistVideos, activities });
console.log("[profile] metrics", result.metrics);
console.log("[profile] categories", result.categories);
console.log("[profile] topKeywords", result.topKeywords);
console.log("[profile] sampleVideoIds.len", result.sampleVideoIds.length);

const saved = await prisma.algoProfile.upsert({
  where: { userId },
  update: {
    categories: JSON.stringify(result.categories),
    topChannels: JSON.stringify(result.topChannels),
    topKeywords: JSON.stringify(result.topKeywords),
    sampleVideoIds: JSON.stringify(result.sampleVideoIds),
    metrics: JSON.stringify(result.metrics),
    lastSyncedAt: new Date(),
  },
  create: {
    userId,
    categories: JSON.stringify(result.categories),
    topChannels: JSON.stringify(result.topChannels),
    topKeywords: JSON.stringify(result.topKeywords),
    sampleVideoIds: JSON.stringify(result.sampleVideoIds),
    metrics: JSON.stringify(result.metrics),
  },
});
console.log("[save] metrics now:", saved.metrics);
await prisma.$disconnect();
