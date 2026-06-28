import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const costs = await prisma.ledgerFixedCost.findMany({
    where: { ledgerId: Number(id) },
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(costs);
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { categoryId, amount, note } = body as {
    categoryId: number;
    amount: number;
    note?: string;
  };
  if (!categoryId || amount == null) {
    return NextResponse.json({ error: "categoryId and amount required" }, { status: 400 });
  }
  const cost = await prisma.ledgerFixedCost.create({
    data: {
      ledgerId: Number(id),
      categoryId,
      amount,
      note: note || null,
    },
    include: { category: true },
  });
  return NextResponse.json(cost, { status: 201 });
}
