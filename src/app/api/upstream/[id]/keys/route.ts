import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isFreshForToday } from "@/lib/freshness";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await prisma.upstreamKey.findMany({
    where: { upstreamAccountId: Number(id) },
    orderBy: { id: "asc" },
  });
  // 给前端附 isStale 标志:UI 用 fresh 状态判定排序/过滤/badge。
  // 原值 todayActualCost / totalActualCost 仍带出, 供 audit 显示。
  const items = rows.map((k) => ({
    ...k,
    isStale: !isFreshForToday(k.lastUpdatedAt),
  }));
  return NextResponse.json({ items });
}
