import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const items = await prisma.siteBoundAccount.findMany({
    where: { siteAccountId: Number(id) },
    orderBy: { id: "asc" },
    include: { bindings: { include: { upstreamKey: true } } },
  });
  // serialize bigints
  const safe = items.map((a) => ({
    ...a,
    todayTokens: a.todayTokens.toString(),
  }));
  return NextResponse.json({ items: safe });
}
