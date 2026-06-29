import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

function shanghaiDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const ledgerId = Number(id);

  const ledger = await prisma.ledger.findUnique({
    where: { id: ledgerId },
    include: {
      siteLinks: true,
      fixedCosts: { include: { category: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!ledger) return NextResponse.json({ error: "not found" }, { status: 404 });

  const today = shanghaiDateString();

  // ── 今日成本：仅计算已关联的 key ──
  let todayCost = 0;
  const upstreamKeys: {
    keyId: number; name: string; todayActualCost: number;
    multiplier: number; cost: number; accountName: string;
    lastSyncAt: string | null;
  }[] = [];

  const keyLinks = await prisma.ledgerUpstreamKeyLink.findMany({
    where: { ledgerId },
    include: {
      upstreamKey: { include: { upstreamAccount: { select: { name: true } } } },
    },
  });

  for (const link of keyLinks) {
    const k = link.upstreamKey;
    const raw = k.todayActualCost;
    const cost = raw * link.multiplier;
    todayCost += cost;
    upstreamKeys.push({
      keyId: k.id,
      name: k.name,
      todayActualCost: raw,
      multiplier: link.multiplier,
      cost,
      accountName: k.upstreamAccount.name,
      lastSyncAt: k.lastUpdatedAt?.toISOString() ?? null,
    });
  }
  upstreamKeys.sort((a, b) => b.cost - a.cost);

  // ── 收入：仅计算已关联的用户 ──
  let todayRevenue = 0;
  let totalUserRevenue = 0;
  const siteUsers: {
    userId: number;
    siteUserId: number;
    email: string;
    username: string;
    alias: string | null;
    todayCost: number;
    totalConsumed: number;
    totalRevenue: number;
    multiplier: number;
    revenue: number;
    accountName: string;
    lastSyncAt: string | null;
  }[] = [];

  const userLinks = await prisma.ledgerSiteUserLink.findMany({
    where: { ledgerId },
    include: {
      siteUser: { include: { siteAccount: { select: { name: true } } } },
    },
  });

  for (const link of userLinks) {
    const u = link.siteUser;
    const todayCost = u.todayActualCost;
    const todayRev = todayCost * link.multiplier;
    const totalConsumed = Math.max(0, u.totalRecharged - u.balance);
    const totalRev = totalConsumed * link.multiplier;
    todayRevenue += todayRev;
    totalUserRevenue += totalRev;
    siteUsers.push({
      userId: u.remoteUserId,
      siteUserId: u.id,
      email: u.email,
      username: u.username,
      alias: u.alias,
      todayCost,
      totalConsumed,
      totalRevenue: totalRev,
      multiplier: link.multiplier,
      revenue: todayRev,
      accountName: u.siteAccount.name,
      lastSyncAt: u.todayStatsAt?.toISOString() ?? null,
    });
  }
  siteUsers.sort((a, b) => b.totalRevenue - a.totalRevenue);

  // ── 自建成本（项目总额） ──
  let totalFixedCost = 0;
  const fixedCostDetails: {
    id: number;
    category: string;
    amount: number;
    note: string | null;
    createdAt: string;
  }[] = [];

  for (const fc of ledger.fixedCosts) {
    totalFixedCost += fc.amount;
    fixedCostDetails.push({
      id: fc.id,
      category: fc.category.name,
      amount: fc.amount,
      note: fc.note,
      createdAt: fc.createdAt.toISOString(),
    });
  }

  // ── 自定义收入（项目总额） ──
  const fixedIncomes = await prisma.ledgerFixedIncome.findMany({
    where: { ledgerId },
    orderBy: { createdAt: "desc" },
  });
  let totalFixedIncome = 0;
  const fixedIncomeDetails: {
    id: number;
    amount: number;
    note: string | null;
    createdAt: string;
  }[] = [];

  for (const fi of fixedIncomes) {
    totalFixedIncome += fi.amount;
    fixedIncomeDetails.push({
      id: fi.id,
      amount: fi.amount,
      note: fi.note,
      createdAt: fi.createdAt.toISOString(),
    });
  }

  // ── 历史每日数据 ──
  const days = Number(req.nextUrl.searchParams.get("days")) || 9999;
  const dailyData: { date: string; cost: number }[] = [];

  const linkedKeyIds = keyLinks.map((l) => l.upstreamKeyId);

  if (linkedKeyIds.length) {
    {
      const breakdowns = await prisma.dailyProfitBreakdown.findMany({
        where: { kind: "upstream", refId: { in: linkedKeyIds } },
        orderBy: { date: "desc" },
      });

      const byDate = new Map<string, number>();
      const keyIdSet = new Set(linkedKeyIds);

      for (const b of breakdowns) {
        if (!keyIdSet.has(b.refId)) continue;
        const val = b.manualActualCost ?? b.actualCost;
        byDate.set(b.date, (byDate.get(b.date) ?? 0) + val);
      }

      const sortedDates = [...byDate.keys()].sort().reverse().slice(0, days);
      for (const date of sortedDates) {
        dailyData.push({ date, cost: byDate.get(date)! });
      }
    }
  }

  const totalUpstreamCost = dailyData.reduce((s, d) => s + d.cost, 0);
  const totalCost = totalUpstreamCost + totalFixedCost;
  const totalRevenue = totalUserRevenue + totalFixedIncome;
  const todayProfit = todayRevenue - todayCost;

  return NextResponse.json({
    today: { date: today, cost: todayCost, revenue: todayRevenue, profit: todayProfit },
    total: { cost: totalCost, revenue: totalRevenue, profit: totalRevenue - totalCost, fixedCost: totalFixedCost, fixedIncome: totalFixedIncome },
    upstreamKeys,
    siteUsers,
    fixedCostDetails,
    fixedIncomeDetails,
    dailyData: dailyData.slice(0, 30),
  });
}
