"use client";

import { useTransition } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton({ children }: { children?: React.ReactNode }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      variant="accent"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signIn("google", { 
            callbackUrl: "/dashboard?sync=auto",
          });
        })
      }
    >
      {pending ? "Redirecting…" : (children ?? "Google 계정으로 계속하기")}
    </Button>
  );
}
