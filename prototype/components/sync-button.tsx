"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useEffect, useCallback } from "react";
import { RefreshCw, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";

interface SyncButtonProps {
  label?: string;
  className?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "accent";
  lastSyncedAt?: string | Date;
}

export function SyncButton({ label = "Sync from YouTube", className, variant = "accent", lastSyncedAt }: SyncButtonProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  const calculateRemaining = useCallback(() => {
    if (!lastSyncedAt) return 0;
    const lastSync = new Date(lastSyncedAt);
    const now = new Date();
    const diffMs = now.getTime() - lastSync.getTime();
    const fiveMinutesMs = 5 * 60 * 1000;
    
    if (diffMs < fiveMinutesMs) {
      return Math.ceil((fiveMinutesMs - diffMs) / 1000);
    }
    return 0;
  }, [lastSyncedAt]);

  useEffect(() => {
    const initialRemaining = calculateRemaining();
    setRemainingSeconds(initialRemaining);

    if (initialRemaining <= 0) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateRemaining]);

  const handleSync = async () => {
    if (remainingSeconds > 0) return;
    setError(null);
    
    // 권한 요청 시 기본 google provider 사용 (backend 에 scope 설정됨)
    if (label.includes("연동") || label.includes("첫") || label.includes("시작")) {
      await signIn("google", { 
        callbackUrl: "/dashboard?sync=auto",
      });
      return;
    }

    // 일반적인 Re-sync
    start(async () => {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 권한 오류 시 재인증
        if (res.status === 401 || res.status === 403) {
          await signIn("google", { 
            callbackUrl: "/dashboard?sync=auto",
          });
          return;
        }

        if (res.status === 429 && body.retryAfter) {
          setRemainingSeconds(body.retryAfter);
        }
        
        setError(body?.error ?? body?.message ?? "sync failed");
        return;
      }

      router.refresh();
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isDisabled = pending || remainingSeconds > 0;

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <Button
        variant={variant}
        size={className?.includes("w-full") ? "lg" : "sm"}
        disabled={isDisabled}
        className={className}
        onClick={handleSync}
      >
        {label.includes("연동") ? (
          <Zap className="h-4 w-4" />
        ) : remainingSeconds > 0 ? (
          <Clock className="h-3.5 w-3.5" />
        ) : (
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
        )}
        {pending ? "Syncing…" : remainingSeconds > 0 ? `${formatTime(remainingSeconds)}` : label}
      </Button>
      {error ? <span className="max-w-xs text-center text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
