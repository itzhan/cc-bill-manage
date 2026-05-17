import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshUpstreamAccount } from "@/lib/sync";
import { freshTodayActualCost } from "@/lib/freshness";

export const runtime = "nodejs";

function parseCategories(jsonOrNull: string | null, legacy: string): string[] {
  if (!jsonOrNull) return legacy ? [legacy] : [];
  try {
    const v = JSON.parse(jsonOrNull);
    return Array.isArray(v) ? (v as string[]).filter(Boolean) : [];
  } catch {
    return legacy ? [legacy] : [];
  }
}

export async function GET(req: Request) {
  await ensureScheduler();
  const url = new URL(req.url);
  // ?category=claude — 过滤含此分类的渠道; "" / 缺省 = 全部
  const category = (url.searchParams.get("category") ?? "").trim();
  const accounts = await prisma.upstreamAccount.findMany({
    include: {
      _count: { select: { keys: true } },
      keys: {
        select: { todayActualCost: true, lastUpdatedAt: true },
      },
    },
  });
  const items = accounts
    .map((a) => {
      const todayCost = a.keys.reduce((s, k) => s + freshTodayActualCost(k), 0);
      const { keys: _keys, categories, ...rest } = a;
      const cats = parseCategories(categories, a.category);
      return { ...rest, categories: cats, todayCost };
    })
    // 过滤: 同时兼容老 category 字段 (cats 来源就是 categories ?? [category])
    .filter((a) => (category ? a.categories.includes(category) : true))
    .sort((a, b) => b.todayCost - a.todayCost || a.id - b.id);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    type: string;
    category: string;
    categories: string[];
    supplier: string | null;
    baseUrl: string;
    email: string;
    password: string;
    accessToken: string;
    notes: string | null;
    inventory: string | null;
  }>;
  const {
    name,
    type = "sub2api",
    supplier,
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
  if (!accessToken && (!email || !password)) {
    return NextResponse.json(
      { error: "需要 accessToken，或同时提供 email + password" },
      { status: 400 },
    );
  }
  // 分类: 新接口接 categories 数组优先; 没传时退回老的单字段 category。
  const cats = Array.isArray(body.categories)
    ? body.categories.map((s) => s.trim()).filter(Boolean)
    : body.category
      ? [body.category.trim()]
      : ["claude"];
  // 同步写老 category 保持兼容: 第一个 category 作为主分类
  const primaryCategory = cats[0] ?? "claude";
  const created = await prisma.upstreamAccount.create({
    data: {
      name,
      type,
      category: primaryCategory,
      categories: JSON.stringify(cats),
      supplier: supplier?.trim() ? supplier.trim() : null,
      baseUrl,
      email,
      password,
      accessToken: accessToken || null,
      notes: body.notes ?? null,
      inventory: body.inventory ?? null,
    },
  });
  refreshUpstreamAccount(created.id).catch((e) => {
    console.error("[upstream create] initial refresh failed:", e);
  });
  return NextResponse.json({ item: created });
}
