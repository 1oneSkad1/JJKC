import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUser) {
      if (existingUser.password) {
        // 이미 비밀번호가 있는 완전한 가입자
        return NextResponse.json(
          { error: "User already exists" },
          { status: 400 }
        );
      } else {
        // 구글 연동만 한 게스트 유저 -> 정식 회원으로 업그레이드
        const upgradedUser = await prisma.user.update({
          where: { email },
          data: {
            name,
            password: hashedPassword,
          },
        });
        return NextResponse.json(
          { message: "Account upgraded to registered", userId: upgradedUser.id },
          { status: 201 }
        );
      }
    }

    // 완전 신규 가입자
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    return NextResponse.json(
      { message: "User created successfully", userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
