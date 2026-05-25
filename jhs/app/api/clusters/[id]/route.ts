// GET /api/clusters/[id] — 클러스터 상세 + 멤버 채널(구독자순).
import { NextResponse } from "next/server";
import { getClusterWithChannels } from "@/lib/channel-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (Number.isNaN(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const data = await getClusterWithChannels(numId);
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
