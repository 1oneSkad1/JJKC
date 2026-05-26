// POST   /api/follow/[userId] → follow
// DELETE /api/follow/[userId] → unfollow

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function toggle(
  paramsPromise: Promise<{ userId: string }>,
  action: "follow" | "unfollow",
) {
  const me = await getSessionUserId();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { userId } = await paramsPromise;
  if (userId === me) {
    return NextResponse.json({ error: "self" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isPublic: true },
  });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (action === "follow") {
    if (!target.isPublic) {
      return NextResponse.json({ error: "private" }, { status: 403 });
    }
    await prisma.follow
      .create({ data: { followerId: me, followingId: userId } })
      .catch((e: any) => {
        if (e?.code !== "P2002") throw e; // already follows → no-op
      });
    return NextResponse.json({ ok: true, following: true });
  }

  await prisma.follow
    .delete({
      where: { followerId_followingId: { followerId: me, followingId: userId } },
    })
    .catch((e: any) => {
      if (e?.code !== "P2025") throw e; // not following → no-op
    });
  return NextResponse.json({ ok: true, following: false });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return toggle(params, "follow");
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return toggle(params, "unfollow");
}
