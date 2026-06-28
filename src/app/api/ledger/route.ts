import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const ledgers = await prisma.ledger.findMany({
    include: {
      upstreamLinks: { include: { upstreamAccount: { select: { id: true, name: true } } } },
      siteLinks: { include: { siteAccount: { select: { id: true, name: true } } } },
      categories: true,
      _count: { select: { fixedCosts: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(ledgers);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, upstreamAccountIds, siteAccountIds } = body as {
    name: string;
    upstreamAccountIds?: number[];
    siteAccountIds?: number[];
  };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const ledger = await prisma.ledger.create({
    data: {
      name: name.trim(),
      upstreamLinks: upstreamAccountIds?.length
        ? { create: upstreamAccountIds.map((id) => ({ upstreamAccountId: id })) }
        : undefined,
      siteLinks: siteAccountIds?.length
        ? { create: siteAccountIds.map((id) => ({ siteAccountId: id })) }
        : undefined,
    },
    include: {
      upstreamLinks: { include: { upstreamAccount: { select: { id: true, name: true } } } },
      siteLinks: { include: { siteAccount: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json(ledger, { status: 201 });
}
