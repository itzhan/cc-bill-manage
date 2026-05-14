import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// 扫近 N 天 (默认 60) 的 DailyProfitBreakdown, 找出"孤立支出 + 0 支出 paired"
// 的可能配对, 输出修复清单。匹配规则:
//   1. 同一天里, 有 paired (rev>0, exp=0) 且有 orphan (无 binding, exp>0)
//   2. 两边的 groupName + effectiveRate 完全相等 → 同一分组同一倍率 = 同一逻辑渠道
//   3. 在该天的候选 orphan 唯一 (没歧义) → 建议配对
//
// 应用后会创建一条历史 binding (createdAt=epoch, endedAt=该日 23:59:59),
// 把孤立 upstream key 的支出归属给当前 paired 行那个 site 账号。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 60));

  // 取最近 N 天有 breakdown 的日期
  const dateRows = await prisma.dailyProfitBreakdown.findMany({
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "desc" },
    take: days,
  });
  const dates = dateRows.map((d) => d.date);

  const allBindings = await prisma.binding.findMany({
    select: {
      id: true,
      siteBoundAccountId: true,
      upstreamKeyId: true,
      createdAt: true,
      endedAt: true,
    },
  });

  // 当前 active = endedAt=null 的 binding, 它们追溯到所有历史日期
  // 历史 binding = endedAt 已设, 仅在 [createdAt, endedAt] 区间生效
  function activeOn(date: string): typeof allBindings {
    const dStr = date;
    return allBindings.filter((b) => {
      if (b.endedAt == null) return true;
      const ended = formatShanghai(b.endedAt);
      const created = formatShanghai(b.createdAt);
      return created <= dStr && dStr <= ended;
    });
  }

  // 也要拉 site/upstream 的元信息用来生成清单显示
  const siteAccounts = await prisma.siteBoundAccount.findMany({
    select: { id: true, name: true, siteAccount: { select: { name: true } } },
  });
  const sitesById = new Map(siteAccounts.map((s) => [s.id, s]));
  const upstreamKeys = await prisma.upstreamKey.findMany({
    select: {
      id: true,
      name: true,
      groupName: true,
      effectiveRateMultiplier: true,
      upstreamAccount: { select: { name: true } },
    },
  });
  const keysById = new Map(upstreamKeys.map((k) => [k.id, k]));

  interface Suggestion {
    date: string;
    siteBoundAccountId: number;
    siteLabel: string;
    pairedUpstreamKeyId: number;
    pairedUpstreamLabel: string;
    orphanUpstreamKeyId: number;
    orphanUpstreamLabel: string;
    groupName: string;
    effectiveRate: number;
    revenue: number;
    orphanExpense: number;
    reason: string;
  }
  const suggestions: Suggestion[] = [];
  // 用来避免同一对 (siteId, orphanKeyId) 被多日期重复推荐 — 实际上每天都可能需要
  // 一条独立的历史 binding, 但 endedAt 可以覆盖多天, 所以聚合一下

  for (const date of dates) {
    const rows = await prisma.dailyProfitBreakdown.findMany({
      where: { date },
      select: {
        kind: true,
        refId: true,
        actualCost: true,
        groupName: true,
        effectiveRate: true,
      },
    });
    const upRows = rows.filter((r) => r.kind === "upstream");
    const siteRows = rows.filter((r) => r.kind === "site");
    const siteRevenueById = new Map<number, number>();
    for (const s of siteRows) siteRevenueById.set(s.refId, s.actualCost);

    const active = activeOn(date);
    const bySiteForKey = new Map<number, number[]>();
    for (const b of active) {
      const list = bySiteForKey.get(b.upstreamKeyId) ?? [];
      list.push(b.siteBoundAccountId);
      bySiteForKey.set(b.upstreamKeyId, list);
    }
    const boundKeyIds = new Set(bySiteForKey.keys());

    // 孤立支出: upstream 行有钱但没在 active binding 里
    const orphans = upRows
      .filter((u) => !boundKeyIds.has(u.refId) && u.actualCost > 0)
      .map((u) => ({
        keyId: u.refId,
        expense: u.actualCost,
        groupName: u.groupName ?? "",
        effectiveRate: u.effectiveRate ?? 1,
      }));

    // 0 支出 paired: 在 binding 里但 upstream 那天 0 流量, site 有收入
    for (const [keyId, siteIds] of bySiteForKey.entries()) {
      const upRow = upRows.find((u) => u.refId === keyId);
      const expense = upRow?.actualCost ?? 0;
      if (expense > 0) continue; // 已有支出, 不需要修
      const revenue = siteIds.reduce(
        (s, sid) => s + (siteRevenueById.get(sid) ?? 0),
        0,
      );
      if (revenue <= 0) continue;
      const pairedKey = keysById.get(keyId);
      if (!pairedKey) continue;
      const groupName = pairedKey.groupName ?? "";
      const effectiveRate = pairedKey.effectiveRateMultiplier ?? 1;
      // 在 orphans 里找匹配
      const candidates = orphans.filter(
        (o) =>
          o.groupName === groupName &&
          Math.abs(o.effectiveRate - effectiveRate) < 0.001,
      );
      if (candidates.length !== 1) continue; // 0 或多个 — 不建议
      const cand = candidates[0];
      const orphanKey = keysById.get(cand.keyId);
      if (!orphanKey) continue;
      // 用第一个绑定的 site 账号作为归属目标 (绝大多数情况只有一个)
      const targetSiteId = siteIds[0];
      const targetSite = sitesById.get(targetSiteId);
      if (!targetSite) continue;
      suggestions.push({
        date,
        siteBoundAccountId: targetSiteId,
        siteLabel: `${targetSite.siteAccount.name} / ${targetSite.name}`,
        pairedUpstreamKeyId: keyId,
        pairedUpstreamLabel: `${pairedKey.upstreamAccount.name} / ${pairedKey.name}`,
        orphanUpstreamKeyId: cand.keyId,
        orphanUpstreamLabel: `${orphanKey.upstreamAccount.name} / ${orphanKey.name}`,
        groupName,
        effectiveRate,
        revenue,
        orphanExpense: cand.expense,
        reason: `分组 ${groupName} ×${effectiveRate} 唯一匹配`,
      });
    }
  }

  // 同一对 (siteId, orphanKeyId) 可能在多天都有 → 合并成"覆盖最远到 XXX"的一条
  const merged = new Map<
    string,
    Suggestion & {
      dates: string[];
      totalRevenue: number;
      totalOrphanExpense: number;
      latestDate: string;
    }
  >();
  for (const s of suggestions) {
    const k = `${s.siteBoundAccountId}:${s.orphanUpstreamKeyId}`;
    const cur = merged.get(k);
    if (cur) {
      cur.dates.push(s.date);
      cur.totalRevenue += s.revenue;
      cur.totalOrphanExpense += s.orphanExpense;
      if (s.date > cur.latestDate) cur.latestDate = s.date;
    } else {
      merged.set(k, {
        ...s,
        dates: [s.date],
        totalRevenue: s.revenue,
        totalOrphanExpense: s.orphanExpense,
        latestDate: s.date,
      });
    }
  }

  const items = [...merged.values()].sort(
    (a, b) => b.totalOrphanExpense - a.totalOrphanExpense,
  );

  return NextResponse.json({
    scannedDays: dates.length,
    suggestionCount: items.length,
    items,
  });
}

function formatShanghai(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
