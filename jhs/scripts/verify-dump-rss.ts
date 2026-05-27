// dump.sql 의 채널 id 가 실제 YouTube 에 존재하는지 RSS 로 검증.
//
//   npx tsx scripts/verify-dump-rss.ts < /tmp/dump-sample.txt
//
// 입력: 각 줄 "channelId\ttitle"
// 출력: 각 줄별 RSS 응답이 정상이면 ✓ + 실제 title 비교, 404 면 ✗.

import readline from "node:readline";
import { fetchChannelFeed } from "../lib/sources/rss";

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const items: { id: string; title: string }[] = [];
  for await (const line of rl) {
    const [id, title] = line.split("\t");
    if (id?.startsWith("UC")) items.push({ id, title: title ?? "" });
  }

  let ok = 0;
  let fail = 0;
  let mismatch = 0;
  for (const it of items) {
    const feed = await fetchChannelFeed(it.id).catch(() => null);
    if (!feed) {
      fail++;
      console.log(`✗ 404         ${it.id}  (dump title: ${it.title})`);
    } else {
      const matchClose =
        feed.title?.includes(it.title) || it.title?.includes(feed.title || "");
      if (matchClose) {
        ok++;
        console.log(`✓             ${it.id}  ${feed.title}`);
      } else {
        mismatch++;
        console.log(
          `⚠ title mismatch  ${it.id}  dump='${it.title}'  rss='${feed.title}'`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\n결과: ok=${ok}  404=${fail}  title mismatch=${mismatch}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
