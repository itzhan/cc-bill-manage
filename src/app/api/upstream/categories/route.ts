import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 用户自定义的渠道分类管理 — 决定 /upstream 页 Tab 列表。
// 创建一个分类后, 编辑渠道时就能勾它。
export async function GET() {
  const items = await prisma.upstreamCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    sortOrder: number;
  }>;
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }
  try {
    const item = await prisma.upstreamCategory.create({
      data: { name, sortOrder: body.sortOrder ?? 0 },
    });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
