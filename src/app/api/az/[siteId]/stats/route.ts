import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";
import { prisma } from "@/lib/db";
import { readConfig } from "@/lib/az";

export const runtime = "nodejs";
export const maxDuration = 300;

// Returns YYYY-MM-DD in Asia/Shanghai for the given offset (today = 0).
function shanghaiDateOffset(daysAgo: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// GET /api/az/[siteId]/stats?days=30
// Per-account 成本/实际消费/利润 over the last N days.
// Calls /admin/usage/stats with date range, in parallel (limit 10).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const url = new URL(req.url);
  const days = Math.min(
    365,
    Math.max(1, Number(url.searchParams.get("days")) || 30),
  );
  const endDate = shanghaiDateOffset(0);
  const startDate = shanghaiDateOffset(days - 1);

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);
  const re = new RegExp(
    `^${cfg.account_prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`,
  );

  const client = await makeSiteClient(id);
  const list = await client.listAdminAccountsFiltered({
    search: cfg.account_prefix,
    page_size: 1000,
  });
  const targets = list.items.filter((a) => re.test(a.name));

  // Per-account flat fee from local DB. Used INSTEAD of the synced total_cost
  // for az channels (they're flat-fee, not per-token billed).
  const localBound = await prisma.siteBoundAccount.findMany({
    where: {
      siteAccountId: id,
      remoteAccountId: { in: targets.map((a) => a.id) },
    },
    select: { remoteAccountId: true, fixedCost: true },
  });
  const fixedCostByRemote = new Map(
    localBound.map((b) => [b.remoteAccountId, b.fixedCost]),
  );

  type StatRow = {
    id: number;
    name: string;
    status: string;
    last_used_at: string | null | undefined;
    cost: number; // 成本：fixedCost 优先；fall back to synced 1× base
    costBase: number; // synced total_cost (1× base) — display only when fixedCost is set
    actualCost: number; // total_actual_cost — 实际消费 (revenue-side)
    profit: number; // actualCost - cost
    requests: number;
    tokens: number;
    fixedCost: number | null; // null = no flat fee, used synced 1× as cost
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  };

  const rows = await runWithLimit<typeof targets[number], StatRow>(
    targets,
    10,
    async (a) => {
      const fixed = fixedCostByRemote.get(a.id) ?? null;
      try {
        const s = await client.getAdminAccountUsageStats(
          a.id,
          startDate,
          endDate,
        );
        const costBase = s.total_cost ?? 0;
        const cost = fixed ?? costBase;
        const actualCost = s.total_actual_cost ?? 0;
        return {
          id: a.id,
          name: a.name,
          status: a.status ?? "unknown",
          last_used_at: a.last_used_at,
          cost,
          costBase,
          actualCost,
          profit: actualCost - cost,
          requests: s.total_requests ?? 0,
          tokens: s.total_tokens ?? 0,
          fixedCost: fixed,
        };
      } catch (e) {
        return {
          id: a.id,
          name: a.name,
          status: a.status ?? "unknown",
          last_used_at: a.last_used_at,
          cost: fixed ?? 0,
          costBase: 0,
          actualCost: 0,
          profit: -(fixed ?? 0),
          requests: 0,
          tokens: 0,
          fixedCost: fixed,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        };
      }
    },
  );

  // Sort by actualCost desc (revenue side — biggest earners first)
  rows.sort((a, b) => b.actualCost - a.actualCost);

  const summary = rows.reduce(
    (acc, r) => {
      acc.cost += r.cost;
      acc.costBase += r.costBase;
      acc.actualCost += r.actualCost;
      acc.profit += r.profit;
      acc.tokens += r.tokens;
      acc.requests += r.requests;
      if (r.status === "error") acc.errorCount++;
      return acc;
    },
    {
      cost: 0,
      costBase: 0,
      actualCost: 0,
      profit: 0,
      tokens: 0,
      requests: 0,
      errorCount: 0,
    },
  );

  return NextResponse.json({
    days,
    startDate,
    endDate,
    total: rows.length,
    ...summary,
    rows,
  });
}
