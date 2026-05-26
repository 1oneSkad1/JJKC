// NextAuth v5 + Google OAuth + PrismaAdapter.
// 1단계 통합 인증: 로그인 시점에 YouTube 권한을 한 번에 요청합니다.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/youtube.readonly",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) return null;

        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const googleId = account.providerAccountId;
        const email = user.email || profile?.email;

        console.log("[auth] signIn callback start", {
          googleId,
          email,
          incomingUserId: user.id,
        });

        // 1. 기존 유저를 googleId 또는 email로 찾음
        const userByGoogleId = await prisma.user.findUnique({
          where: { googleId },
        });
        const userByEmail = email 
          ? await prisma.user.findUnique({ where: { email } })
          : null;

        // 2. 충돌 시나리오 체크
        // 로그인된 상태에서 연동을 시도하는데, 해당 구글 계정이 이미 다른 사람(ID가 다름)에게 연결되어 있는 경우
        if (user.id && userByGoogleId && userByGoogleId.id !== user.id) {
          console.error("[auth] Identity collision: Google ID already belongs to another user", {
            currentSessionId: user.id,
            existingOwnerId: userByGoogleId.id
          });
          // 이 경우 NextAuth가 내부적으로 에러를 던지도록 내버려둠 (보안 정책)
          return true; 
        }

        // 3. 대상 유저 결정
        // - 이미 이 구글 계정으로 가입된 유저가 있다면 그 유저
        // - 없다면 이메일이 같은 유저 (allowDangerousEmailAccountLinking: true 설정에 의해 자동 연결됨)
        // - 둘 다 없다면 현재 로그인된 유저 또는 새로 생성될 유저
        const targetUserId = userByGoogleId?.id || userByEmail?.id || user.id;

        if (targetUserId) {
          try {
            const currentUser = await prisma.user.findUnique({
              where: { id: targetUserId },
              select: { name: true },
            });

            // 이름 설정 로직
            if (!currentUser?.name || currentUser.name === "Guest") {
              const count = await prisma.user.count();
              await prisma.user.update({
                where: { id: targetUserId },
                data: { name: user.name || `Guest #${count + 1}` },
              });
            }

            // User 테이블에 토큰 미러링
            await prisma.user.update({
              where: { id: targetUserId },
              data: {
                googleId,
                accessToken: account.access_token,
                expiresAt: account.expires_at,
                ...(account.refresh_token ? { refreshToken: account.refresh_token } : {}),
              },
            });
            console.log("[auth] User table tokens mirrored for targetUserId:", targetUserId);
          } catch (error) {
            console.error("[auth] User update mirrored failed:", error);
          }
        }
      }
      return true;
    },
  },
  pages: { signIn: "/" },
});

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
