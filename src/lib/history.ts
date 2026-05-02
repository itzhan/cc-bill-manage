import { prisma } from "./db";
import { Sub2ApiClient } from "./sub2api";

interface UpstreamAccountRow {
  id: number;
  baseUrl: string;
  email: string;
  password: string;
  accessToken: string | null;
}
interface SiteAccountRow {
  id: number;
  baseUrl: string;
  email: string;
  password: string;
  accessToken: string | null;
}

function makeUpstreamClient(acc: UpstreamAccountRow) {
  return new Sub2ApiClient(
    {
      baseUrl: acc.baseUrl,
      email: acc.email,
      password: acc.password,
      accessToken: acc.accessToken,
    },
    {
      onTokenRefreshed: async (newToken, expiresInSec) => {
        await prisma.upstreamAccount.update({
          where: { id: acc.id },
          data: {
            accessToken: newToken,
            tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
          },
        });
      },
    },
  );
}

function makeSiteClient(acc: SiteAccountRow) {
  return new Sub2ApiClient(
    {
      baseUrl: acc.baseUrl,
      email: acc.email,
      password: acc.password,
      accessToken: acc.accessToken,
    },
    {
      onTokenRefreshed: async (newToken, expiresInSec) => {
        await prisma.siteAccount.update({
          where: { id: acc.id },
          data: {
            accessToken: newToken,
            tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
          },
        });
      },
    },
  );
}

function eachDayInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00+08:00");
  const e = new Date(end + "T00:00:00+08:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export interface BackfillRow {
  date: string;
  revenue: number;
  expense: number;
  profit: number;
  siteCostBase: number;
  upstreamCostBase: number;
  diff: number;
}

export interface BackfillResult {
  rows: BackfillRow[];
  totals: {
    revenue: number;
    expense: number;
    profit: number;
    siteCostBase: number;
    upstreamCostBase: number;
    diff: number;
    days: number;
  };
  errors: { date: string; kind: "site" | "upstream"; id: number; error: string }[];
}

