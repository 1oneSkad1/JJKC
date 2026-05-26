// POST /api/profile/visibility — 본인 프로필 공개/비공개 토글.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cache } from "@/lib/cache";
import { profileCacheKey } from "@/lib/keys";

const Body = z.object({ isPublic: z.boolean() });

export async function POST(req: Request) {
  const me = await getSessionUserId();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: me },
    data: { isPublic: parsed.data.isPublic },
  });
  await cache.del(profileCacheKey(me));

  return NextResponse.json({ ok: true, isPublic: parsed.data.isPublic });
}
