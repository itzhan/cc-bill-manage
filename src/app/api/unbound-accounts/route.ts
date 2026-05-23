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

  const [unbound, settings, rules] = await Promise.all([
    prisma.siteBoundAccount.findMany({
      where: { bindings: { none: {} } },
      include: { siteAccount: true },
    }),
    prisma.settings.findUnique({
      where: { id: 1 },
      select: { unboundExcludePrefixes: true },
    }),
    prisma.expenseRule.findMany(),
  ]);

  // 解析排除前缀（按行/逗号分隔，跳过空白和 # 注释）。
  const excludePrefixes = (settings?.unboundExcludePrefixes ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const isExcluded = (name: string) =>
    excludePrefixes.some((p) =>
      name.toLowerCase().startsWith(p.toLowerCase()),
    );

  const filteredUnbound = unbound.filter((u) => !isExcluded(u.name));

  if (filteredUnbound.length === 0) {
    return NextResponse.json({
      days,
      items: [],
      totalRevenue: 0,
      totalCostBase: 0,
      totalProfit: 0,
      excludePrefixes,
    });
  }

  // 两批 breakdowns:
  //   recent — 用于 N 天收入 / 1× 成本 (维持原口径)
  //   all    — 用于"累计支出"和"最近使用"全历史汇总
  const ids = filteredUnbound.map((u) => u.id);
  const [recent, allTime] = await Promise.all([
    prisma.dailyProfitBreakdown.findMany({
      where: {
        kind: "site",
        refId: { in: ids },
        date: { gte: cutoff, lte: today },
      },
      select: { refId: true, cost: true, actualCost: true },
    }),
    prisma.dailyProfitBreakdown.findMany({
      where: { kind: "site", refId: { in: ids } },
      select: {
        refId: true,
        date: true,
        cost: true,
        actualCost: true,
        manualCost: true,
        manualExpense: true,
      },
    }),
  ]);

  const recentAgg = new Map<number, { revenue: number; costBase: number }>();
  for (const b of recent) {
    const m = recentAgg.get(b.refId) ?? { revenue: 0, costBase: 0 };
    m.revenue += b.actualCost;
    m.costBase += b.cost;
    recentAgg.set(b.refId, m);
  }

  // 找到 name 匹配的 ExpenseRule (前缀大小写不敏感; 后缀同理), 优先级跟
  // history.ts 的 paired 视图保持一致: 取第一条命中的规则。
  function matchRule(name: string) {
    const n = name.toLowerCase();
    for (const r of rules) {
      const p = (r.prefix ?? "").toLowerCase();
      const sf = (r.suffix ?? "").toLowerCase();
      if ((p && n.startsWith(p)) || (sf && n.endsWith(sf))) return r;
    }
    return null;
  }

  // 按 refId 分桶 allTime,逐天按优先级 (manualExpense > fixedCost > 规则 >
  // site 1×) 计算支出再相加; 同时记最大活动日期。
  type AllRow = (typeof allTime)[number];
  const byRef = new Map<number, AllRow[]>();
  for (const r of allTime) {
    const arr = byRef.get(r.refId) ?? [];
    arr.push(r);
    byRef.set(r.refId, arr);
  }

  const items = filteredUnbound
    .map((u) => {
      const m = recentAgg.get(u.id) ?? { revenue: 0, costBase: 0 };
      const rows = byRef.get(u.id) ?? [];
      const rule = matchRule(u.name);
      let accumExpense = 0;
      let lastUsedDate: string | null = null;
      for (const r of rows) {
        const oneTimes = r.manualCost ?? r.cost;
        // 计算当日有效支出
        let dayExp: number;
        if (r.manualExpense != null) {
          dayExp = r.manualExpense;
        } else if (u.fixedCost != null) {
          dayExp = u.fixedCost;
        } else if (rule) {
          dayExp = rule.fixedCost;
        } else {
          dayExp = oneTimes > 0 ? oneTimes : 0;
        }
        accumExpense += dayExp;
        if (oneTimes > 0 || r.actualCost > 0) {
          if (lastUsedDate == null || r.date > lastUsedDate) {
            lastUsedDate = r.date;
          }
        }
      }
      const expenseForProfit = u.fixedCost ?? 0;
      return {
        id: u.id,
        siteAccountId: u.siteAccountId,
        siteAccountName: u.siteAccount.name,
        accountName: u.name,
        rateMultiplier: u.rateMultiplier ?? 1,
        fixedCost: u.fixedCost,
        revenue: m.revenue,
        costBase: m.costBase,
        profit: m.revenue - expenseForProfit,
        hasFixedCost: u.fixedCost != null,
        accumExpense,
        lastUsedDate,
      };
    })
    .filter((x) => x.revenue > 0 || x.costBase > 0 || x.accumExpense > 0)
    // 默认按最近使用日期倒序; null 排到最末。前端可再选其他排序方式。
    .sort((a, b) => {
      if (a.lastUsedDate == null && b.lastUsedDate == null) return 0;
      if (a.lastUsedDate == null) return 1;
      if (b.lastUsedDate == null) return -1;
      return a.lastUsedDate > b.lastUsedDate ? -1 : a.lastUsedDate < b.lastUsedDate ? 1 : 0;
    });

  const totalRevenue = items.reduce((s, x) => s + x.revenue, 0);
  const totalCostBase = items.reduce((s, x) => s + x.costBase, 0);
  const totalProfit = items.reduce((s, x) => s + x.profit, 0);

  return NextResponse.json({
    days,
    totalRevenue,
    totalCostBase,
    totalProfit,
    items,
    excludePrefixes,
  });
}
