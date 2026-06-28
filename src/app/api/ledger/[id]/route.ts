import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledger = await prisma.ledger.findUnique({
    where: { id: Number(id) },
    include: {
      upstreamLinks: { include: { upstreamAccount: { select: { id: true, name: true } } } },
      siteLinks: { include: { siteAccount: { select: { id: true, name: true } } } },
      keyLinks: { include: { upstreamKey: { select: { id: true, name: true, groupName: true, upstreamAccountId: true, upstreamAccount: { select: { name: true } } } } } },
      userLinks: { include: { siteUser: { select: { id: true, remoteUserId: true, email: true, username: true, alias: true, siteAccountId: true } } } },
      categories: { include: { fixedCosts: true } },
      fixedCosts: { include: { category: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!ledger) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(ledger);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { name, upstreamAccountIds, siteAccountIds, revenueMultiplier } = body as {
    name?: string;
    upstreamAccountIds?: number[];
    siteAccountIds?: number[];
    revenueMultiplier?: number;
  };
  const ledgerId = Number(id);

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (revenueMultiplier !== undefined) data.revenueMultiplier = revenueMultiplier;

  if (upstreamAccountIds !== undefined) {
    await prisma.ledgerUpstreamLink.deleteMany({ where: { ledgerId } });
    if (upstreamAccountIds.length) {
      await prisma.ledgerUpstreamLink.createMany({
        data: upstreamAccountIds.map((uid) => ({ ledgerId, upstreamAccountId: uid })),
      });
    }
  }
  if (siteAccountIds !== undefined) {
    await prisma.ledgerSiteLink.deleteMany({ where: { ledgerId } });
    if (siteAccountIds.length) {
      await prisma.ledgerSiteLink.createMany({
        data: siteAccountIds.map((sid) => ({ ledgerId, siteAccountId: sid })),
      });
    }
  }

  const ledger = await prisma.ledger.update({
    where: { id: ledgerId },
    data,
    include: {
      upstreamLinks: { include: { upstreamAccount: { select: { id: true, name: true } } } },
      siteLinks: { include: { siteAccount: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json(ledger);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await prisma.ledger.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
