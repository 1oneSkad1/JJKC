// YouTube oEmbed 어댑터 — 영상 단건 메타 보강 (key 불필요).
//   https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=VIDEO_ID&format=json
//
// 반환: title / author_name / author_url / thumbnail_url 정도. 조회수·구독자수는 없음.
// RSS 가 더 풍부하므로 oEmbed 는 "RSS 로 못 잡는 단건 영상" 보강에만 쓴다.

const UA =
  "Mozilla/5.0 (compatible; yt-algo-share/0.1; +https://example.com/bot)";

export type OembedVideo = {
  videoId: string;
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnail: string;
};

export async function fetchOembedVideo(
  videoId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<OembedVideo | null> {
  const url =
    `https://www.youtube.com/oembed?format=json&url=` +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: opts.signal,
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j: any = await res.json().catch(() => null);
  if (!j) return null;
  return {
    videoId,
    title: j.title ?? "",
    authorName: j.author_name ?? "",
    authorUrl: j.author_url ?? "",
    thumbnail:
      j.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}
