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
