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

// 加载全部 siteBoundAccount（不依赖是否绑定 upstream key）——历史回填的
// 收入侧曾经只迭代 binding，结果把 AZ 渠道、未绑定的散户号等全漏掉了
// （线上观察：221 个 siteBoundAccount 但只有 36 个有 binding → 漏 185 个）。
// 收入按 site 算，不该受 upstream 绑定状态影响。
type SiteBoundFull = Awaited<ReturnType<typeof loadAllSiteBoundAccounts>>[number];
async function loadAllSiteBoundAccounts() {
  return prisma.siteBoundAccount.findMany({
    include: { siteAccount: true },
  });
}

interface Setup {
  bindings: BindingFull[];
  allSites: SiteBoundFull[];
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

function buildSetup(bindings: BindingFull[], allSites: SiteBoundFull[]): Setup {
  // upKeyMap 仍从 bindings 来（支出侧 = 我们买的 key，必须有 binding 才算）。
  // siteAccMap 改从 allSites 来（收入侧 = 任何 site account 产生的 user 收入）。
  const upKeyMap: Setup["upKeyMap"] = new Map();
  const siteAccMap: Setup["siteAccMap"] = new Map();
  for (const b of bindings) {
    upKeyMap.set(b.upstreamKey.id, {
      remoteKeyId: b.upstreamKey.remoteKeyId,
      account: b.upstreamKey.upstreamAccount,
      rechargeMultiplier: b.upstreamKey.rechargeMultiplier ?? 1,
    });
  }
  for (const a of allSites) {
    siteAccMap.set(a.id, {
      remoteAccountId: a.remoteAccountId,
      account: a.siteAccount,
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
  return { bindings, allSites, upKeyMap, siteAccMap, clientForUp, clientForSite };
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

  const [bindings, allSites] = await Promise.all([
    loadBindings(),
    loadAllSiteBoundAccounts(),
  ]);
  if (bindings.length === 0 && allSites.length === 0) {
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

  const setup = buildSetup(bindings, allSites);
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

  // 只在"该日期零成功"时跳过——避免在 sub2api 完全不可达时用零数据覆盖
  // 历史好数据。但只要有任何成功结果，就写入：少数死渠道（如永久 404）
  // 不应该让整天的回填作废，因为剩余 95%+ 的好数据才是用户真正想要的。
  const successByDate = new Map<string, number>();
  for (const r of results) {
    successByDate.set(r.date, (successByDate.get(r.date) ?? 0) + 1);
  }
  const writableDates = [...perDate.values()]
    .filter((r) => (successByDate.get(r.date) ?? 0) > 0)
    .map((r) => r.date);

  // 顺序：先 persist 逐 key 明细到 DailyProfitBreakdown，再从 breakdown 表
  // **重新聚合**写 DailyProfit。这样 DailyProfit ≡ Σ breakdown，永远跟
  // modal 看到的数字一致。死渠道这次 fetch 失败时，breakdown 表里那些
  // stale row 仍计入聚合，跟 modal 一致。
  for (const date of writableDates) {
    const dateResults = results.filter((r) => r.date === date);
    await persistBreakdownForDate(date, dateResults, bindings, allSites);
  }

  // 从 breakdown 重新聚合 → 覆盖 perDate 里的值（确保 DailyProfit 和
  // breakdown 同源）。
  for (const date of writableDates) {
    const agg = await aggregateFromBreakdown(date);
    perDate.set(date, agg);
  }

  const writable = writableDates.map((d) => perDate.get(d)).filter(
    (r): r is BackfillRow => r != null,
  );
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

// ───────────────────────── Breakdown persistence helpers ─────────────────────────

// Upsert per-key / per-account rows for a single date into DailyProfitBreakdown.
// Metadata is captured at write time (rate, group name, account label) so a
// future reader sees the rate that was IN EFFECT that day, even if it later
// got changed in UpstreamKey.
async function persistBreakdownForDate(
  date: string,
  dateResults: FetchResult[],
  bindings: BindingFull[],
  allSites: SiteBoundFull[],
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
  }
  // Site meta covers ALL siteBoundAccounts, including ones with no upstream
  // binding (AZ-managed accounts produce real revenue with no upstream pair).
  for (const a of allSites) {
    siteAccMeta.set(a.id, {
      label: `${a.siteAccount.name} / ${a.name}`,
      siteAccountId: a.siteAccountId,
      siteAccountName: a.siteAccount.name,
      rateMultiplier: a.rateMultiplier ?? 1,
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

// 从 DailyProfitBreakdown 表里读出某日所有行，聚合成 DailyProfit 行。
// 优先用 manualActualCost（用户手填），fallback 到同步值。
// 调用前提：breakdown 该日期已写过；否则全 0。
export async function aggregateFromBreakdown(date: string): Promise<BackfillRow> {
  const rows = await prisma.dailyProfitBreakdown.findMany({
    where: { date },
    select: {
      kind: true,
      cost: true,
      actualCost: true,
      manualActualCost: true,
    },
  });
  const row: BackfillRow = {
    date,
    revenue: 0,
    expense: 0,
    profit: 0,
    siteCostBase: 0,
    upstreamCostBase: 0,
    diff: 0,
  };
  for (const r of rows) {
    if (r.kind === "site") {
      row.revenue += r.actualCost;
      row.siteCostBase += r.cost;
    } else {
      row.expense += r.manualActualCost ?? r.actualCost;
      row.upstreamCostBase += r.cost;
    }
  }
  row.profit = row.revenue - row.expense;
  row.diff = Math.max(0, row.upstreamCostBase - row.siteCostBase);
  return row;
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

  const [bindings, allSites] = await Promise.all([
    loadBindings(),
    loadAllSiteBoundAccounts(),
  ]);
  if (bindings.length === 0 && allSites.length === 0) return;

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
  // Stale 行 (sync 失败、lastUpdatedAt 是昨天) 跳过——否则会把昨天的总额
  // 当作"今天的快照"覆盖到 DailyProfitBreakdown，污染历史回读。
  function isFreshToday(t: Date | null | undefined): boolean {
    if (!t) return false;
    return (
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(t) === today
    );
  }
  // Upstream keys: 只看 bindings 里的（支出侧）。Dedupe by key id.
  for (const b of bindings) {
    if (upKeyMap.has(b.upstreamKey.id)) continue;
    const k = b.upstreamKey;
    if (!isFreshToday(k.lastUpdatedAt)) continue;
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
  // Site bound accounts: 迭代 allSites 而不是 bindings（收入侧），覆盖
  // 未绑 upstream 的 AZ 渠道/散户号。
  for (const a of allSites) {
    if (!isFreshToday(a.lastUpdatedAt)) continue;
    const effectiveUC =
      a.rateMultiplierOverride != null
        ? a.todayCost * a.rateMultiplierOverride
        : a.todayUserCost;
    siteAccMap.set(a.id, {
      cost: a.todayCost,
      actualCost: effectiveUC,
    });
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

  await persistBreakdownForDate(today, dateResults, bindings, allSites);
}

// Load persisted breakdown rows for a date back into the same shape as the
// live-fetch result, so the API/UI can transparently fall back when upstream
// is unreachable.
// 内部返回类型——少 paired 字段，由 caller 用当前 bindings 填上。
type PersistedBreakdown = Omit<DateBreakdown, "paired">;
async function loadPersistedBreakdown(date: string): Promise<PersistedBreakdown | null> {
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
        manualActualCost: r.manualActualCost ?? null,
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
  actualCost: number; // × effectiveRate × rechargeMultiplier (= expense contribution, synced)
  // 用户手动改写过的支出。非 null 时 buildPairedView 优先用这个。
  manualActualCost?: number | null;
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

// Per-row in the unified daily breakdown view. Each row pairs one upstream
// key with all the site accounts bound to it (revenue side), or stands alone
// as an unbound site account (= AZ-style account with no upstream pairing).
export interface PairedBreakdownRow {
  rowKey: string;
  kind: "paired" | "unbound_site" | "unbound_upstream";
  label: string;
  // Optional context for richer rendering
  upstreamKeyId?: number;
  upstreamKeyName?: string;
  upstreamAccountName?: string;
  groupName?: string;
  effectiveRate?: number;
  rechargeMultiplier?: number;
  siteAccounts?: Array<{
    siteBoundAccountId: number;
    accountName: string;
    siteAccountName: string;
    rateMultiplier: number;
    cost: number;
    actualCost: number;
  }>;
  // Metrics (in display currency = same scale across paired/unbound)
  revenue: number; // sum of paired site actualCost (or own for unbound site)
  expense: number; // effective expense（手动值优先；否则同步值）
  expenseSynced?: number; // 原同步值（仅有手动 override 时才填，用于显示对照）
  expenseIsManual?: boolean; // true = expense 来自用户手动改写
  siteCostBase: number;
  upstreamCostBase: number;
  diff: number; // max(0, upstreamCostBase - siteCostBase)
  profit: number; // revenue - expense
}

export interface DateBreakdown {
  date: string;
  upstream: BreakdownUpstreamRow[];
  site: BreakdownSiteRow[];
  // 配对视图 — 前端"每日明细"的主表数据源。已过滤掉当天 0 流量行，
  // 按利润降序。kind=unbound_site 是无 upstream 绑定的 site 账号（AZ 等）。
  paired: PairedBreakdownRow[];
  totals: {
    revenue: number;
    expense: number;
    profit: number;
    siteCostBase: number;
    upstreamCostBase: number;
    diff: number;
  };
  errors: FetchError[];
  // True when the data came from the persisted DailyProfitBreakdown snapshot
  // (the default path now — read-from-DB).
  fromCache?: boolean;
  // Timestamp of the most recent persisted row for that date.
  cachedAt?: Date;
}

// Build the paired / unified row view from raw breakdown rows + current
// bindings. Filters out fully-zero rows and sorts by profit descending.
function buildPairedView(
  upstream: BreakdownUpstreamRow[],
  site: BreakdownSiteRow[],
  bindings: BindingFull[],
): PairedBreakdownRow[] {
  const upRowByKeyId = new Map<number, BreakdownUpstreamRow>();
  for (const r of upstream) upRowByKeyId.set(r.keyId, r);
  const siteRowByAccId = new Map<number, BreakdownSiteRow>();
  for (const r of site) siteRowByAccId.set(r.siteBoundAccountId, r);

  // 分组 bindings：一把 upstream key 可能被 N 个 site account 绑定。
  const bySiteByKey = new Map<number, number[]>();
  for (const b of bindings) {
    const list = bySiteByKey.get(b.upstreamKeyId) ?? [];
    list.push(b.siteBoundAccountId);
    bySiteByKey.set(b.upstreamKeyId, list);
  }

  const rows: PairedBreakdownRow[] = [];

  // ── paired 行：每把 upstream key 一行，聚合其绑定的 site 账号。
  for (const [keyId, siteIds] of bySiteByKey.entries()) {
    const upRow = upRowByKeyId.get(keyId);
    if (!upRow && siteIds.every((sid) => !siteRowByAccId.has(sid))) continue;
    const sites: NonNullable<PairedBreakdownRow["siteAccounts"]> = [];
    let revenue = 0;
    let siteCostBase = 0;
    for (const sid of siteIds) {
      const sr = siteRowByAccId.get(sid);
      if (!sr) continue;
      sites.push({
        siteBoundAccountId: sr.siteBoundAccountId,
        accountName: sr.accountName,
        siteAccountName: sr.siteAccountName,
        rateMultiplier: sr.rateMultiplier,
        cost: sr.cost,
        actualCost: sr.actualCost,
      });
      revenue += sr.actualCost;
      siteCostBase += sr.cost;
    }
    const synced = upRow?.actualCost ?? 0;
    const manual = upRow?.manualActualCost ?? null;
    const expense = manual ?? synced;
    const upstreamCostBase = upRow?.cost ?? 0;
    if (revenue === 0 && expense === 0 && synced === 0) continue; // 当天没用
    rows.push({
      rowKey: `paired:${keyId}`,
      kind: "paired",
      label: upRow
        ? `${upRow.upstreamAccountName} / ${upRow.keyName}`
        : `key #${keyId}`,
      upstreamKeyId: keyId,
      upstreamKeyName: upRow?.keyName,
      upstreamAccountName: upRow?.upstreamAccountName,
      groupName: upRow?.groupName,
      effectiveRate: upRow?.effectiveRate,
      rechargeMultiplier: upRow?.rechargeMultiplier,
      siteAccounts: sites,
      revenue,
      expense,
      expenseSynced: manual != null ? synced : undefined,
      expenseIsManual: manual != null,
      siteCostBase,
      upstreamCostBase,
      diff: Math.max(0, upstreamCostBase - siteCostBase),
      profit: revenue - expense,
    });
  }

  // ── unbound_site 行：site 账号未参与任何 binding → 高亮显示。
  const boundSiteIds = new Set<number>();
  for (const list of bySiteByKey.values()) for (const sid of list) boundSiteIds.add(sid);
  for (const s of site) {
    if (boundSiteIds.has(s.siteBoundAccountId)) continue;
    if (s.actualCost === 0 && s.cost === 0) continue;
    rows.push({
      rowKey: `unbound_site:${s.siteBoundAccountId}`,
      kind: "unbound_site",
      label: `${s.siteAccountName} / ${s.accountName}`,
      siteAccounts: [
        {
          siteBoundAccountId: s.siteBoundAccountId,
          accountName: s.accountName,
          siteAccountName: s.siteAccountName,
          rateMultiplier: s.rateMultiplier,
          cost: s.cost,
          actualCost: s.actualCost,
        },
      ],
      revenue: s.actualCost,
      expense: 0,
      siteCostBase: s.cost,
      upstreamCostBase: 0,
      diff: 0,
      profit: s.actualCost,
    });
  }

  // ── unbound_upstream 行：upstream key 有流量但没在任何 binding 里 — 不应
  //    发生但还是兜底显示。
  const boundKeyIds = new Set(bySiteByKey.keys());
  for (const u of upstream) {
    if (boundKeyIds.has(u.keyId)) continue;
    const manual = u.manualActualCost ?? null;
    const expense = manual ?? u.actualCost;
    if (expense === 0 && u.actualCost === 0 && u.cost === 0) continue;
    rows.push({
      rowKey: `unbound_upstream:${u.keyId}`,
      kind: "unbound_upstream",
      label: `${u.upstreamAccountName} / ${u.keyName}`,
      upstreamKeyId: u.keyId,
      upstreamKeyName: u.keyName,
      upstreamAccountName: u.upstreamAccountName,
      groupName: u.groupName,
      effectiveRate: u.effectiveRate,
      rechargeMultiplier: u.rechargeMultiplier,
      revenue: 0,
      expense,
      expenseSynced: manual != null ? u.actualCost : undefined,
      expenseIsManual: manual != null,
      siteCostBase: 0,
      upstreamCostBase: u.cost,
      diff: u.cost,
      profit: -expense,
    });
  }

  // 按利润降序：盈利的排前面，亏损（profit<0）排最后。
  rows.sort((a, b) => b.profit - a.profit);
  return rows;
}

export async function fetchDateBreakdown(
  date: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<DateBreakdown> {
  // Reuse the daterange validator for a 1-day "range".
  const dates = eachDayInRange(date, date);
  if (dates.length !== 1) {
    throw new Error("invalid date");
  }

  const [bindings, allSites] = await Promise.all([
    loadBindings(),
    loadAllSiteBoundAccounts(),
  ]);

  // ── 缓存优先 ─────────────────────────────────────────────────
  // 每日明细数据写在 DailyProfitBreakdown 表（每次 sync + backfill 都写）。
  // 模态框默认从 DB 读，不再每次点开就打上游 ——这是 #几十次点击都把上游
  // 打挂的根因。只有显式 force=true 才走 live。
  if (!opts.forceRefresh) {
    const cached = await loadPersistedBreakdown(date);
    if (cached) {
      return { ...cached, paired: buildPairedView(cached.upstream, cached.site, bindings) };
    }
    // 缓存为空时 fall through 到 live fetch + write-through。
  }

  if (bindings.length === 0 && allSites.length === 0) {
    return {
      date,
      upstream: [],
      site: [],
      paired: [],
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

  // Build label lookup. upKeyMeta 来自 bindings；siteAccMeta 来自 allSites
  // 以保证未绑定的 AZ 渠道等也能展示。
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
  }
  for (const a of allSites) {
    siteAccMeta.set(a.id, {
      accountName: a.name,
      siteAccountId: a.siteAccountId,
      siteAccountName: a.siteAccount.name,
      rateMultiplier: a.rateMultiplier ?? 1,
    });
  }

  const setup = buildSetup(bindings, allSites);
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
    if (cached) {
      return {
        ...cached,
        paired: buildPairedView(cached.upstream, cached.site, bindings),
      };
    }
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
    persistBreakdownForDate(date, results, bindings, allSites).catch((e) => {
      console.error(`[breakdown write-through ${date}] failed:`, e);
    });
  }

  // 合并 DB 里 upstream 侧的 manualActualCost（live fetch 不携带，要从 DB 取）
  const manualOverrides = await prisma.dailyProfitBreakdown.findMany({
    where: { date, kind: "upstream", manualActualCost: { not: null } },
    select: { refId: true, manualActualCost: true },
  });
  if (manualOverrides.length > 0) {
    const byId = new Map(manualOverrides.map((m) => [m.refId, m.manualActualCost]));
    for (const u of upstream) {
      const v = byId.get(u.keyId);
      if (v != null) u.manualActualCost = v;
    }
  }

  const paired = buildPairedView(upstream, site, bindings);
  return { date, upstream, site, paired, totals, errors };
}