// Pull historical day-by-day usage from upstream + site for every binding,
// aggregate into per-day totals, and upsert DailyProfit rows.
// All API calls (days × bindings × 2 sides) run in parallel.
export async function backfillRange(
  start: string,
  end: string,
): Promise<BackfillResult> {
  const dates = eachDayInRange(start, end);
  if (dates.length === 0) {
    throw new Error("invalid date range");
  }

  // Load every binding with its upstream key and site bound account, plus
  // their parent accounts so we can build clients.
  const bindings = await prisma.binding.findMany({
    include: {
      upstreamKey: { include: { upstreamAccount: true } },
      siteBoundAccount: { include: { siteAccount: true } },
    },
  });
  if (bindings.length === 0) {
    return {
      rows: [],
      totals: {
        revenue: 0,
        expense: 0,
        profit: 0,
        siteCostBase: 0,
        upstreamCostBase: 0,
        diff: 0,
        days: dates.length,
      },
      errors: [],
    };
  }

  // Dedupe upstream keys and site accounts (M:N → many bindings may reference same key).
  const upKeyMap = new Map<
    number,
    { remoteKeyId: number; account: UpstreamAccountRow }
  >();
  const siteAccMap = new Map<
    number,
    { remoteAccountId: number; account: SiteAccountRow }
  >();
  for (const b of bindings) {
    upKeyMap.set(b.upstreamKey.id, {
      remoteKeyId: b.upstreamKey.remoteKeyId,
      account: b.upstreamKey.upstreamAccount,
    });
    siteAccMap.set(b.siteBoundAccount.id, {
      remoteAccountId: b.siteBoundAccount.remoteAccountId,
      account: b.siteBoundAccount.siteAccount,
    });
  }

  // Reuse one client per parent account to share tokens / connection.
  const upstreamClients = new Map<number, Sub2ApiClient>();
  const siteClients = new Map<number, Sub2ApiClient>();
  function clientForUp(acc: UpstreamAccountRow): Sub2ApiClient {
    let c = upstreamClients.get(acc.id);
    if (!c) {
      c = makeUpstreamClient(acc);
      upstreamClients.set(acc.id, c);
    }
    return c;
  }
  function clientForSite(acc: SiteAccountRow): Sub2ApiClient {
    let c = siteClients.get(acc.id);
    if (!c) {
      c = makeSiteClient(acc);
      siteClients.set(acc.id, c);
    }
    return c;
  }

  type SiteResult = {
    kind: "site";
    date: string;
    cost: number; // 1×
    actualCost: number; // × site rate
    id: number;
  };
  type UpResult = {
    kind: "upstream";
    date: string;
    cost: number;
    actualCost: number;
    id: number;
  };
  type FetchResult = SiteResult | UpResult;

  const errors: BackfillResult["errors"] = [];
  const tasks: Promise<FetchResult | null>[] = [];

  for (const date of dates) {
    for (const [keyId, info] of upKeyMap.entries()) {
      tasks.push(
        clientForUp(info.account)
          .getKeyUsageStats(info.remoteKeyId, date, date)
          .then(
            (r) =>
              ({
                kind: "upstream",
                date,
                cost: r.total_cost ?? 0,
                actualCost: r.total_actual_cost ?? 0,
                id: keyId,
              }) as FetchResult,
          )
          .catch((e: unknown) => {
            errors.push({
              date,
              kind: "upstream",
              id: keyId,
              error: e instanceof Error ? e.message : String(e),
            });
            return null;
          }),
      );
    }
    for (const [accId, info] of siteAccMap.entries()) {
      tasks.push(
        clientForSite(info.account)
          .getAdminAccountUsageStats(info.remoteAccountId, date, date)
          .then(
            (r) =>
              ({
                kind: "site",
                date,
                cost: r.total_cost ?? 0,
                actualCost: r.total_actual_cost ?? 0,
                id: accId,
              }) as FetchResult,
          )
          .catch((e: unknown) => {
            errors.push({
              date,
              kind: "site",
              id: accId,
              error: e instanceof Error ? e.message : String(e),
            });
            return null;
          }),
      );
    }
  }

  const results = (await Promise.all(tasks)).filter(
    (r): r is FetchResult => r != null,
  );

  // Aggregate per date.
  const perDate = new Map<string, BackfillRow>();
  for (const d of dates) {
    perDate.set(d, {
      date: d,
      revenue: 0,
      expense: 0,
      profit: 0,
      siteCostBase: 0,
      upstreamCostBase: 0,
      diff: 0,
    });
  }
  for (const r of results) {
    const row = perDate.get(r.date);
    if (!row) continue;
    if (r.kind === "site") {
      row.revenue += r.actualCost;
      row.siteCostBase += r.cost;
    } else {
      row.expense += r.actualCost;
      row.upstreamCostBase += r.cost;
    }
  }
  for (const row of perDate.values()) {
    row.profit = row.revenue - row.expense;
    row.diff = Math.abs(row.upstreamCostBase - row.siteCostBase);
  }

  // Upsert rows in parallel via $transaction.
  await prisma.$transaction(
    [...perDate.values()].map((row) =>
      prisma.dailyProfit.upsert({
        where: { date: row.date },
        create: row,
        update: row,
      }),
    ),
  );

  const totals = [...perDate.values()].reduce(
    (acc, r) => {
      acc.revenue += r.revenue;
      acc.expense += r.expense;
      acc.profit += r.profit;
      acc.siteCostBase += r.siteCostBase;
      acc.upstreamCostBase += r.upstreamCostBase;
      acc.diff += r.diff;
      return acc;
    },
    {
      revenue: 0,
      expense: 0,
      profit: 0,
      siteCostBase: 0,
      upstreamCostBase: 0,
      diff: 0,
      days: dates.length,
    },
  );

  return {
    rows: [...perDate.values()].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    ),
    totals,
    errors,
  };
}
