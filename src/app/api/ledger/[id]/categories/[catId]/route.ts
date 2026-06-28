import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; catId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { catId } = await ctx.params;
  await prisma.ledgerCategory.delete({ where: { id: Number(catId) } });
  return NextResponse.json({ ok: true });
}
