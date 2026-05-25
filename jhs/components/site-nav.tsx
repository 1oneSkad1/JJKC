import Link from "next/link";
import { auth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SignOutButton } from "./sign-out-button";

export async function SiteNav() {
  const session = await auth();
  const user = session?.user as
    | { id: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined;

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
            <>
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <Link href="/discover" className="hover:underline">
                Discover
              </Link>
              <Link href="/compare" className="hover:underline">
                Compare
              </Link>
              <span className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  {user.image ? (
                    <AvatarImage src={user.image} alt={user.name ?? ""} />
                  ) : null}
                  <AvatarFallback>
                    {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {user.name ?? user.email}
                </span>
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/"
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
