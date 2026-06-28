import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const KEY_SELECT = {
  id: true, name: true, keyMasked: true, groupName: true, upstreamAccountId: true,
  upstreamAccount: { select: { name: true } },
} as const;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const links = await prisma.ledgerUpstreamKeyLink.findMany({
    where: { ledgerId: Number(id) },
    include: { upstreamKey: { select: KEY_SELECT } },
  });
  return NextResponse.json(links);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledgerId = Number(id);
  const { upstreamKeyIds } = (await req.json()) as { upstreamKeyIds: number[] };

  await prisma.ledgerUpstreamKeyLink.deleteMany({ where: { ledgerId } });
  if (upstreamKeyIds.length) {
    await prisma.ledgerUpstreamKeyLink.createMany({
      data: upstreamKeyIds.map((upstreamKeyId) => ({ ledgerId, upstreamKeyId })),
    });
  }

  const links = await prisma.ledgerUpstreamKeyLink.findMany({
    where: { ledgerId },
    include: { upstreamKey: { select: KEY_SELECT } },
  });
  return NextResponse.json(links);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledgerId = Number(id);
  const { upstreamKeyId, multiplier } = (await req.json()) as {
    upstreamKeyId: number;
    multiplier: number;
  };
  if (!upstreamKeyId || multiplier == null) {
    return NextResponse.json({ error: "upstreamKeyId and multiplier required" }, { status: 400 });
  }
  const link = await prisma.ledgerUpstreamKeyLink.updateMany({
    where: { ledgerId, upstreamKeyId },
    data: { multiplier },
  });
  if (link.count === 0) {
    return NextResponse.json({ error: "link not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
