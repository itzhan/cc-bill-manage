import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const incomes = await prisma.ledgerFixedIncome.findMany({
    where: { ledgerId: Number(id) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(incomes);
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { amount, note } = body as { amount: number; note?: string };
  if (amount == null) {
    return NextResponse.json({ error: "amount required" }, { status: 400 });
  }
  const income = await prisma.ledgerFixedIncome.create({
    data: {
      ledgerId: Number(id),
      amount,
      note: note || null,
    },
  });
  return NextResponse.json(income, { status: 201 });
}
