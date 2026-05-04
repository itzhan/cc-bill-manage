import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Returns all upstream keys + site bound accounts for picker dropdowns
export async function GET() {
  const [upstreamKeys, siteBound] = await Promise.all([
    prisma.upstreamKey.findMany({
      orderBy: { id: "asc" },
      include: { upstreamAccount: true },
    }),
    prisma.siteBoundAccount.findMany({
      orderBy: { id: "asc" },
      include: { siteAccount: true },
    }),
  ]);
  return NextResponse.json({
    upstreamKeys: upstreamKeys.map((k) => {
      const rateLabel = k.hasExclusiveRate
        ? `专属 ×${k.effectiveRateMultiplier}`
        : `×${k.groupRateMultiplier}`;
      return {
        id: k.id,
        label: `${k.upstreamAccount.name} / ${k.name} (${k.groupName} ${rateLabel})`,
        groupName: k.groupName,
        groupRateMultiplier: k.groupRateMultiplier,
        effectiveRateMultiplier: k.effectiveRateMultiplier,
        hasExclusiveRate: k.hasExclusiveRate,
        keyMasked: k.keyMasked,
        upstreamAccountId: k.upstreamAccountId,
        upstreamAccountName: k.upstreamAccount.name,
        todayActualCost: k.todayActualCost,
      };
    }),
    siteBoundAccounts: siteBound.map((a) => ({
      id: a.id,
      label: `${a.siteAccount.name} / ${a.name} (×${a.rateMultiplier})`,
      name: a.name,
      siteAccountId: a.siteAccountId,
      siteAccountName: a.siteAccount.name,
      rateMultiplier: a.rateMultiplier,
      todayCost: a.todayCost,
      todayUserCost: a.todayUserCost,
    })),
  });
}
