// Cache key 빌더. 한 곳에 모아 두면 invalidation 누락이 줄어든다.
// feed key 는 lib/feed-builder.ts 가 자체적으로 version 을 포함해 관리.

export const profileCacheKey = (userId: string) => `profile:${userId}`;
export const exploreCacheKey = (cursor: string | null, limit: number) =>
  `explore:${cursor ?? "_"}:${limit}`;
