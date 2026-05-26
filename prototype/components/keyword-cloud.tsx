import { cn } from "@/lib/utils";

export function KeywordCloud({
  keywords,
  className,
}: {
  keywords: string[];
  className?: string;
}) {
  if (keywords.length === 0) {
    return <p className="text-sm text-muted-foreground">키워드가 아직 없습니다.</p>;
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {keywords.map((k, i) => {
        // 앞쪽이 더 큰 가중치 → 글자 크기로 시각화
        const size =
          i < 2 ? "text-sm" : i < 5 ? "text-xs" : "text-[10px]";
        return (
          <span
            key={k}
            className={cn(
              "rounded-full bg-muted px-2.5 py-1 text-muted-foreground",
              size,
            )}
          >
            {k}
          </span>
        );
      })}
    </div>
  );
}
