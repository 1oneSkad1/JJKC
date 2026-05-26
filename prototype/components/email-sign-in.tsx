"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUp, Mail } from "lucide-react";

export function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    start(async () => {
      await signIn("credentials", { 
        email, 
        callbackUrl: "/dashboard" 
      });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm mx-auto">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          이메일 주소로 계속하기
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-10"
            required
            disabled={pending}
          />
        </div>
      </div>
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? (
          "처리 중..."
        ) : (
          <>
            <FileUp className="mr-2 h-4 w-4" />
            계정 없이 파일로 분석하기
          </>
        )}
      </Button>
      <p className="text-[10px] text-center text-muted-foreground">
        비밀번호 없이 이메일만으로 간편하게 가입하고 Takeout 파일을 업로드할 수 있습니다.
      </p>
    </form>
  );
}
