import { prisma } from "./db";
import { readConfig } from "./az";

// Asia/Shanghai 日历日（YYYY-MM-DD）。todayCost/todayActualCost 字段是
// "今天的累计计数"，由 sync 写入；上游下线时 sync 失败 → 字段会卡在
// 昨天的总额，被错误地继续算进今日利润。读时网关：lastUpdatedAt 不是
// 今天 (Shanghai) 就把那一行的今日值当 0。
function shanghaiDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isFreshForToday(lastUpdatedAt: Date | null | undefined): boolean {
  if (!lastUpdatedAt) return false;
  return shanghaiDateString(lastUpdatedAt) === shanghaiDateString();
}

export interface DashboardSummary {
  // Revenue (today): sum of all site bound accounts user_cost
  totalRevenue: number;
  // Expense (today): sum of all upstream keys today_actual_cost
  totalExpense: number;
  // Profit (today)
  totalProfit: number;
  // Site cost in 1x base (cost field)
  totalSiteCostBase: number;
  // Upstream cost normalized to 1x (today_actual / group_multiplier)
  totalUpstreamCostBase: number;
  // |siteBase - upstreamBase|
  totalDiff: number;
  // az tool extra (today): accounts created via az 管理 that go through proxies
  // (not via our managed upstream keys). Already factored into totalProfit.
  totalAzRevenue: number;
  totalAzExpense: number;
  totalAzProfit: number;
  diffThreshold: number;
  diffOverThreshold: boolean;
  // Per-binding diff
  bindings: BindingDiff[];
  // az 站点账号 (no upstream-side diff — these are our own site accounts)
  azAccounts: AzAccountRow[];
  // Counts
  upstreamAccountCount: number;
  siteAccountCount: number;
  upstreamKeyCount: number;
  siteBoundAccountCount: number;
  bindingCount: number;
  unboundUpstreamKeyCount: number;
  unboundSiteAccountCount: number;
  lastSyncAt: Date | null;
}

export interface BoundSiteAccountInfo {
  siteBoundAccountId: number;
  name: string;
  userCost: number;                  // effective (with override)
  userCostSynced: number;
  costBase: number;
  rateMultiplier: number;
  rateMultiplierOverride: number | null;
  rateEffective: number;
}

export interface AzAccountRow {
  siteBoundAccountId: number;
  siteAccountName: string;
  name: string;
  todayCost: number;        // effective cost — fixedCost when set, else synced 1×
  todayUserCost: number;    // revenue (effective)
  profit: number;           // userCost - cost
  rateEffective: number;
  rateMultiplierOverride: number | null;
  fixedCost: number | null; // null = no flat fee set, falling back to synced
}

