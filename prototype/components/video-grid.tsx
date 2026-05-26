import Image from "next/image";
import type { FeedVideo } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const SOURCE_LABEL: Record<FeedVideo["source"], string> = {
  channel: "구독 채널",
  keyword: "키워드",
  category: "카테고리",
};

export function VideoGrid({ videos }: { videos: FeedVideo[] }) {
  if (videos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        아직 영상이 없습니다. YouTube 동기화 후 다시 확인해 주세요.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <li
          key={v.id}
          className="overflow-hidden rounded-xl border bg-card text-card-foreground"
        >
          <a
            href={`https://www.youtube.com/watch?v=${v.id}`}
            target="_blank"
            rel="noreferrer"
            className="block"
          >
            <div className="relative aspect-video bg-muted">
              <Image
                src={v.thumbnail}
                alt={v.title}
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                unoptimized
              />
              <Badge variant="muted" className="absolute left-2 top-2 backdrop-blur-sm">
                {SOURCE_LABEL[v.source]}
              </Badge>
            </div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-medium">{v.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {v.channelName}
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
