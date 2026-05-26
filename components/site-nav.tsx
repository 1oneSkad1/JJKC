import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SignOutButton } from "./sign-out-button";
import { User as UserIcon } from "lucide-react";

export async function SiteNav() {
  const session = await auth();
  const user = session?.user as
    | { id: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  let isGuest = true;
  let displayName = "당신";

  if (user) {
    // 세션이 있으면 무조건 정식 회원(Member)으로 취급 (구글 또는 이메일 로그인)
    isGuest = false;

    if (user.email) {
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { name: true },
      });
      displayName = (dbUser?.name?.startsWith("Guest #") || !dbUser?.name) ? "당신" : dbUser.name;
    }
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight">
            yt-algo-share
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/explore" className="hover:underline">
            Explore
          </Link>
          {user?.id ? (
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              {!isGuest && (
                <Link href="/compare" className="hover:underline">
                  Compare
                </Link>
              )}
              <div className="flex items-center gap-2 border-l pl-4 ml-2">
                <Avatar className="h-7 w-7">
                  {user.image ? (
                    <AvatarImage src={user.image} alt={displayName} />
                  ) : null}
                  <AvatarFallback>
                    {isGuest ? (
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      displayName.slice(0, 1).toUpperCase()
                    )}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-xs text-muted-foreground sm:inline max-w-[100px] truncate">
                  {displayName}
                </span>
                <SignOutButton />
              </div>
            </div>
          ) : (
            <Link
              href="/auth"
              className="rounded-full bg-accent px-3 py-1 text-white"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
