import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.binding.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    maxConcurrency: number | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.maxConcurrency !== undefined) {
    data.maxConcurrency =
      body.maxConcurrency == null
        ? null
        : Math.max(0, Math.floor(Number(body.maxConcurrency))) || null;
  }
  const item = await prisma.binding.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
