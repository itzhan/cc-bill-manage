"use client";
import { Suspense, useState } from "react";
import { Button, Card, CardBody, CardHeader, Input, addToast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!password) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast({ title: "登录失败", description: j.error || `${res.status}`, color: "danger" });
        return;
      }
      const from = search.get("from") || "/";
      router.replace(from);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex-col items-start">
          <h1 className="text-2xl font-bold">Bill Manage</h1>
          <p className="text-sm text-default-500">中转站账单管理</p>
        </CardHeader>
        <CardBody className="gap-4">
          <Input
            label="管理员密码"
            type="password"
            value={password}
            onValueChange={setPassword}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
          <Button color="primary" onPress={submit} isLoading={loading}>
            登录
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
