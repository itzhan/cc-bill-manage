import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.settlementPayment.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    amount: number;
    paidAt: string;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.amount != null) data.amount = Number(body.amount);
  if (body.paidAt) data.paidAt = new Date(body.paidAt);
  if ("notes" in body) data.notes = body.notes ?? null;
  const item = await prisma.settlementPayment.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
