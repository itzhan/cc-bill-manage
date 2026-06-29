import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; incomeId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { incomeId } = await ctx.params;
  await prisma.ledgerFixedIncome.delete({ where: { id: Number(incomeId) } });
  return NextResponse.json({ ok: true });
}
