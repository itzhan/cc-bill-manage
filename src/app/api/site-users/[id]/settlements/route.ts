import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const items = await prisma.settlementPayment.findMany({
    where: { siteUserId: Number(id) },
    orderBy: { paidAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    amount: number;
    paidAt: string;
    notes: string;
  }>;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be > 0" },
      { status: 400 },
    );
  }
  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  const created = await prisma.settlementPayment.create({
    data: {
      siteUserId: Number(id),
      amount,
      paidAt,
      notes: body.notes || null,
    },
  });
  return NextResponse.json({ item: created });
}
