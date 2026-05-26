// 캐시 추상화. 기본은 in-memory (HMR safe). UPSTASH_REDIS_REST_URL 과
// UPSTASH_REDIS_REST_TOKEN 환경변수가 설정돼 있으면 자동으로 Upstash 로 갈아탄다.

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

class MemoryCache implements CacheStore {
  private map = new Map<string, { v: unknown; exp: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) {
      this.map.delete(key);
      return null;
    }
    return hit.v as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number) {
    this.map.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string) {
    this.map.delete(key);
  }
}

class UpstashCache implements CacheStore {
  private client: import("@upstash/redis").Redis;
  constructor() {
    // Lazy import — only instantiated when env vars are present.
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    this.client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  async get<T>(key: string): Promise<T | null> {
    return (await this.client.get<T>(key)) ?? null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    await this.client.set(key, value, { ex: ttlSeconds });
  }
  async del(key: string) {
    await this.client.del(key);
  }
}

const g = globalThis as unknown as { __cache?: CacheStore };

function init(): CacheStore {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    try {
      return new UpstashCache();
    } catch {
      // fall through to memory if Upstash client init fails
    }
  }
  return new MemoryCache();
}

export const cache: CacheStore = (g.__cache ??= init());

// plan.md §주요 제약: YouTube 동기화 주기 최소 1시간. 1h = 3600s.
export const TTL = {
  feed: 60 * 30,        // 30분
  profile: 60 * 60,     // 1시간
  explore: 60 * 5,      // 5분
} as const;
