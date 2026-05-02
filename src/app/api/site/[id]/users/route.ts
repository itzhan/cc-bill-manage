import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await prisma.siteUser.findMany({
    where: { siteAccountId: Number(id) },
    orderBy: { remoteUserId: "asc" },
    include: {
      settlements: { select: { amount: true } },
    },
  });
  const items = rows.map((u) => {
    const settledTotal = u.settlements.reduce((s, p) => s + p.amount, 0);
    const settlementCount = u.settlements.length;
    const { settlements: _omit, ...rest } = u;
    void _omit;
    return { ...rest, settledTotal, settlementCount };
  });
  return NextResponse.json({ items });
}
