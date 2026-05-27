// NextAuth v5 + Google OAuth + PrismaAdapter.
// 식별용 로그인만. YouTube Data API 의존을 걷어내고 RSS/oEmbed/정적 카탈로그로
// 전환했기 때문에 youtube.readonly scope, offline access, refresh token 모두
// 더 이상 필요 없다. User.accessToken/refreshToken/expiresAt 컬럼은 스키마에
// 남겨두되 새 로그인부터는 더 이상 채워지지 않는다.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      checks: ["state"],
      authorization: {
        params: {
          scope: ["openid", "email", "profile"].join(" "),
          response_type: "code",
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id: string }).id = user.id;
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === "google" && user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId:
              (profile as { sub?: string } | undefined)?.sub ?? undefined,
          },
        }).catch(() => {});
      }
      return true;
    },
  },
  events: {
    async linkAccount({ user, account, profile }) {
      if (account.provider === "google") {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: (profile as { sub?: string } | undefined)?.sub,
          },
        });
      }
    },
  },
  pages: { signIn: "/" },
});

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
