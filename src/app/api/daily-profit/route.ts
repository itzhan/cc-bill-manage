import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aggregateManyFromPaired } from "@/lib/history";

export const runtime = "nodejs";
// 不缓存 — backfill 完毕后前端会立刻重拉，必须看到 DB 的最新值。
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/daily-profit?days=30  → last N days, newest first
//
// 每日利润不再单独存表 — 全部由 DailyProfitBreakdown 按 paired view 现算,
// 保证跟"每日明细"modal 顶部 totals 永远一致。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(
    365,
    Math.max(1, Number(url.searchParams.get("days")) || 30),
  );
  // 拿最近 N 个有 breakdown 数据的日期 + 当日的 updatedAt(最近一行)
  const rows = await prisma.dailyProfitBreakdown.groupBy({
    by: ["date"],
    _max: { updatedAt: true },
    orderBy: { date: "desc" },
    take: days,
  });
  const dates = rows.map((r) => r.date);
  const updatedByDate = new Map(
    rows.map((r) => [r.date, r._max.updatedAt ?? new Date()]),
  );
  const aggregated = await aggregateManyFromPaired(dates);
  const items = aggregated.map((r, i) => {
    const upd = updatedByDate.get(r.date) ?? new Date();
    return {
      id: i + 1,
      date: r.date,
      revenue: r.revenue,
      expense: r.expense,
      profit: r.profit,
      siteCostBase: r.siteCostBase,
      upstreamCostBase: r.upstreamCostBase,
      diff: r.diff,
      capturedAt: upd,
      updatedAt: upd,
    };
  });
  return NextResponse.json({ items });
}
