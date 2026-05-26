import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { performTakeoutSync } from "@/lib/sync-service";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const session = await auth();
  let userId = session?.user?.id;

  try {
    const { entries } = await req.json();
    
    if (!entries || !Array.isArray(entries)) {
      return NextResponse.json({ message: "올바른 데이터 형식이 아닙니다." }, { status: 400 });
    }

    // 세션이 없는 경우(비로그인) 새로운 게스트 유저 생성
    if (!userId) {
      const guestCount = await prisma.user.count({
        where: { password: null, googleId: null }
      });
      const newGuest = await prisma.user.create({
        data: {
          name: `Guest #${guestCount + 1}`,
          isPublic: false, // 비로그인 게스트는 기본 비공개
        }
      });
      userId = newGuest.id;

      // 비로그인 사용자에게 소유권 증명 쿠키 발급
      const cookieStore = await cookies();
      cookieStore.set(`guest_owner_${userId}`, "true", {
        maxAge: 60 * 60 * 24 * 30, // 30일 유지
        httpOnly: true,
        path: "/",
      });
    }

    const result = await performTakeoutSync(userId, entries);

    return NextResponse.json({ 
      success: true, 
      message: "분석이 성공적으로 완료되었습니다.",
      userId: userId, // 프론트엔드 리다이렉션용
      data: result 
    });
  } catch (error: any) {
    console.error("[api/sync/takeout] Error:", error);
    return NextResponse.json({ 
      message: error.message || "데이터 처리 중 서버 오류가 발생했습니다." 
    }, { status: 500 });
  }
}
