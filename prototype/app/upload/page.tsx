"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseTakeout, WatchEntry } from "@/lib/takeout-parser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileJson, FileCode, CheckCircle2, AlertCircle } from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "enriching" | "saving" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ count: number; format: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setStats(null);
      setStatus("idle");
    }
  };

  const startProcess = async () => {
    if (!file) return;

    try {
      setStatus("parsing");
      const entries = await parseTakeout(file);
      
      if (entries.length === 0) {
        throw new Error("파일에서 시청 기록을 찾을 수 없습니다. 올바른 파일을 업로드했는지 확인해주세요.");
      }

      setStats({
        count: entries.length,
        format: file.name.endsWith(".json") ? "JSON" : "HTML",
      });

      // Step 2: Enrich data via API
      setStatus("enriching");
      // 최근 200개만 샘플링하여 분석 (쿼터 및 성능 최적화)
      const sampledEntries = entries.slice(0, 200);
      
      const response = await fetch("/api/sync/takeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: sampledEntries }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || "데이터 분석 중 오류가 발생했습니다.");
      }

      setStatus("success");
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  return (
    <div className="container max-w-2xl py-10">
      <Card className="border-2 border-dashed">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">YouTube 데이터 업로드</CardTitle>
          <CardDescription>
            Google Takeout에서 다운로드한 시청 기록 파일을 업로드하여 알고리즘을 분석합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-6 text-center space-y-4">
            <div className="flex justify-center">
              {status === "idle" || status === "error" ? (
                <Upload className="h-12 w-12 text-muted-foreground" />
              ) : status === "success" ? (
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              ) : (
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="file-upload" className="cursor-pointer">
                <Button variant="outline" asChild>
                  <span>
                    {file ? file.name : "파일 선택 (.json 또는 .html)"}
                  </span>
                </Button>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".json,.html"
                  onChange={handleFileChange}
                  disabled={status !== "idle" && status !== "error"}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                watch-history.json 또는 watch-history.html 파일을 업로드하세요.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {stats && (
            <div className="flex justify-between items-center bg-primary/5 p-3 rounded-md">
              <div className="flex items-center gap-2">
                {stats.format === "JSON" ? <FileJson className="h-4 w-4" /> : <FileCode className="h-4 w-4" />}
                <span className="text-sm font-medium">{stats.format} 형식 인식됨</span>
              </div>
              <Badge variant="secondary">{stats.count.toLocaleString()}개의 기록</Badge>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">데이터 획득 방법:</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li><a href="https://takeout.google.com" target="_blank" className="text-primary underline">Google Takeout</a> 접속</li>
              <li>"모두 선택 해제" 후 <strong>YouTube</strong>만 선택</li>
              <li>"YouTube 데이터 포함"에서 <strong>history</strong>만 선택</li>
              <li>파일 형식: HTML(기본) 또는 JSON 선택 후 생성</li>
              <li>이메일로 온 압축파일 해제 후 <code>watch-history</code> 파일 업로드</li>
            </ol>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button 
            className="w-full" 
            size="lg"
            onClick={startProcess}
            disabled={!file || status === "parsing" || status === "enriching" || status === "saving" || status === "success"}
          >
            {status === "idle" && "분석 시작하기"}
            {status === "parsing" && "파일 파싱 중..."}
            {status === "enriching" && "YouTube 데이터 보강 중..."}
            {status === "saving" && "알고리즘 계산 중..."}
            {status === "success" && "분석 완료!"}
            {status === "error" && "다시 시도"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => router.back()}>
            취소
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
