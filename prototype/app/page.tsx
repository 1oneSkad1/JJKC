import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { SignInButton } from "@/components/sign-in-button";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <section className="space-y-16 py-10">
      <header className="space-y-5 text-center">
        <h1 className="text-balance text-5xl font-semibold tracking-tight">
          당신의 <span className="text-accent">YouTube 알고리즘</span> 을<br />
          공유하고 탐험하세요.
        </h1>
        <p className="mx-auto max-w-2xl text-balance text-base text-muted-foreground">
          내 구독·좋아요 데이터로 알고리즘 프로필을 만들고,
          다른 사람의 알고리즘이 본 영상을 그대로 받아 보세요.
          나와 닮은 사람을 찾고, 카테고리·키워드를 비교할 수 있습니다.
        </p>
      </header>

      <div className="mx-auto max-w-4xl grid gap-8 md:grid-cols-2">
        <Card className="p-8 text-center space-y-6 border-primary/20 border-2 flex flex-col h-full">
          <div className="space-y-2 flex-grow">
            <h2 className="text-xl font-bold">빠른 시작 (추천)</h2>
            <p className="text-sm text-muted-foreground">
              Google 계정을 연동하여 1초 만에 알고리즘을 분석합니다.
            </p>
          </div>
          <SignInButton />
          <p className="text-[10px] text-muted-foreground italic">
            * YouTube 데이터 v3 API 읽기 권한이 필요합니다.
          </p>
        </Card>

        <Card className="p-8 text-center space-y-6 border-accent/20 border-2 flex flex-col h-full">
          <div className="space-y-2 flex-grow">
            <h2 className="text-xl font-bold">파일로 분석하기</h2>
            <p className="text-sm text-muted-foreground">
              API 할당량 걱정 없이 Google Takeout 파일을 업로드하여 분석합니다.
            </p>
          </div>
          <Button size="lg" variant="outline" className="w-full" asChild>
            <Link href="/takeout">시작하기</Link>
          </Button>
          <p className="text-[10px] text-muted-foreground italic">
            * 구글에서 내보낸 시청 기록(.json) 파일이 필요합니다.
          </p>
        </Card>
      </div>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          {
            title: "내 알고리즘 카드",
            body: "카테고리 분포·대표 채널·관심 키워드를 한 화면에 시각화.",
          },
          {
            title: "타인의 알고리즘으로 보기",
            body: "친구·인플루언서의 프로필 기반으로 큐레이션된 영상 피드 노출.",
          },
          {
            title: "Compare & Follow",
            body: "내 알고리즘과 누군가의 알고리즘을 레이더 차트로 겹쳐 보고 팔로우.",
          },
        ].map((f) => (
          <Card key={f.title} className="p-6">
            <h3 className="mb-1 font-medium">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </Card>
        ))}
      </section>
    </section>
  );
}
