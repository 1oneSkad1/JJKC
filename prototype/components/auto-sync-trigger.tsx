"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { signIn } from "next-auth/react";

export function AutoSyncTrigger() {
  const router = useRouter();
  const [status, setStatus] = useState<"syncing" | "success" | "error" | "insufficient" | "quota">("syncing");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const doSync = async () => {
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        
        if (!res.ok) {
          if (res.status === 429 || body.error === "quota_exceeded") {
            setStatus("quota");
            return;
          }
          if (res.status === 403 || body.error === "insufficient_permissions") {
            setStatus("insufficient");
            return;
          }
          throw new Error(body?.error || "Sync failed");
        }
        setStatus("success");
        // 성공 시 1.5초 후 페이지 리프레시하여 프로필 노출
        setTimeout(() => {
          router.replace("/dashboard");
          router.refresh();
        }, 1500);
      } catch (e: any) {
        console.error(e);
        setError(e.message);
        setStatus("error");
      }
    };

    doSync();
  }, [router]);

  const handleGrantPermission = () => {
    signIn("google", { 
      callbackUrl: "/dashboard?sync=auto",
    });
  };

  return (
    <Card className="mx-auto max-w-md border-primary/50 border-2">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          {status === "syncing" ? (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          ) : status === "success" ? (
            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          ) : status === "insufficient" ? (
            <ShieldAlert className="h-12 w-12 text-amber-500" />
          ) : status === "quota" ? (
            <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Clock className="h-6 w-6" />
            </div>
          ) : (
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
        </div>
        <CardTitle>
          {status === "syncing" && "YouTube 알고리즘 분석 중..."}
          {status === "success" && "분석이 완료되었습니다!"}
          {status === "insufficient" && "YouTube 권한이 필요합니다"}
          {status === "quota" && "일일 할당량 초과"}
          {status === "error" && "분석 중 오류가 발생했습니다"}
        </CardTitle>
        <CardDescription>
          {status === "syncing" && "유튜브 데이터를 가져와 당신의 알고리즘 지문을 만들고 있습니다. 잠시만 기다려 주세요."}
          {status === "success" && "잠시 후 대시보드로 이동합니다."}
          {status === "insufficient" && "데이터를 불러오려면 YouTube 읽기 권한 승인이 필요합니다. 아래 버튼을 눌러 승인해 주세요."}
          {status === "quota" && "YouTube API 사용량이 오늘치 한도를 넘었습니다. 한국 시간 오후 5시 이후에 리셋되니 그때 다시 시도해 주세요."}
          {status === "error" && error}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex flex-col gap-2">
        {status === "insufficient" && (
          <Button onClick={handleGrantPermission} className="w-full">
            YouTube 권한 허용하기
          </Button>
        )}
        
        {(status === "error" || status === "insufficient" || status === "quota") && (
          <button 
            onClick={() => window.location.href = "/dashboard"}
            className="text-sm text-muted-foreground underline mt-2 text-center"
          >
            대시보드로 돌아가기
          </button>
        )}
      </CardContent>
    </Card>
  );
}
