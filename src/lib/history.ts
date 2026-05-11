import { prisma } from "./db";
import { Sub2ApiClient } from "./sub2api";
import {
  makeUpstreamApiClient,
  type UpstreamApiClient,
} from "./upstream-client";

interface UpstreamAccountRow {
  id: number;
  type: string;
  baseUrl: string;
  email: string;
  password: string;
  apiKey?: string | null;
  accessToken: string | null;
  remoteUserId?: number | null;
}
interface SiteAccountRow {
  id: number;
  baseUrl: string;
  email: string;
  password: string;
  apiKey: string | null;
  accessToken: string | null;
}

function makeUpstreamClient(acc: UpstreamAccountRow): UpstreamApiClient {
  return makeUpstreamApiClient(acc);
}

function makeSiteClient(acc: SiteAccountRow) {
  return new Sub2ApiClient(
    {
      baseUrl: acc.baseUrl,
      email: acc.email,
      password: acc.password,
      apiKey: acc.apiKey,
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

type SiteResult = {
  kind: "site";
  date: string;
  cost: number; // 1×
  actualCost: number; // × site rate
  id: number; // SiteBoundAccount.id
};
type UpResult = {
  kind: "upstream";
  date: string;
  cost: number;
  actualCost: number; // post-rate × rechargeMultiplier
  id: number; // UpstreamKey.id
};
type FetchResult = SiteResult | UpResult;
type FetchError = {
  date: string;
  kind: "site" | "upstream";
  id: number;
  error: string;
};

type BindingFull = Awaited<ReturnType<typeof loadBindings>>[number];

async function loadBindings() {
  return prisma.binding.findMany({
    include: {
      upstreamKey: { include: { upstreamAccount: true } },
      siteBoundAccount: { include: { siteAccount: true } },
    },
  });
}

interface Setup {
  bindings: BindingFull[];
  upKeyMap: Map<
    number,
    {
      remoteKeyId: number;
      account: UpstreamAccountRow;
      rechargeMultiplier: number;
    }
  >;
  siteAccMap: Map<number, { remoteAccountId: number; account: SiteAccountRow }>;
  clientForUp: (acc: UpstreamAccountRow) => UpstreamApiClient;
  clientForSite: (acc: SiteAccountRow) => Sub2ApiClient;
}

function buildSetup(bindings: BindingFull[]): Setup {
  // Dedupe upstream keys and site accounts (M:N → many bindings may reference same key).
  const upKeyMap: Setup["upKeyMap"] = new Map();
  const siteAccMap: Setup["siteAccMap"] = new Map();
  for (const b of bindings) {
    upKeyMap.set(b.upstreamKey.id, {
      remoteKeyId: b.upstreamKey.remoteKeyId,
      account: b.upstreamKey.upstreamAccount,
      rechargeMultiplier: b.upstreamKey.rechargeMultiplier ?? 1,
    });
    siteAccMap.set(b.siteBoundAccount.id, {
      remoteAccountId: b.siteBoundAccount.remoteAccountId,
      account: b.siteBoundAccount.siteAccount,
    });
  }

  // Reuse one client per parent account to share tokens / connection.
  const upstreamClients = new Map<number, UpstreamApiClient>();
  const siteClients = new Map<number, Sub2ApiClient>();
  function clientForUp(acc: UpstreamAccountRow): UpstreamApiClient {
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
  return { bindings, upKeyMap, siteAccMap, clientForUp, clientForSite };
}

// Build all (date × key) fetch tasks. Errors are captured per-task, not thrown.
function fetchTasks(
  date: string,
  setup: Setup,
  errors: FetchError[],
): Promise<FetchResult | null>[] {
  const tasks: Promise<FetchResult | null>[] = [];
  for (const [keyId, info] of setup.upKeyMap.entries()) {
    tasks.push(
      setup
        .clientForUp(info.account)
        .getKeyUsageStats(info.remoteKeyId, date, date)
        .then(
          (r) =>
            ({
              kind: "upstream",
              date,
              cost: r.total_cost ?? 0,
              // Apply rechargeMultiplier so expense reflects real money spent.
              // cost (1× base) stays in face-value space.
              actualCost: (r.total_actual_cost ?? 0) * info.rechargeMultiplier,
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
  for (const [accId, info] of setup.siteAccMap.entries()) {
    tasks.push(
      setup
        .clientForSite(info.account)
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
  return tasks;
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

  const bindings = await loadBindings();
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

  const setup = buildSetup(bindings);
  const errors: FetchError[] = [];
  const tasks: Promise<FetchResult | null>[] = [];
  for (const date of dates) {
    tasks.push(...fetchTasks(date, setup, errors));
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

  // 跳过任何捕获到错误的日期 — 部分失败的日期数据残缺，写入会覆盖之前
  // 的好数据。让前端拿到 errors[] 决定重试。
  const badDates = new Set(errors.map((e) => e.date));
  const writable = [...perDate.values()].filter((r) => !badDates.has(r.date));
  await prisma.$transaction(
    writable.map((row) =>
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

// ───────────────────────── Per-day breakdown (read-only) ─────────────────────────
// Used by the "click a date to inspect" UI on the dashboard. Same fetching path
// as backfillRange but for ONE date, no DB writes, and enriched with key + site
// metadata so the UI can render per-row labels (key name, group, rate, etc.).

export interface BreakdownUpstreamRow {
  keyId: number;
  keyName: string;
  groupName: string;
  effectiveRate: number;
  rechargeMultiplier: number;
  upstreamAccountId: number;
  upstreamAccountName: string;
  upstreamType: string;
  cost: number; // 1×
  actualCost: number; // × effectiveRate × rechargeMultiplier (= expense contribution)
}

export interface BreakdownSiteRow {
  siteBoundAccountId: number;
  accountName: string;
  siteAccountId: number;
  siteAccountName: string;
  rateMultiplier: number;
  cost: number; // 1×
  actualCost: number; // revenue contribution
}

export interface DateBreakdown {
  date: string;
  upstream: BreakdownUpstreamRow[];
  site: BreakdownSiteRow[];
  totals: {
    revenue: number;
    expense: number;
    profit: number;
    siteCostBase: number;
    upstreamCostBase: number;
    diff: number;
  };
  errors: FetchError[];
}

export async function fetchDateBreakdown(date: string): Promise<DateBreakdown> {
  // Reuse the daterange validator for a 1-day "range".
  const dates = eachDayInRange(date, date);
  if (dates.length !== 1) {
    throw new Error("invalid date");
  }

  const bindings = await loadBindings();
  if (bindings.length === 0) {
    return {
      date,
      upstream: [],
      site: [],
      totals: {
        revenue: 0,
        expense: 0,
        profit: 0,
        siteCostBase: 0,
        upstreamCostBase: 0,
        diff: 0,
      },
      errors: [],
    };
  }

  // Build label lookup from the loaded bindings (keys + site accounts).
  const upKeyMeta = new Map<
    number,
    {
      name: string;
      groupName: string;
      effectiveRate: number;
      rechargeMultiplier: number;
      upstreamAccountId: number;
      upstreamAccountName: string;
      upstreamType: string;
    }
  >();
  const siteAccMeta = new Map<
    number,
    {
      accountName: string;
      siteAccountId: number;
      siteAccountName: string;
      rateMultiplier: number;
    }
  >();
  for (const b of bindings) {
    upKeyMeta.set(b.upstreamKey.id, {
      name: b.upstreamKey.name,
      groupName: b.upstreamKey.groupName,
      effectiveRate: b.upstreamKey.effectiveRateMultiplier ?? 1,
      rechargeMultiplier: b.upstreamKey.rechargeMultiplier ?? 1,
      upstreamAccountId: b.upstreamKey.upstreamAccountId,
      upstreamAccountName: b.upstreamKey.upstreamAccount.name,
      upstreamType: b.upstreamKey.upstreamAccount.type,
    });
    siteAccMeta.set(b.siteBoundAccount.id, {
      accountName: b.siteBoundAccount.name,
      siteAccountId: b.siteBoundAccount.siteAccountId,
      siteAccountName: b.siteBoundAccount.siteAccount.name,
      rateMultiplier: b.siteBoundAccount.rateMultiplier ?? 1,
    });
  }

  const setup = buildSetup(bindings);
  const errors: FetchError[] = [];
  const tasks = fetchTasks(date, setup, errors);
  const results = (await Promise.all(tasks)).filter(
    (r): r is FetchResult => r != null,
  );

  // Bucket per-key.
  const upstream: BreakdownUpstreamRow[] = [];
  const site: BreakdownSiteRow[] = [];
  for (const r of results) {
    if (r.kind === "upstream") {
      const meta = upKeyMeta.get(r.id);
      if (!meta) continue;
      upstream.push({
        keyId: r.id,
        keyName: meta.name,
        groupName: meta.groupName,
        effectiveRate: meta.effectiveRate,
        rechargeMultiplier: meta.rechargeMultiplier,
        upstreamAccountId: meta.upstreamAccountId,
        upstreamAccountName: meta.upstreamAccountName,
        upstreamType: meta.upstreamType,
        cost: r.cost,
        actualCost: r.actualCost,
      });
    } else {
      const meta = siteAccMeta.get(r.id);
      if (!meta) continue;
      site.push({
        siteBoundAccountId: r.id,
        accountName: meta.accountName,
        siteAccountId: meta.siteAccountId,
        siteAccountName: meta.siteAccountName,
        rateMultiplier: meta.rateMultiplier,
        cost: r.cost,
        actualCost: r.actualCost,
      });
    }
  }

  // Sort largest contribution first — easier to scan.
  upstream.sort((a, b) => b.actualCost - a.actualCost);
  site.sort((a, b) => b.actualCost - a.actualCost);

  const totals = {
    revenue: site.reduce((s, r) => s + r.actualCost, 0),
    expense: upstream.reduce((s, r) => s + r.actualCost, 0),
    profit: 0,
    siteCostBase: site.reduce((s, r) => s + r.cost, 0),
    upstreamCostBase: upstream.reduce((s, r) => s + r.cost, 0),
    diff: 0,
  };
  totals.profit = totals.revenue - totals.expense;
  totals.diff = Math.abs(totals.upstreamCostBase - totals.siteCostBase);

  return { date, upstream, site, totals, errors };
}
