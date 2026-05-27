// DB(Channel 테이블) 기반 검색·필터.
//
// feed-builder 가 RSS 호출 전 후보 channelId 를 뽑을 때, 그리고 onboard 폼의
// 채널 검색 (/api/channels/search) 이 모두 사용. YouTube API 호출 0.

import { prisma } from "../prisma";
import type { ChannelRecord } from "../types";
import { unpackChannel } from "../channel-service";

export type ChannelSearchResult = ChannelRecord;

// query 가 채널 title 또는 description 에 포함되는 채널 검색. 가벼운 LIKE 기반.
// SQLite 환경에서는 case-insensitive LIKE 가 기본이라 별도 lower() 불필요.
export async function searchChannels(
  query: string,
  opts: { limit?: number; minSubs?: number } = {},
): Promise<ChannelSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.channel.findMany({
    where: {
      isKorean: true,
      ...(opts.minSubs ? { subscriberCount: { gte: opts.minSubs } } : {}),
      OR: [
        { title: { contains: q } },
        { handle: { contains: q } },
        { description: { contains: q } },
      ],
    },
    orderBy: { subscriberCount: "desc" },
    take: opts.limit ?? 20,
  });
  return rows.map((r) => unpackChannel(r as any));
}

// 카테고리 이름이 top-1 인 채널들. (top-1 = JSON 의 가장 큰 weight)
// SQLite JSON 함수가 제한적이라 in-memory 필터링한다. 카탈로그 2~5K 규모에선
// 충분히 빠름. 더 커지면 Channel.primaryCategory 컬럼 추가 권장.
export async function listByCategory(
  category: string,
  opts: { limit?: number; minSubs?: number } = {},
): Promise<ChannelSearchResult[]> {
  const rows = await prisma.channel.findMany({
    where: {
      isKorean: true,
      ...(opts.minSubs ? { subscriberCount: { gte: opts.minSubs } } : {}),
    },
    orderBy: { subscriberCount: "desc" },
  });
  const records = rows.map((r) => unpackChannel(r as any));
  const filtered: ChannelSearchResult[] = [];
  for (const r of records) {
    const entries = Object.entries(r.categories);
    if (entries.length === 0) continue;
    const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    if (top === category) filtered.push(r);
    if (filtered.length >= (opts.limit ?? 30)) break;
  }
  return filtered;
}

// 키워드가 채널 keywords 에 포함된 채널들. JSON String 컬럼이라 contains 로 검색.
export async function listByKeyword(
  keyword: string,
  opts: { limit?: number; minSubs?: number } = {},
): Promise<ChannelSearchResult[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const rows = await prisma.channel.findMany({
    where: {
      isKorean: true,
      ...(opts.minSubs ? { subscriberCount: { gte: opts.minSubs } } : {}),
      // JSON 안의 string 매치. "kw" 형태로 박혀있으므로 quote 포함 search.
      keywords: { contains: `"${kw}"` },
    },
    orderBy: { subscriberCount: "desc" },
    take: opts.limit ?? 20,
  });
  return rows.map((r) => unpackChannel(r as any));
}

export async function getChannel(id: string): Promise<ChannelRecord | null> {
  const row = await prisma.channel.findUnique({ where: { id } });
  return row ? unpackChannel(row as any) : null;
}
