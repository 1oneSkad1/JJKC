// AlgoProfile DB I/O. SQLite 에서는 JSON 필드를 String 으로 저장하므로
// 여기서 parse/stringify 를 책임진다.

import { prisma } from "./prisma";
import type {
  AlgoProfileShape,
  CategoryDist,
  ProfileMetrics,
  PublicUser,
  TopChannel,
} from "./types";
import type { ProfileResult } from "./profiler";

const safeParse = <T,>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const DEFAULT_METRICS: ProfileMetrics = {
  diversity: 0,
  concentration: 0,
  shortsRatio: 0,
  longFormRatio: 0,
  languageDistribution: {},
  primaryLanguage: null,
  mainstreamScore: 0,
  nicheChannelScore: 0,
};

type DbProfile = {
  userId: string;
  categories: string;
  topChannels: string;
  topKeywords: string;
  sampleVideoIds: string;
  metrics: string | null;
  lastSyncedAt: Date;
};

function unpack(p: DbProfile): AlgoProfileShape {
  return {
    userId: p.userId,
    categories: safeParse<CategoryDist>(p.categories, {}),
    topChannels: safeParse<TopChannel[]>(p.topChannels, []),
    topKeywords: safeParse<string[]>(p.topKeywords, []),
    sampleVideoIds: safeParse<string[]>(p.sampleVideoIds, []),
    metrics: safeParse<ProfileMetrics>(p.metrics, DEFAULT_METRICS),
    lastSyncedAt: p.lastSyncedAt.toISOString(),
  };
}

export async function getProfile(userId: string): Promise<AlgoProfileShape | null> {
  const row = await prisma.algoProfile.findUnique({ where: { userId } });
  return row ? unpack(row) : null;
}

export async function getProfileWithOwner(userId: string) {
  const row = await prisma.algoProfile.findUnique({
    where: { userId },
    include: { user: true },
  });
  if (!row) return null;
  const owner: PublicUser = {
    id: row.user.id,
    name: row.user.name ?? row.user.email ?? "Anonymous",
    image: row.user.image,
    email: row.user.email,
    isPublic: row.user.isPublic,
  };
  return { owner, profile: unpack(row) };
}

export async function saveProfile(userId: string, result: ProfileResult) {
  const data = {
    categories: JSON.stringify(result.categories),
    topChannels: JSON.stringify(result.topChannels),
    topKeywords: JSON.stringify(result.topKeywords),
    sampleVideoIds: JSON.stringify(result.sampleVideoIds),
    metrics: JSON.stringify(result.metrics),
  };
  return prisma.algoProfile.upsert({
    where: { userId },
    update: { ...data, lastSyncedAt: new Date() },
    create: { userId, ...data },
  });
}

export async function listPublic({
  cursor,
  limit,
}: {
  cursor?: string;
  limit: number;
}): Promise<{
  items: { owner: PublicUser; profile: AlgoProfileShape }[];
  nextCursor: string | null;
}> {
  const rows = await prisma.algoProfile.findMany({
    where: { user: { isPublic: true } },
    include: { user: true },
    orderBy: { lastSyncedAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  const sliced = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? sliced[sliced.length - 1].id : null;
  return {
    items: sliced.map((row) => ({
      owner: {
        id: row.user.id,
        name: row.user.name ?? row.user.email ?? "Anonymous",
        image: row.user.image,
        email: row.user.email,
        isPublic: row.user.isPublic,
      },
      profile: unpack(row),
    })),
    nextCursor,
  };
}
