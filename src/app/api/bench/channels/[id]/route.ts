import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    baseUrl: string;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
    data.baseUrl = body.baseUrl.trim().replace(/\/$/, "");
  }
  if (body.notes !== undefined) data.notes = body.notes;
  const item = await prisma.benchChannel.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.benchChannel.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
