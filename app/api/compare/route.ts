// GET /api/compare?a=&b= — 두 사용자 알고리즘 비교.

import { NextResponse } from "next/server";
import { getProfileWithOwner } from "@/lib/profile-service";
import { getSessionUserId } from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b) {
    return NextResponse.json({ error: "?a=&b= required" }, { status: 400 });
  }
  const me = await getSessionUserId();

  const [pa, pb] = await Promise.all([
    getProfileWithOwner(a),
    getProfileWithOwner(b),
  ]);
  if (!pa || !pb) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    (!pa.owner.isPublic && me !== a) ||
    (!pb.owner.isPublic && me !== b)
  ) {
    return NextResponse.json({ error: "private" }, { status: 403 });
  }

  const keys = Array.from(
    new Set([
      ...Object.keys(pa.profile.categories),
      ...Object.keys(pb.profile.categories),
    ]),
  );
  const rows = keys
    .map((cat) => ({
      category: cat,
      a: pa.profile.categories[cat] ?? 0,
      b: pb.profile.categories[cat] ?? 0,
    }))
    .sort((x, y) => y.a + y.b - (x.a + x.b))
    .slice(0, 12);

  const sharedKeywords = pa.profile.topKeywords.filter((k) =>
    pb.profile.topKeywords.includes(k),
  );

  return NextResponse.json({ a: pa, b: pb, rows, sharedKeywords });
}
