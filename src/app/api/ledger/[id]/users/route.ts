import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const USER_SELECT = {
  id: true, remoteUserId: true, email: true, username: true, alias: true, siteAccountId: true,
} as const;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const links = await prisma.ledgerSiteUserLink.findMany({
    where: { ledgerId: Number(id) },
    include: { siteUser: { select: USER_SELECT } },
  });
  return NextResponse.json(links);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledgerId = Number(id);
  const { siteUserIds } = (await req.json()) as { siteUserIds: number[] };

  await prisma.ledgerSiteUserLink.deleteMany({ where: { ledgerId } });
  if (siteUserIds.length) {
    await prisma.ledgerSiteUserLink.createMany({
      data: siteUserIds.map((siteUserId) => ({ ledgerId, siteUserId })),
    });
  }

  const links = await prisma.ledgerSiteUserLink.findMany({
    where: { ledgerId },
    include: { siteUser: { select: USER_SELECT } },
  });
  return NextResponse.json(links);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledgerId = Number(id);
  const { siteUserId, multiplier } = (await req.json()) as {
    siteUserId: number;
    multiplier: number;
  };
  if (!siteUserId || multiplier == null) {
    return NextResponse.json({ error: "siteUserId and multiplier required" }, { status: 400 });
  }
  const link = await prisma.ledgerSiteUserLink.updateMany({
    where: { ledgerId, siteUserId },
    data: { multiplier },
  });
  if (link.count === 0) {
    return NextResponse.json({ error: "link not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
