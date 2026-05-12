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

  // Persist逐 key 明细快照（每个干净日期一份），为上游下线后留底。
  // 跟 DailyProfit 同步：跳过有 fetch 错误的日期。
  for (const date of writable.map((r) => r.date)) {
    const dateResults = results.filter((r) => r.date === date);
    await persistBreakdownForDate(date, dateResults, bindings);
  }

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

// ───────────────────────── Breakdown persistence helpers ─────────────────────────

// Upsert per-key / per-account rows for a single date into DailyProfitBreakdown.
// Metadata is captured at write time (rate, group name, account label) so a
// future reader sees the rate that was IN EFFECT that day, even if it later
// got changed in UpstreamKey.
async function persistBreakdownForDate(
  date: string,
  dateResults: FetchResult[],
  bindings: BindingFull[],
): Promise<void> {
  const upKeyMeta = new Map<
    number,
    {
      label: string;
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
      label: string;
      siteAccountId: number;
      siteAccountName: string;
      rateMultiplier: number;
    }
  >();
  for (const b of bindings) {
    upKeyMeta.set(b.upstreamKey.id, {
      label: `${b.upstreamKey.upstreamAccount.name} / ${b.upstreamKey.name}`,
      groupName: b.upstreamKey.groupName,
      effectiveRate: b.upstreamKey.effectiveRateMultiplier ?? 1,
      rechargeMultiplier: b.upstreamKey.rechargeMultiplier ?? 1,
      upstreamAccountId: b.upstreamKey.upstreamAccountId,
      upstreamAccountName: b.upstreamKey.upstreamAccount.name,
      upstreamType: b.upstreamKey.upstreamAccount.type,
    });
    siteAccMeta.set(b.siteBoundAccount.id, {
      label: `${b.siteBoundAccount.siteAccount.name} / ${b.siteBoundAccount.name}`,
      siteAccountId: b.siteBoundAccount.siteAccountId,
      siteAccountName: b.siteBoundAccount.siteAccount.name,
      rateMultiplier: b.siteBoundAccount.rateMultiplier ?? 1,
    });
  }

  const writes: Promise<unknown>[] = [];
  for (const r of dateResults) {
    if (r.kind === "upstream") {
      const meta = upKeyMeta.get(r.id);
      if (!meta) continue;
      const data = {
        label: meta.label,
        groupName: meta.groupName,
        effectiveRate: meta.effectiveRate,
        rechargeMultiplier: meta.rechargeMultiplier,
        upstreamAccountId: meta.upstreamAccountId,
        upstreamAccountName: meta.upstreamAccountName,
        upstreamType: meta.upstreamType,
        siteAccountId: null,
        siteAccountName: null,
        rateMultiplier: null,
        cost: r.cost,
        actualCost: r.actualCost,
      };
      writes.push(
        prisma.dailyProfitBreakdown.upsert({
          where: {
            date_kind_refId: { date, kind: "upstream", refId: r.id },
          },
          create: { date, kind: "upstream", refId: r.id, ...data },
          update: data,
        }),
      );
    } else {
      const meta = siteAccMeta.get(r.id);
      if (!meta) continue;
      const data = {
        label: meta.label,
        groupName: null,
        effectiveRate: null,
        rechargeMultiplier: null,
        upstreamAccountId: null,
        upstreamAccountName: null,
        upstreamType: null,
        siteAccountId: meta.siteAccountId,
        siteAccountName: meta.siteAccountName,
        rateMultiplier: meta.rateMultiplier,
        cost: r.cost,
        actualCost: r.actualCost,
      };
      writes.push(
        prisma.dailyProfitBreakdown.upsert({
          where: { date_kind_refId: { date, kind: "site", refId: r.id } },
          create: { date, kind: "site", refId: r.id, ...data },
          update: data,
        }),
      );
    }
  }
  await Promise.all(writes);
}

