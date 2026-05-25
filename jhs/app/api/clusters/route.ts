// GET /api/clusters — 클러스터 맵(라벨/크기/topCategories/topKeywords).
import { NextResponse } from "next/server";
import { listClusters } from "@/lib/channel-service";
import { cache, TTL } from "@/lib/cache";

export async function GET() {
  const ckey = "clusters:all";
  const cached = await cache.get<unknown>(ckey);
  if (cached) return NextResponse.json({ clusters: cached, cacheHit: true });

  const clusters = await listClusters();
  await cache.set(ckey, clusters, TTL.profile);
  return NextResponse.json({ clusters, cacheHit: false });
}
