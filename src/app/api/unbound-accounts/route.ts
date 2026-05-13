import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 列出所有"未绑定 upstream key" 的 site 账号 + 它们近 N 天的使用情况。
// 数据源：DailyProfitBreakdown（已经持续在写）。按收入降序，方便用户从最
// 大头开始去补绑定。
//
// Query: ?days=30 (默认 30，最大 365)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(365, Number(url.searchParams.get("days")) || 30),
  );

  // 起始日期 = 今天 (Asia/Shanghai) 往前 days-1 天
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const cutoff = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - (days - 1) * 86400_000));

  const unbound = await prisma.siteBoundAccount.findMany({
    where: { bindings: { none: {} } },
    include: { siteAccount: true },
  });

  if (unbound.length === 0) {
    return NextResponse.json({ days, items: [], totalRevenue: 0 });
  }

  const breakdowns = await prisma.dailyProfitBreakdown.findMany({
    where: {
      kind: "site",
      refId: { in: unbound.map((u) => u.id) },
      date: { gte: cutoff, lte: today },
    },
    select: { refId: true, cost: true, actualCost: true },
  });

  const agg = new Map<number, { revenue: number; costBase: number }>();
  for (const b of breakdowns) {
    const m = agg.get(b.refId) ?? { revenue: 0, costBase: 0 };
    m.revenue += b.actualCost;
    m.costBase += b.cost;
    agg.set(b.refId, m);
  }

  const items = unbound
    .map((u) => {
      const m = agg.get(u.id) ?? { revenue: 0, costBase: 0 };
      // 利润估算：对设了 fixedCost (AZ 一次性投入) 的账号，profit = revenue - fixedCost；
      // 其他账号没 upstream 绑定 → 我们没法算支出，profit 暂等于 revenue（实际不准，
      // 要 binding 后才能算真正的支出）。
      const expense = u.fixedCost ?? 0;
      return {
        id: u.id,
        siteAccountId: u.siteAccountId,
        siteAccountName: u.siteAccount.name,
        accountName: u.name,
        rateMultiplier: u.rateMultiplier ?? 1,
        fixedCost: u.fixedCost,
        revenue: m.revenue,
        costBase: m.costBase,
        profit: m.revenue - expense,
        hasFixedCost: u.fixedCost != null,
      };
    })
    .filter((x) => x.revenue > 0 || x.costBase > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = items.reduce((s, x) => s + x.revenue, 0);
  const totalCostBase = items.reduce((s, x) => s + x.costBase, 0);
  const totalProfit = items.reduce((s, x) => s + x.profit, 0);

  return NextResponse.json({
    days,
    totalRevenue,
    totalCostBase,
    totalProfit,
    items,
  });
}