// Today's per-key snapshot from current UpstreamKey / SiteBoundAccount state.
// Called from the regular sync's recordSnapshot() — every 5 min during the day,
// "今天" 的明细就被反复留底；上游下线时最多丢 5 分钟。
export async function persistTodayBreakdown(): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const bindings = await loadBindings();
  if (bindings.length === 0) return;

  // For "today" we don't fetch from upstream — we use the values already
  // synced into UpstreamKey/SiteBoundAccount. Those are the live values that
  // power the dashboard right now, and they're written transactionally by
  // the regular sync just before recordSnapshot() runs.
  const upKeyMap = new Map<
    number,
    {
      cost: number;
      actualCost: number;
    }
  >();
  const siteAccMap = new Map<
    number,
    {
      cost: number;
      actualCost: number;
    }
  >();
  // Dedupe — multiple bindings can reference same key/account.
  for (const b of bindings) {
    if (!upKeyMap.has(b.upstreamKey.id)) {
      const k = b.upstreamKey;
      const eff = k.effectiveRateMultiplier > 0 ? k.effectiveRateMultiplier : 1;
      // 1× face value: prefer split when rate changed mid-day, otherwise
      // simple division. Mirrors dashboard.upstreamBase().
      let costBase: number;
      const prev = k.previousEffectiveRateMultiplier;
      const snap = k.costAtRateChange;
      if (
        prev != null &&
        prev > 0 &&
        snap != null &&
        snap > 0 &&
        snap <= k.todayActualCost
      ) {
        costBase = snap / prev + (k.todayActualCost - snap) / eff;
      } else {
        costBase = k.todayActualCost / eff;
      }
      upKeyMap.set(k.id, {
        cost: costBase,
        actualCost: k.todayActualCost * (k.rechargeMultiplier ?? 1),
      });
    }
    if (!siteAccMap.has(b.siteBoundAccount.id)) {
      const a = b.siteBoundAccount;
      const effectiveUC =
        a.rateMultiplierOverride != null
          ? a.todayCost * a.rateMultiplierOverride
          : a.todayUserCost;
      siteAccMap.set(a.id, {
        cost: a.todayCost,
        actualCost: effectiveUC,
      });
    }
  }

  const dateResults: FetchResult[] = [
    ...[...upKeyMap.entries()].map(
      ([id, v]) =>
        ({
          kind: "upstream",
          date: today,
          id,
          cost: v.cost,
          actualCost: v.actualCost,
        }) as FetchResult,
    ),
    ...[...siteAccMap.entries()].map(
      ([id, v]) =>
        ({
          kind: "site",
          date: today,
          id,
          cost: v.cost,
          actualCost: v.actualCost,
        }) as FetchResult,
    ),
  ];

  await persistBreakdownForDate(today, dateResults, bindings);
}

// Load persisted breakdown rows for a date back into the same shape as the
// live-fetch result, so the API/UI can transparently fall back when upstream
// is unreachable.
async function loadPersistedBreakdown(date: string): Promise<DateBreakdown | null> {
  const rows = await prisma.dailyProfitBreakdown.findMany({
    where: { date },
  });
  if (rows.length === 0) return null;
  const upstream: BreakdownUpstreamRow[] = [];
  const site: BreakdownSiteRow[] = [];
  for (const r of rows) {
    if (r.kind === "upstream") {
      upstream.push({
        keyId: r.refId,
        keyName: r.label,
        groupName: r.groupName ?? "",
        effectiveRate: r.effectiveRate ?? 1,
        rechargeMultiplier: r.rechargeMultiplier ?? 1,
        upstreamAccountId: r.upstreamAccountId ?? 0,
        upstreamAccountName: r.upstreamAccountName ?? "",
        upstreamType: r.upstreamType ?? "",
        cost: r.cost,
        actualCost: r.actualCost,
      });
    } else {
      site.push({
        siteBoundAccountId: r.refId,
        accountName: r.label,
        siteAccountId: r.siteAccountId ?? 0,
        siteAccountName: r.siteAccountName ?? "",
        rateMultiplier: r.rateMultiplier ?? 1,
        cost: r.cost,
        actualCost: r.actualCost,
      });
    }
  }
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
  totals.diff = Math.max(0, totals.upstreamCostBase - totals.siteCostBase);
  // 最早一行的 capturedAt 作为"快照时间"。前端用来显示"📦 来自 X 时的本地缓存"。
  const latestCaptured = rows.reduce(
    (m, r) => (r.updatedAt > m ? r.updatedAt : m),
    rows[0].updatedAt,
  );
  return { date, upstream, site, totals, errors: [], fromCache: true, cachedAt: latestCaptured };
}

// ───────────────────────── Per-day breakdown (read-only) ─────────────────────────
// Used by the "click a date to inspect" UI on the dashboard. Same fetching path
// as backfillRange but for ONE date, with write-through to DailyProfitBreakdown
// on success and DB-fallback when the upstream is unreachable.

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
  // True when the data was served from the persisted DailyProfitBreakdown
  // snapshot because the live upstream fetch produced no usable data (e.g.
  // upstream is down or credentials revoked).
  fromCache?: boolean;
  // When fromCache=true, the timestamp of the most recent persisted row.
  cachedAt?: Date;
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
  let results: FetchResult[] = [];
  try {
    const tasks = fetchTasks(date, setup, errors);
    results = (await Promise.all(tasks)).filter(
      (r): r is FetchResult => r != null,
    );
  } catch {
    // catastrophic — handled by the empty-results fallback below.
  }

  // 上游全军覆没（每个绑定都失败 OR 0 条结果回来）→ 回落到本地快照。
  if (results.length === 0 && errors.length > 0) {
    const cached = await loadPersistedBreakdown(date);
    if (cached) return cached;
    // 缓存也没有 → 把 errors 暴露出去，前端能看到。
  }

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

  // Write-through: 拿到了实时数据就趁机留底。下次上游挂了就有兜底。
  // 错误不阻塞返回 — 失败时只是少了缓存，不影响本次响应。
  if (results.length > 0) {
    persistBreakdownForDate(date, results, bindings).catch((e) => {
      console.error(`[breakdown write-through ${date}] failed:`, e);
    });
  }

  return { date, upstream, site, totals, errors };
}
