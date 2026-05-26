// POST /api/sync — YouTube → AlgoProfile upsert + cache invalidate.

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { performAutoSync } from "@/lib/sync-service";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 5분 제한 체크
  const profile = await prisma.algoProfile.findUnique({
    where: { userId },
    select: { lastSyncedAt: true }
  });

  if (profile) {
    const now = new Date();
    const lastSync = new Date(profile.lastSyncedAt);
    const diffMs = now.getTime() - lastSync.getTime();
    const fiveMinutesMs = 5 * 60 * 1000;

    if (diffMs < fiveMinutesMs) {
      const remainingSeconds = Math.ceil((fiveMinutesMs - diffMs) / 1000);
      return NextResponse.json(
        { 
          error: "rate_limit_exceeded", 
          message: `너무 자주 동기화할 수 없습니다. ${remainingSeconds}초 후에 다시 시도해 주세요.`,
          retryAfter: remainingSeconds
        }, 
        { status: 429 }
      );
    }
  }

  try {
    const saved = await performAutoSync(userId);
    return NextResponse.json({
      ok: true,
      lastSyncedAt: saved.lastSyncedAt.toISOString(),
    });
  } catch (e: any) {
    console.error("[api/sync] error", e.message);

    // 권한 부족 또는 403 에러 발생 시 처리
    if (e.message === "INSUFFICIENT_PERMISSIONS" || e?.response?.status === 403 || e?.code === 403) {
      const isQuota = e.message?.toLowerCase().includes("quota") || 
                      JSON.stringify(e).toLowerCase().includes("quota");
      
      if (isQuota) {
        return NextResponse.json(
          { error: "quota_exceeded", message: "YouTube API 일일 사용량이 모두 소진되었습니다. 내일 다시 시도해 주세요." },
          { status: 429 }, // Too Many Requests
        );
      }

      return NextResponse.json(
        { error: "insufficient_permissions", message: e.message },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: e?.message ?? "sync_failed" },
      { status: 500 },
    );
  }
}
