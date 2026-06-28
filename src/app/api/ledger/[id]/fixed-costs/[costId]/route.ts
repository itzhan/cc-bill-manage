import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; costId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { costId } = await ctx.params;
  const body = await req.json();
  const { categoryId, amount, note, startDate, endDate } = body as {
    categoryId?: number;
    amount?: number;
    note?: string;
    startDate?: string | null;
    endDate?: string | null;
  };
  const data: Record<string, unknown> = {};
  if (categoryId !== undefined) data.categoryId = categoryId;
  if (amount !== undefined) data.amount = amount;
  if (note !== undefined) data.note = note || null;
  if (startDate !== undefined) data.startDate = startDate || null;
  if (endDate !== undefined) data.endDate = endDate || null;

  const cost = await prisma.ledgerFixedCost.update({
    where: { id: Number(costId) },
    data,
    include: { category: true },
  });
  return NextResponse.json(cost);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { costId } = await ctx.params;
  await prisma.ledgerFixedCost.delete({ where: { id: Number(costId) } });
  return NextResponse.json({ ok: true });
}
