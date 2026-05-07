import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshUpstreamAccount } from "@/lib/sync";

export const runtime = "nodejs";

export async function GET() {
  await ensureScheduler();
  const accounts = await prisma.upstreamAccount.findMany({
    include: {
      _count: { select: { keys: true } },
      keys: { select: { todayActualCost: true } },
    },
  });
  // Sort by today's total spend desc (sum of all keys' todayActualCost),
  // ties broken by id ascending so order is stable.
  const items = accounts
    .map((a) => {
      const todayCost = a.keys.reduce(
        (s, k) => s + (k.todayActualCost ?? 0),
        0,
      );
      const { keys: _keys, ...rest } = a;
      return { ...rest, todayCost };
    })
    .sort((a, b) => b.todayCost - a.todayCost || a.id - b.id);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    type: string;
    baseUrl: string;
    email: string;
    password: string;
    accessToken: string;
  }>;
  const {
    name,
    type = "sub2api",
    baseUrl,
    email = "",
    password = "",
    accessToken,
  } = body;
  if (!name || !baseUrl) {
    return NextResponse.json(
      { error: "name 和 baseUrl 必填" },
      { status: 400 },
    );
  }
  // 需要 accessToken（手动粘贴）或 email+password（登录换取）任一组合。
  if (!accessToken && (!email || !password)) {
    return NextResponse.json(
      { error: "需要 accessToken，或同时提供 email + password" },
      { status: 400 },
    );
  }
  const created = await prisma.upstreamAccount.create({
    data: {
      name,
      type,
      baseUrl,
      email,
      password,
      accessToken: accessToken || null,
    },
  });
  // fire-and-forget: pull structure once so the user can bind right away
  refreshUpstreamAccount(created.id).catch((e) => {
    console.error("[upstream create] initial refresh failed:", e);
  });
  return NextResponse.json({ item: created });
}
