import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "yt-algo-share",
  description:
    "당신의 YouTube 알고리즘을 공유하고, 다른 사람의 알고리즘으로 콘텐츠를 탐험하세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>
          <SiteNav />
          <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