export interface BindingDiff {
  // Grouped by upstream key — each key shows once, even if multiple
  // site accounts bind to it. Avoids double-counting upstream cost.
  upstreamKeyId: number;
  upstreamKeyName: string;
  upstreamGroupName: string;
  upstreamGroupMultiplier: number;
  upstreamEffectiveMultiplier: number;
  upstreamHasExclusiveRate: boolean;
  upstreamTodayCost: number;             // single value, not duplicated
  upstreamTodayCostBase: number;
  // All site accounts bound to this upstream key
  siteAccounts: BoundSiteAccountInfo[];
  // Aggregate across the bound site accounts
  siteUserCost: number;
  siteUserCostSynced: number;
  siteCostBase: number;
  diff: number; // max(0, upstreamCostBase - siteCostBase). 0 means site ≥ upstream (fine); positive = real loss.
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [
    settings,
    upAccounts,
    siteAccounts,
    upKeys,
    siteBound,
    bindings,
    azPresets,
  ] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.upstreamAccount.findMany(),
    prisma.siteAccount.findMany(),
    prisma.upstreamKey.findMany(),
    prisma.siteBoundAccount.findMany(),
    prisma.binding.findMany({
      where: { endedAt: null }, // 仪表盘是"当下"状态; 历史 binding 不参与
      include: {
        upstreamKey: { include: { upstreamAccount: true } },
        siteBoundAccount: { include: { siteAccount: true } },
      },
    }),
    prisma.azPreset.findMany(),
  ]);

  const boundUpstreamKeyIdSet = new Set(bindings.map((b) => b.upstreamKeyId));
  const boundSiteIdSet = new Set(bindings.map((b) => b.siteBoundAccountId));
  // Only count entities that participate in a binding. An upstream key with
  // no binding represents expense for traffic we don't track on the revenue
  // side, and a site account with no binding represents revenue with no
  // matched cost — including either would distort profit.
  const boundUpKeys = upKeys.filter((k) => boundUpstreamKeyIdSet.has(k.id));
  const boundSiteAccounts = siteBound.filter((a) =>
    boundSiteIdSet.has(a.id),
  );

  // Effective user_cost: if user has set rateMultiplierOverride, recompute
  // revenue as base × override. Otherwise trust the synced todayUserCost.
  // Stale rows (sync failed and lastUpdatedAt < today Shanghai) → 0.
  function effectiveUserCost(a: (typeof boundSiteAccounts)[number]): number {
    if (!isFreshForToday(a.lastUpdatedAt)) return 0;
    if (a.rateMultiplierOverride != null) {
      return a.todayCost * a.rateMultiplierOverride;
    }
    return a.todayUserCost;
  }

  const totalRevenue = boundSiteAccounts.reduce(
    (s, a) => s + effectiveUserCost(a),
    0,
  );
  // Real upstream expense: face value × rechargeMultiplier (= what we
  // actually paid for the credits). The 1× / diff math below stays in
  // face-value space — rechargeMultiplier doesn't change token pricing.
  function realUpstreamCost(k: (typeof boundUpKeys)[number]): number {
    if (!isFreshForToday(k.lastUpdatedAt)) return 0;
    return k.todayActualCost * (k.rechargeMultiplier ?? 1);
  }
  const totalExpense = boundUpKeys.reduce(
    (s, k) => s + realUpstreamCost(k),
    0,
  );
  const totalSiteCostBase = boundSiteAccounts.reduce(
    (s, a) => s + (isFreshForToday(a.lastUpdatedAt) ? a.todayCost : 0),
    0,
  );

  // 1× base for an upstream key. If the rate changed mid-day, the cost
  // accumulated under the OLD rate (snapshot) is normalized with that old
  // rate, and the cost accumulated since (newToday − snapshot) uses the
  // current rate. Refresh writes the snapshot when it detects a rate change.
  function upstreamBase(k: (typeof boundUpKeys)[number]): number {
    if (!isFreshForToday(k.lastUpdatedAt)) return 0;
    const cur = k.effectiveRateMultiplier > 0 ? k.effectiveRateMultiplier : 1;
    const prev = k.previousEffectiveRateMultiplier;
    const snap = k.costAtRateChange;
    if (
      prev != null &&
      prev > 0 &&
      snap != null &&
      snap > 0 &&
      snap <= k.todayActualCost
    ) {
      const oldPart = snap / prev;
      const newPart = (k.todayActualCost - snap) / cur;
      return oldPart + newPart;
    }
    return k.todayActualCost / cur;
  }

  const totalUpstreamCostBase = boundUpKeys.reduce(
    (s, k) => s + upstreamBase(k),
    0,
  );
  // Diff = upstream − site, clamped at 0. Only positive values are an issue
  // (upstream charged more than we recorded). When site ≥ upstream we're
  // fine, so 0. Was Math.abs before; that conflated both directions.
  const totalDiff = Math.max(0, totalUpstreamCostBase - totalSiteCostBase);
  const diffThreshold = settings?.diffThreshold ?? 10;

  // Group bindings by upstream key — when N site accounts share one key,
  // the upstream cost is paid once and should be compared against the SUM
  // of those site accounts, not duplicated per row.
  const groups = new Map<
    number,
    {
      key: (typeof bindings)[number]["upstreamKey"];
      sites: BoundSiteAccountInfo[];
    }
  >();
  for (const b of bindings) {
    const a = b.siteBoundAccount;
    const fresh = isFreshForToday(a.lastUpdatedAt);
    const aTodayCost = fresh ? a.todayCost : 0;
    const aTodayUserCost = fresh ? a.todayUserCost : 0;
    const syncedDerivedRate =
      aTodayCost > 0 ? aTodayUserCost / aTodayCost : a.rateMultiplier;
    const effectiveRate = a.rateMultiplierOverride ?? syncedDerivedRate;
    const effectiveUC =
      a.rateMultiplierOverride != null
        ? aTodayCost * a.rateMultiplierOverride
        : aTodayUserCost;
    const info: BoundSiteAccountInfo = {
      siteBoundAccountId: b.siteBoundAccountId,
      name: `${a.siteAccount.name} / ${a.name}`,
      userCost: effectiveUC,
      userCostSynced: aTodayUserCost,
      costBase: aTodayCost,
      rateMultiplier: a.rateMultiplier,
      rateMultiplierOverride: a.rateMultiplierOverride,
      rateEffective: effectiveRate,
    };
    const existing = groups.get(b.upstreamKeyId);
    if (existing) {
      existing.sites.push(info);
    } else {
      groups.set(b.upstreamKeyId, { key: b.upstreamKey, sites: [info] });
    }
  }

  const bindingDiffs: BindingDiff[] = [...groups.values()].map((g) => {
    const k = g.key;
    const eff = k.effectiveRateMultiplier > 0 ? k.effectiveRateMultiplier : 1;
    const upBase = upstreamBase(k);
    const sumUserCost = g.sites.reduce((s, x) => s + x.userCost, 0);
    const sumUserCostSynced = g.sites.reduce(
      (s, x) => s + x.userCostSynced,
      0,
    );
    const sumCostBase = g.sites.reduce((s, x) => s + x.costBase, 0);
    return {
      upstreamKeyId: k.id,
      upstreamKeyName: `${k.upstreamAccount.name} / ${k.name}`,
      upstreamGroupName: k.groupName,
      upstreamGroupMultiplier: k.groupRateMultiplier,
      upstreamEffectiveMultiplier: eff,
      upstreamHasExclusiveRate: k.hasExclusiveRate,
      upstreamTodayCost: realUpstreamCost(k),
      upstreamTodayCostBase: upBase,
      siteAccounts: g.sites,
      siteUserCost: sumUserCost,
      siteUserCostSynced: sumUserCostSynced,
      siteCostBase: sumCostBase,
      diff: Math.max(0, upBase - sumCostBase),
    };
  });
  // Sort by diff descending (problematic groups first; ties at 0 keep insertion order)
  bindingDiffs.sort((a, b) => b.diff - a.diff);

  // az 管理 created accounts: matched by per-site az prefix. Skip any that
  // happen to also have a Binding (already counted above) to prevent dup.
  const azPrefixBySite = new Map<number, RegExp>();
  for (const p of azPresets) {
    const cfg = readConfig(p.config);
    const re = new RegExp(
      `^${cfg.account_prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`,
    );
    azPrefixBySite.set(p.siteAccountId, re);
  }
  const azAccounts = siteBound.filter((a) => {
    if (boundSiteIdSet.has(a.id)) return false;
    const re = azPrefixBySite.get(a.siteAccountId);
    return re ? re.test(a.name) : false;
  });
  function effectiveAzRevenue(a: (typeof azAccounts)[number]): number {
    if (!isFreshForToday(a.lastUpdatedAt)) return 0;
    if (a.rateMultiplierOverride != null) {
      return a.todayCost * a.rateMultiplierOverride;
    }
    return a.todayUserCost;
  }
  // az cost is FIXED (one-time fee per account), not per-token. When fixedCost
  // is set, that's our 成本 (stays valid even if sync is stale); the synced
  // todayCost fallback is gated by freshness.
  function effectiveAzCost(a: (typeof azAccounts)[number]): number {
    if (a.fixedCost != null) return a.fixedCost;
    return isFreshForToday(a.lastUpdatedAt) ? a.todayCost : 0;
  }
  const totalAzRevenue = azAccounts.reduce(
    (s, a) => s + effectiveAzRevenue(a),
    0,
  );
  const totalAzExpense = azAccounts.reduce((s, a) => s + effectiveAzCost(a), 0);
  const totalAzProfit = totalAzRevenue - totalAzExpense;

  const siteNameById = new Map(siteAccounts.map((s) => [s.id, s.name]));
  const azAccountRows: AzAccountRow[] = azAccounts
    .map((a) => {
      const userCost = effectiveAzRevenue(a);
      const cost = effectiveAzCost(a);
      const syncedRate =
        a.todayCost > 0 ? a.todayUserCost / a.todayCost : a.rateMultiplier;
      const rateEff = a.rateMultiplierOverride ?? syncedRate;
      return {
        siteBoundAccountId: a.id,
        siteAccountName: siteNameById.get(a.siteAccountId) ?? "",
        name: a.name,
        todayCost: cost,
        todayUserCost: userCost,
        profit: userCost - cost,
        rateEffective: rateEff,
        rateMultiplierOverride: a.rateMultiplierOverride,
        fixedCost: a.fixedCost,
      };
    })
    .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));

  const lastSyncDates = [
    ...upAccounts.map((a) => a.lastSyncAt),
    ...siteAccounts.map((a) => a.lastSyncAt),
  ]
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime());

  // az 的 fixedCost 是一次性投入（500/账号），不算到"今日"成本里——
  // 只有 az 当日产生的 userCost 计入今日收入。az fixedCost 只在每日利润
  // 累计层用 totalAzExpense 一次性扣减。
  return {
    totalRevenue: totalRevenue + totalAzRevenue,
    totalExpense: totalExpense,
    totalProfit: totalRevenue + totalAzRevenue - totalExpense,
    totalSiteCostBase,
    totalUpstreamCostBase,
    totalDiff,
    totalAzRevenue,
    totalAzExpense,
    totalAzProfit,
    diffThreshold,
    diffOverThreshold: totalDiff > diffThreshold,
    bindings: bindingDiffs,
    azAccounts: azAccountRows,
    upstreamAccountCount: upAccounts.length,
    siteAccountCount: siteAccounts.length,
    upstreamKeyCount: upKeys.length,
    siteBoundAccountCount: siteBound.length,
    bindingCount: bindings.length,
    unboundUpstreamKeyCount: upKeys.filter(
      (k) => !boundUpstreamKeyIdSet.has(k.id),
    ).length,
    unboundSiteAccountCount: siteBound.filter(
      (a) => !boundSiteIdSet.has(a.id),
    ).length,
    lastSyncAt: lastSyncDates[0] ?? null,
  };
}
