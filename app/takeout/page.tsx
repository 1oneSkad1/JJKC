"use client";

import { useState } from "react";
import { FileUp, Info, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { parseTakeout } from "@/lib/takeout-parser";
import Link from "next/link";

export default function TakeoutPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const entries = await parseTakeout(file);
      
      if (entries.length === 0) {
        throw new Error("파일에서 시청 기록을 찾을 수 없습니다. 올바른 파일을 업로드했는지 확인해주세요.");
      }

      const res = await fetch("/api/sync/takeout", {
        method: "POST",
        body: JSON.stringify({ entries }),
        headers: { "Content-Type": "application/json" },
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.message || "서버로 데이터를 전송하는 데 실패했습니다.");
      }

      setSuccess(true);
      setTimeout(() => {
        // 비로그인 상태일 수 있으므로 대시보드 대신 개별 프로필 페이지로 이동
        window.location.href = `/profile/${body.userId}`;
      }, 2000);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "파일 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 py-10">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Google Takeout으로 분석하기</h1>
        <p className="text-muted-foreground">
          로그인 없이도, 내 시청 기록 파일을 업로드하여 즉시 알고리즘을 분석해볼 수 있습니다.
        </p>
      </header>

      {/* Tutorial Section */}
      <section className="grid gap-6 md:grid-cols-3">
        {[
          {
            step: "1",
            title: "데이터 선택",
            desc: "Google Takeout에서 'YouTube 및 YouTube Music'만 선택하세요.",
            link: "https://takeout.google.com"
          },
          {
            step: "2",
            title: "형식 설정",
            desc: "여러 옵션 중 '시청 기록'을 JSON 형식으로 내보내기 하세요.",
          },
          {
            step: "3",
            title: "파일 업로드",
            desc: "생성된 .json 파일을 아래 업로드 영역에 넣어주세요.",
          },
        ].map((s) => (
          <Card key={s.step} className="relative overflow-hidden border-2">
            <div className="absolute top-0 right-0 p-2 text-4xl font-black text-muted/10 select-none">
              {s.step}
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{s.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
              {s.link && (
                <Button variant="link" className="px-0 h-auto mt-2 text-accent" asChild>
                  <a href={s.link} target="_blank" rel="noreferrer">
                    Takeout 바로가기 <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Detail Guide */}
      <Card className="bg-muted/50 border-none">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <Info className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="text-sm space-y-2">
              <p className="font-semibold">더 자세한 방법:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li><a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="underline font-medium text-foreground">Google Takeout</a> 접속</li>
                <li>'모두 선택 해제'를 누른 후 리스트 맨 아래의 <b>YouTube 및 YouTube Music</b>만 체크</li>
                <li>'여러 형식' 클릭 후 <b>내역(History)</b>의 형식을 <b>JSON</b>으로 변경</li>
                <li>'YouTube 데이터 포함' 클릭 후 <b>시청 기록(watch-history)</b>만 선택</li>
                <li>'다음 단계' 클릭 후 '내보내기 생성' (이메일로 링크가 옵니다)</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Section */}
      <Card className={`border-2 border-dashed transition-colors ${file ? 'border-primary bg-primary/5' : 'border-muted-foreground/20'}`}>
        <CardContent className="p-10 flex flex-col items-center text-center gap-4">
          {success ? (
            <div className="space-y-4 animate-in zoom-in duration-300">
              <div className="bg-green-500/10 p-3 rounded-full mx-auto w-fit">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">업로드 완료!</h3>
                <p className="text-muted-foreground">분석을 완료했습니다. 결과 페이지로 이동합니다...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-accent/10 p-4 rounded-full">
                <FileUp className={`h-8 w-8 ${file ? 'text-primary' : 'text-accent'}`} />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">
                  {file ? file.name : "watch-history.json 파일을 선택하세요"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  구글에서 다운로드한 .json 또는 .html 파일이 필요합니다.
                </p>
              </div>
              
              <div className="flex gap-2">
                <input
                  type="file"
                  id="takeout-file"
                  className="hidden"
                  accept=".json,.html"
                  onChange={handleFileChange}
                  disabled={loading}
                />
                <Button variant="outline" asChild disabled={loading}>
                  <label htmlFor="takeout-file" className="cursor-pointer">
                    파일 선택
                  </label>
                </Button>
                <Button 
                  onClick={handleUpload} 
                  disabled={!file || loading}
                  className="min-w-[100px]"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {loading ? "분석 중..." : "분석 시작"}
                </Button>
              </div>
              {error && <p className="text-sm text-destructive font-medium mt-2">{error}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="ghost" className="text-muted-foreground" asChild>
          <Link href="/">메인으로 돌아가기</Link>
        </Button>
      </div>
    </div>
  );
}
