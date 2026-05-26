import Image from "next/image";
import type { TopChannel } from "@/lib/types";

export function ChannelList({ channels }: { channels: TopChannel[] }) {
  if (channels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">아직 채널 데이터가 없습니다.</p>
    );
  }
  return (
    <ul className="space-y-3">
      {channels.map((c) => (
        <li key={c.id} className="flex items-center gap-3">
          {c.thumbnail ? (
            <Image
              src={c.thumbnail}
              alt={c.name}
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <span className="h-9 w-9 rounded-full bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.name}</div>
            <div className="text-xs text-muted-foreground">
              {c.videoCount.toLocaleString()} videos
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
