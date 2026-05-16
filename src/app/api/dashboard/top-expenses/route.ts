import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { freshTodayActualCost } from "@/lib/freshness";

export const runtime = "nodejs";

export async function GET() {
  // 不能直接按 todayActualCost desc 选 top12 — sync 失败的 key 上面还挂着
  // 上次成功时的旧值, 会把昨天的"大户"伪装成今天的大户。先 findMany 出
  // 候选(有 lastUpdatedAt 是今天的 + 旧值 > 0 的), 应用 fresh 守护后再
  // sort/take top12。
  const candidates = await prisma.upstreamKey.findMany({
    where: { todayActualCost: { gt: 0 } },
    include: { upstreamAccount: true },
  });
  const items = candidates
    .map((k) => ({
      id: k.id,
      label: k.name,
      account: k.upstreamAccount.name,
      group: k.groupName,
      multiplier: k.effectiveRateMultiplier,
      isExclusive: k.hasExclusiveRate,
      // stale → 0 → 自然被下面的 > 0 过滤掉, 不展示
      cost: freshTodayActualCost(k),
    }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 12);
  return NextResponse.json({ items });
}
