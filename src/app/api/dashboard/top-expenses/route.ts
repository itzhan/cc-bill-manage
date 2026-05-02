import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const keys = await prisma.upstreamKey.findMany({
    where: { todayActualCost: { gt: 0 } },
    orderBy: { todayActualCost: "desc" },
    take: 12,
    include: { upstreamAccount: true },
  });
  return NextResponse.json({
    items: keys.map((k) => ({
      id: k.id,
      label: k.name,
      account: k.upstreamAccount.name,
      group: k.groupName,
      multiplier: k.effectiveRateMultiplier,
      isExclusive: k.hasExclusiveRate,
      cost: k.todayActualCost,
    })),
  });
}
