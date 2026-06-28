import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cats = await prisma.ledgerCategory.findMany({
    where: { ledgerId: Number(id) },
    include: { _count: { select: { fixedCosts: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(cats);
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { name } = (await req.json()) as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const cat = await prisma.ledgerCategory.create({
    data: { ledgerId: Number(id), name: name.trim() },
  });
  return NextResponse.json(cat, { status: 201 });
}
