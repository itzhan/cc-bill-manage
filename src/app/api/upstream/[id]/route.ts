import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const item = await prisma.upstreamAccount.findUnique({
    where: { id: numId },
    include: { keys: { orderBy: { id: "asc" } } },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    category: string;
    categories: string[];
    supplier: string | null;
    baseUrl: string;
    email: string;
    password: string;
    accessToken: string | null;
    notes: string | null;
    inventory: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = body.name;
  if (body.category != null) data.category = body.category;
  if (Array.isArray(body.categories)) {
    const cats = body.categories.map((s) => s.trim()).filter(Boolean);
    data.categories = JSON.stringify(cats);
    // 同步老的单字段 category, 保持兼容; 用主分类(第一个)。
    if (cats.length > 0) data.category = cats[0];
  }
  if (body.supplier !== undefined) {
    // 显式传 supplier (含 null / 空串) → 写入; 空字符串归一为 null = 无分组
    const v = typeof body.supplier === "string" ? body.supplier.trim() : null;
    data.supplier = v || null;
  }
  if (body.baseUrl != null) data.baseUrl = body.baseUrl;
  if (body.email != null) data.email = body.email;
  if (body.password != null) {
    data.password = body.password;
    // password changed -> invalidate token
    data.accessToken = null;
    data.tokenExpiresAt = null;
  }
  if (body.accessToken !== undefined) {
    // 手动粘贴的 token：清掉过期时间，让 401 触发自然重试。
    data.accessToken = body.accessToken || null;
    data.tokenExpiresAt = null;
  }
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.inventory !== undefined) data.inventory = body.inventory;
  const item = await prisma.upstreamAccount.update({
    where: { id: numId },
    data,
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  await prisma.upstreamAccount.delete({ where: { id: numId } });
  return NextResponse.json({ ok: true });
}
