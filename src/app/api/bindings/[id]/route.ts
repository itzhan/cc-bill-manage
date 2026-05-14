import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// DELETE = 软删除 (设 endedAt = 现在). 历史数据查询仍能看到这条 binding,
// 只是"今天"开始不再生效。?hard=1 才真删 (一般别用)。
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  if (hard) {
    await prisma.binding.delete({ where: { id: Number(id) } });
  } else {
    await prisma.binding.update({
      where: { id: Number(id) },
      data: { endedAt: new Date() },
    });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    maxConcurrency: number | null;
    createdAt: string | null;
    endedAt: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.maxConcurrency !== undefined) {
    data.maxConcurrency =
      body.maxConcurrency == null
        ? null
        : Math.max(0, Math.floor(Number(body.maxConcurrency))) || null;
  }
  if (body.createdAt !== undefined) {
    if (body.createdAt == null) {
      // 不允许 createdAt 为 null（DB 字段是 required）
    } else {
      const d = new Date(body.createdAt);
      if (!isNaN(d.getTime())) data.createdAt = d;
    }
  }
  if (body.endedAt !== undefined) {
    if (body.endedAt == null) {
      data.endedAt = null;
    } else {
      const d = new Date(body.endedAt);
      if (!isNaN(d.getTime())) data.endedAt = d;
    }
  }
  const item = await prisma.binding.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
