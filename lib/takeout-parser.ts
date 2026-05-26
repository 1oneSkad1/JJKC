export interface WatchEntry {
  videoId: string;
  title: string;
  channelId?: string;
  channelTitle?: string;
  time: string;
}

/**
 * Extracts video ID from YouTube URL
 */
function extractVideoId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/[?&]v=([^&#]+)/);
  return match ? match[1] : null;
}

/**
 * Extracts channel ID from YouTube Channel URL
 */
function extractChannelId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/channel\/([^&#/]+)/);
  return match ? match[1] : null;
}

/**
 * Parses Google Takeout Watch History in JSON format
 */
export function parseTakeoutJSON(jsonContent: string): WatchEntry[] {
  const data = JSON.parse(jsonContent);
  if (!Array.isArray(data)) return [];

  return data
    .map((item: any): WatchEntry | null => {
      const videoId = extractVideoId(item.titleUrl);
      if (!videoId) return null;

      return {
        videoId,
        title: item.title?.replace("Watched ", "") || "Unknown Title",
        channelId: extractChannelId(item.subtitles?.[0]?.url) || undefined,
        channelTitle: item.subtitles?.[0]?.name,
        time: item.time,
      };
    })
    .filter((entry): entry is WatchEntry => entry !== null);
}

/**
 * Parses Google Takeout Watch History in HTML format
 */
export function parseTakeoutHTML(htmlContent: string): WatchEntry[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  const cells = doc.querySelectorAll(".content-cell");
  const entries: WatchEntry[] = [];

  cells.forEach((cell) => {
    const text = cell.textContent || "";
    if (!text.startsWith("Watched")) return;

    const links = cell.querySelectorAll("a");
    const videoLink = links[0];
    const channelLink = links[1];

    const videoId = extractVideoId(videoLink?.href);
    if (!videoId) return;

    // The timestamp is usually the last text node after the last <br>
    const lines = cell.innerHTML.split("<br>");
    const timeStr = lines[lines.length - 1]?.trim().replace(/<[^>]*>?/gm, "") || "";

    entries.push({
      videoId,
      title: videoLink?.textContent || "Unknown Title",
      channelId: extractChannelId(channelLink?.href) || undefined,
      channelTitle: channelLink?.textContent || undefined,
      time: timeStr,
    });
  });

  return entries;
}

/**
 * Unified parser that detects type based on file extension or content
 */
export async function parseTakeout(file: File): Promise<WatchEntry[]> {
  const content = await file.text();
  
  if (file.name.endsWith(".json") || content.trim().startsWith("[")) {
    return parseTakeoutJSON(content);
  } else if (file.name.endsWith(".html") || content.trim().toLowerCase().startsWith("<!doctype html") || content.includes("content-cell")) {
    return parseTakeoutHTML(content);
  }
  
  throw new Error("지원하지 않는 파일 형식입니다. .json 또는 .html 파일을 업로드해주세요.");
}
