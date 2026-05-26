"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (isLogin) {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError("Invalid email or password");
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        // Automatically login after signup
        await signIn("credentials", {
          email,
          password,
          callbackUrl: "/dashboard",
        });
      } else {
        const data = await res.json();
        setError(data.error || "Signup failed");
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isLogin ? "로그인" : "회원가입"}</CardTitle>
          <CardDescription>
            {isLogin 
              ? "계정에 로그인하여 계속하세요." 
              : "새 계정을 만들고 시작하세요."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <label className="text-sm font-medium">닉네임</label>
                <Input 
                  placeholder="닉네임을 입력하세요" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">이메일</label>
              <Input 
                type="email" 
                placeholder="email@example.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">비밀번호</label>
              <Input 
                type="password" 
                placeholder="비밀번호를 입력하세요" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "처리 중..." : (isLogin ? "로그인" : "회원가입")}
            </Button>
          </form>
          
          <div className="text-center text-sm">
            <button 
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
            >
              {isLogin ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
            </button>
          </div>

          <Separator />
          
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={() => signIn("google", { callbackUrl: "/dashboard?sync=auto" })}
          >
            Google 계정으로 계속하기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
