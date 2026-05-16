import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshUpstreamAccount } from "@/lib/sync";
import { freshTodayActualCost } from "@/lib/freshness";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureScheduler();
  const url = new URL(req.url);
  // ?category=claude / openai / "" (空 = 全部, 兼容旧调用)
  const category = (url.searchParams.get("category") ?? "").trim();
  const where = category ? { category } : undefined;
  const accounts = await prisma.upstreamAccount.findMany({
    where,
    include: {
      _count: { select: { keys: true } },
      // 包含 lastUpdatedAt 才能做 stale 守护 — sync 失败时 todayActualCost
      // 还是上次成功的旧值, 不过守护后只有 lastUpdatedAt 是今天的才计入。
      keys: {
        select: { todayActualCost: true, lastUpdatedAt: true },
      },
    },
  });
  // Sort by today's total spend desc (stale 的 key 不计入这一行的"今日"),
  // ties broken by id ascending so order is stable.
  const items = accounts
    .map((a) => {
      const todayCost = a.keys.reduce((s, k) => s + freshTodayActualCost(k), 0);
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
    category: string;
    baseUrl: string;
    email: string;
    password: string;
    accessToken: string;
  }>;
  const {
    name,
    type = "sub2api",
    category = "claude",
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
      category,
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
