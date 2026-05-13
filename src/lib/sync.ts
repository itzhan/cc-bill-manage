import { prisma } from "./db";
import { Sub2ApiClient } from "./sub2api";
import type { AdminUser } from "./sub2api";
import { makeUpstreamApiClient } from "./upstream-client";
import { getDashboardSummary } from "./dashboard";
import { persistTodayBreakdown } from "./history";
import {
  maybeSendDiffAlert,
  maybeSendErrorRateAlert,
  type SiteErrorSnapshot,
} from "./mailer";
import { makeSiteClient as makeSiteClientById } from "./az-server";

// Sync admin users + their total_recharged for one site account.
// Optimized to **2 calls total** (was 2N+1):
//   1. listAdminUsers  → already includes total_recharged on newer sub2api
//   2. getUsersUsage   → per-user today_cost / today_actual_cost in one call
// Falls back to per-user usage stats only when the bulk endpoint 404s.
async function syncSiteUsersFor(
  id: number,
  client: Sub2ApiClient,
): Promise<void> {
  let users: AdminUser[];
  try {
    users = await client.listAdminUsers();
  } catch (e) {
    console.error(`[sync users #${id}] listAdminUsers failed:`, e);
    return;
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Today's spend: ONE bulk call for all users.
  let usageMap: Record<
    string,
    {
      user_id: number;
      today_actual_cost: number;
      today_cost?: number;
    }
  > = {};
  let usageMapWorked = true;
  try {
    usageMap = await client.getUsersUsage(users.map((u) => u.id));
  } catch {
    usageMapWorked = false;
  }
  const fallbackStats = !usageMapWorked
    ? await Promise.all(
        users.map((u) =>
          client.getAdminUserUsageStats(u.id, today, today).catch(() => null),
        ),
      )
    : null;
  // Lifetime total_recharged: /admin/users always returns 0 on current
  // sub2api builds — must fan out balance-history per user. Parallel.
  const totalRechargedByUser = await Promise.all(
    users.map((u) =>
      client
        .getUserBalanceHistory(u.id)
        .then((h) => h.totalRecharged)
        .catch(() => null),
    ),
  );
  const now = new Date();
  const seen = users.map((u) => u.id);
  await prisma.$transaction([
    ...users.map((u, i) => {
      // Normalise into a single shape regardless of source endpoint.
      let todayCost = 0;
      let todayActualCost = 0;
      let hasStats = false;
      if (usageMapWorked) {
        const m = usageMap[String(u.id)];
        if (m) {
          hasStats = true;
          todayCost = m.today_cost ?? 0;
          todayActualCost = m.today_actual_cost ?? 0;
        }
      } else {
        const fb = fallbackStats?.[i];
        if (fb) {
          hasStats = true;
          todayCost = fb.total_cost ?? 0;
          todayActualCost = fb.total_actual_cost ?? 0;
        }
      }
      // /admin/users.total_recharged is always 0 on current sub2api builds;
      // use the real value from per-user balance-history fan-out above.
      const recharged = totalRechargedByUser[i];
      const data: Record<string, unknown> = {
        email: u.email,
        username: u.username || "",
        role: u.role,
        status: u.status,
        balance: u.balance,
        todayCost,
        todayActualCost,
        todayStatsAt: hasStats ? now : null,
        notes: u.notes ?? null,
        lastActiveAt: u.last_active_at ? new Date(u.last_active_at) : null,
        lastUsedAt: u.last_used_at ? new Date(u.last_used_at) : null,
        remoteCreatedAt: u.created_at ? new Date(u.created_at) : null,
        lastSyncAt: now,
      };
      // Prefer the freshly fetched balance-history value; fall back to the
      // /admin/users field only if the history call failed (it's 0 anyway,
      // but keeps the previously-stored value on subsequent failures).
      if (typeof recharged === "number") {
        data.totalRecharged = recharged;
      } else if (typeof u.total_recharged === "number") {
        data.totalRecharged = u.total_recharged;
      }
      const createData = {
        siteAccountId: id,
        remoteUserId: u.id,
        totalRecharged: 0,
        ...data,
      } as Parameters<typeof prisma.siteUser.create>[0]["data"];
      return prisma.siteUser.upsert({
        where: {
          siteAccountId_remoteUserId: {
            siteAccountId: id,
            remoteUserId: u.id,
          },
        },
        create: createData,
        update: data,
      });
    }),
    prisma.siteUser.deleteMany({
      where: {
        siteAccountId: id,
        remoteUserId: { notIn: seen.length ? seen : [-1] },
      },
    }),
  ]);
}

function maskKey(k: string) {
  if (!k) return "";
  if (k.length <= 12) return k;
  return `${k.slice(0, 8)}...${k.slice(-6)}`;
}

function makeUpstreamClient(acc: {
  id: number;
  type: string;
  baseUrl: string;
  email: string;
  password: string;
  accessToken: string | null;
  remoteUserId?: number | null;
}) {
  // Routes to sub2api or newapi based on type. See upstream-client.ts.
  return makeUpstreamApiClient(acc);
}

function makeSiteClient(acc: {
  id: number;
  baseUrl: string;
  email: string;
  password: string;
  apiKey: string | null;
  accessToken: string | null;
}) {
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

// =============================================================
// FULL refresh — pulls structure (keys / accounts / groups / rates)
// Use sparingly: on account creation, or when user clicks "完整刷新".
// =============================================================

export async function refreshUpstreamAccount(id: number): Promise<void> {
  const acc = await prisma.upstreamAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("upstream account not found");
  const client = makeUpstreamClient(acc);

  try {
    const [keys, userRates, me, existingKeys] = await Promise.all([
      client.listKeys(),
      client.getUserGroupRates().catch(() => ({}) as Record<number, number>),
      client.getMe().catch(() => null),
      // Pre-load existing rows so we can detect mid-day rate changes.
      prisma.upstreamKey.findMany({ where: { upstreamAccountId: id } }),
    ]);
    const existingByRemote = new Map(
      existingKeys.map((e) => [e.remoteKeyId, e]),
    );
    const remoteIds = keys.map((k) => k.id);
    const usage = await client.getKeysUsage(remoteIds);

    const seen = keys.map((k) => k.id);
    const now = new Date();
    await prisma.$transaction([
      ...keys.map((k) => {
        const u = usage[String(k.id)] || {
          today_actual_cost: 0,
          total_actual_cost: 0,
          api_key_id: k.id,
        };
        // Some sub2api responses omit top-level group_id; fall back to nested group.id.
        const resolvedGroupId =
          (k.group_id != null && Number.isFinite(k.group_id)
            ? k.group_id
            : null) ?? k.group?.id ?? 0;
        const groupDefault = k.group?.rate_multiplier ?? 1;
        const groupName = k.group?.name ?? "";
        // sub2api userRates is keyed by group id (number); newapi by group
        // name (string). Try id first, then name — covers both adapters.
        const override =
          (userRates as Record<string | number, number>)[resolvedGroupId] ??
          (userRates as Record<string | number, number>)[groupName];
        const effective = override ?? groupDefault;
        const hasExclusive = override != null && override !== groupDefault;
        const newToday = u.today_actual_cost;

        // Detect rate change vs previous record.
        // todayActualCost stays in face-value units (what upstream reports);
        // rechargeMultiplier is applied at READ time in dashboard.ts so the
        // diff/snapshot math stays clean.
        const prev = existingByRemote.get(k.id);
        let rateSnapshot: {
          previousEffectiveRateMultiplier: number | null;
          costAtRateChange: number | null;
          rateChangedAt: Date | null;
        } = {
          previousEffectiveRateMultiplier:
            prev?.previousEffectiveRateMultiplier ?? null,
          costAtRateChange: prev?.costAtRateChange ?? null,
          rateChangedAt: prev?.rateChangedAt ?? null,
        };
        if (prev) {
          const todayDropped = newToday < (prev.todayActualCost ?? 0) - 0.01;
          if (todayDropped) {
            rateSnapshot = {
              previousEffectiveRateMultiplier: null,
              costAtRateChange: null,
              rateChangedAt: null,
            };
          }
          if (
            !todayDropped &&
            prev.effectiveRateMultiplier !== effective &&
            prev.todayActualCost > 0
          ) {
            rateSnapshot = {
              previousEffectiveRateMultiplier: prev.effectiveRateMultiplier,
              costAtRateChange: prev.todayActualCost,
              rateChangedAt: now,
            };
          }
        }
        // k.key 是上游 /api/v1/keys 返回的 raw key 值。如果上游版本只回 mask，
        // 字符串里会带 ***，我们就只保留 keyMasked，apiKey 留 null（不可用来匹配）。
        const looksRaw =
          typeof k.key === "string" && k.key.length > 0 && !k.key.includes("*");
        const data = {
          name: k.name,
          keyMasked: maskKey(k.key),
          apiKey: looksRaw ? k.key : null,
          groupId: resolvedGroupId,
          groupName: k.group?.name || "",
          groupRateMultiplier: groupDefault,
          effectiveRateMultiplier: effective,
          hasExclusiveRate: hasExclusive,
          todayActualCost: newToday,
          totalActualCost: u.total_actual_cost,
          lastUpdatedAt: now,
          ...rateSnapshot,
        };
        return prisma.upstreamKey.upsert({
          where: {
            upstreamAccountId_remoteKeyId: {
              upstreamAccountId: id,
              remoteKeyId: k.id,
            },
          },
          create: {
            remoteKeyId: k.id,
            ...data,
            upstreamAccount: { connect: { id } },
          },
          update: data,
        });
      }),
      prisma.upstreamKey.deleteMany({
        where: {
          upstreamAccountId: id,
          remoteKeyId: { notIn: seen.length ? seen : [-1] },
        },
      }),
    ]);

    await prisma.upstreamAccount.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: null,
        ...(me != null
          ? { balance: me.balance, balanceUpdatedAt: new Date() }
          : {}),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.upstreamAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncError: msg.slice(0, 500) },
    });
    throw e;
  }
}

export async function refreshSiteAccount(id: number): Promise<void> {
  const acc = await prisma.siteAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("site account not found");
  const client = makeSiteClient(acc);

  try {
    const accounts = await client.listAdminAccounts();
    const remoteIds = accounts.map((a) => a.id);
    const stats = await client.getAccountsStats(remoteIds);
    // Run user sync in parallel — errors swallowed inside.
    const usersTask = syncSiteUsersFor(id, client);

    const seen = accounts.map((a) => a.id);
    const now = new Date();
    await prisma.$transaction([
      ...accounts.map((a) => {
        const s = stats[String(a.id)] || {
          requests: 0,
          tokens: 0,
          cost: 0,
          standard_cost: 0,
          user_cost: 0,
        };
        const groupSummary = JSON.stringify(
          (a.groups || []).map((g) => ({
            id: g.id,
            name: g.name,
            rate_multiplier: g.rate_multiplier,
          })),
        );
        const data = {
          name: a.name,
          rateMultiplier: a.rate_multiplier ?? 1,
          groupSummary,
          todayRequests: s.requests,
          todayTokens: BigInt(s.tokens || 0),
          todayCost: s.cost,
          todayStandardCost: s.standard_cost,
          todayUserCost: s.user_cost,
          lastUpdatedAt: now,
        };
        return prisma.siteBoundAccount.upsert({
          where: {
            siteAccountId_remoteAccountId: {
              siteAccountId: id,
              remoteAccountId: a.id,
            },
          },
          create: { siteAccountId: id, remoteAccountId: a.id, ...data },
          update: data,
        });
      }),
      prisma.siteBoundAccount.deleteMany({
        where: {
          siteAccountId: id,
          remoteAccountId: { notIn: seen.length ? seen : [-1] },
        },
      }),
    ]);

    await usersTask.catch((e) =>
      console.error(`[refresh site #${id}] users sync error:`, e),
    );

    await prisma.siteAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.siteAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncError: msg.slice(0, 500) },
    });
    throw e;
  }
}

// =============================================================
// FAST usage-only sync — uses stored remote IDs, only hits the
// today-stats / api-keys-usage endpoints. This is what the
// scheduler runs every few minutes.
// If the local table is empty (never refreshed), falls through
// to a full refresh automatically.
// =============================================================

export async function syncUpstreamAccount(id: number): Promise<void> {
  const t0 = Date.now();
  const acc = await prisma.upstreamAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("upstream account not found");

  const localKeys = await prisma.upstreamKey.findMany({
    where: { upstreamAccountId: id },
    select: {
      id: true,
      remoteKeyId: true,
      todayActualCost: true,
      costAtRateChange: true,
    },
  });
  if (localKeys.length === 0) {
    return refreshUpstreamAccount(id);
  }

  const client = makeUpstreamClient(acc);
  try {
    const remoteIds = localKeys.map((k) => k.remoteKeyId);
    const tApi = Date.now();
    const [usage, me] = await Promise.all([
      client.getKeysUsage(remoteIds),
      client.getMe().catch(() => null),
    ]);
    const apiMs = Date.now() - tApi;
    const tDb = Date.now();
    const now = new Date();
    await prisma.$transaction(
      localKeys.map((k) => {
        const u = usage[String(k.remoteKeyId)] || {
          today_actual_cost: 0,
          total_actual_cost: 0,
        };
        // Day rolled over → today_actual_cost dropped → snapshot is stale.
        const dropped = u.today_actual_cost < (k.todayActualCost ?? 0) - 0.01;
        const clearSnapshot =
          dropped && k.costAtRateChange != null
            ? {
                previousEffectiveRateMultiplier: null,
                costAtRateChange: null,
                rateChangedAt: null,
              }
            : {};
        return prisma.upstreamKey.update({
          where: { id: k.id },
          data: {
            todayActualCost: u.today_actual_cost,
            totalActualCost: u.total_actual_cost,
            lastUpdatedAt: now,
            ...clearSnapshot,
          },
        });
      }),
    );
    await prisma.upstreamAccount.update({
      where: { id },
      data: {
        lastSyncAt: now,
        lastSyncError: null,
        ...(me != null
          ? { balance: me.balance, balanceUpdatedAt: now }
          : {}),
      },
    });
    const dbMs = Date.now() - tDb;
    console.log(
      `[sync up #${id} ${acc.name}] api=${apiMs}ms db=${dbMs}ms total=${
        Date.now() - t0
      }ms keys=${localKeys.length}`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sync up #${id} ${acc.name}] FAIL`, msg);
    await prisma.upstreamAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncError: msg.slice(0, 500) },
    });
    throw e;
  }
}

export async function syncSiteAccount(id: number): Promise<void> {
  const t0 = Date.now();
  const acc = await prisma.siteAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("site account not found");

  const localAccounts = await prisma.siteBoundAccount.findMany({
    where: { siteAccountId: id },
    select: { id: true, remoteAccountId: true },
  });
  if (localAccounts.length === 0) {
    return refreshSiteAccount(id);
  }

  const client = makeSiteClient(acc);
  try {
    const remoteIds = localAccounts.map((a) => a.remoteAccountId);
    const tApi = Date.now();
    const [stats] = await Promise.all([
      client.getAccountsStats(remoteIds),
      syncSiteUsersFor(id, client).catch((e) =>
        console.error(`[sync site #${id}] users sync error:`, e),
      ),
    ]);
    const apiMs = Date.now() - tApi;
    const tDb = Date.now();
    const now = new Date();
    await prisma.$transaction(
      localAccounts.map((a) => {
        const s = stats[String(a.remoteAccountId)] || {
          requests: 0,
          tokens: 0,
          cost: 0,
          standard_cost: 0,
          user_cost: 0,
        };
        return prisma.siteBoundAccount.update({
          where: { id: a.id },
          data: {
            todayRequests: s.requests,
            todayTokens: BigInt(s.tokens || 0),
            todayCost: s.cost,
            todayStandardCost: s.standard_cost,
            todayUserCost: s.user_cost,
            lastUpdatedAt: now,
          },
        });
      }),
    );
    await prisma.siteAccount.update({
      where: { id },
      data: { lastSyncAt: now, lastSyncError: null },
    });
    const dbMs = Date.now() - tDb;
    console.log(
      `[sync site #${id} ${acc.name}] api=${apiMs}ms db=${dbMs}ms total=${
        Date.now() - t0
      }ms accounts=${localAccounts.length}`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sync site #${id} ${acc.name}] FAIL`, msg);
    await prisma.siteAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncError: msg.slice(0, 500) },
    });
    throw e;
  }
}

// =============================================================
// Aggregate runners
// =============================================================

export interface SyncAllResult {
  upstream: { id: number; name: string; ok: boolean; error?: string }[];
  site: { id: number; name: string; ok: boolean; error?: string }[];
}

function shanghaiDateString(d: Date = new Date()): string {
  // Returns YYYY-MM-DD for Asia/Shanghai. en-CA gives ISO-like format.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function recordSnapshot(): Promise<void> {
  try {
    const s = await getDashboardSummary();
    await prisma.snapshot.create({
      data: {
        totalRevenue: s.totalRevenue,
        totalExpense: s.totalExpense,
        totalProfit: s.totalProfit,
        totalSiteCostBase: s.totalSiteCostBase,
        totalUpstreamCostBase: s.totalUpstreamCostBase,
        totalDiff: s.totalDiff,
        upstreamKeyCount: s.upstreamKeyCount,
        siteBoundCount: s.siteBoundAccountCount,
        bindingCount: s.bindingCount,
      },
    });
    const tooMany = await prisma.snapshot.count();
    if (tooMany > 720) {
      const cut = await prisma.snapshot.findMany({
        orderBy: { takenAt: "asc" },
        take: tooMany - 720,
        select: { id: true },
      });
      await prisma.snapshot.deleteMany({
        where: { id: { in: cut.map((c) => c.id) } },
      });
    }

    // Upsert today's row in DailyProfit. Refreshes during the day; once
    // the calendar date rolls over (Asia/Shanghai), next sync will create
    // a new row and yesterday's frozen at its last-captured value.
    const today = shanghaiDateString();
    const profitData = {
      revenue: s.totalRevenue,
      expense: s.totalExpense,
      profit: s.totalProfit,
      siteCostBase: s.totalSiteCostBase,
      upstreamCostBase: s.totalUpstreamCostBase,
      diff: s.totalDiff,
    };
    await prisma.dailyProfit.upsert({
      where: { date: today },
      create: { date: today, ...profitData },
      update: profitData,
    });

    // Per-key/per-account snapshot for today — so any historical view stays
    // populated even if the upstream goes offline later. Failures are logged
    // but don't break the sync (DailyProfit row already written).
    try {
      await persistTodayBreakdown();
    } catch (e) {
      console.error("[snapshot] persistTodayBreakdown failed:", e);
    }

    // Trigger email alert if diff exceeds threshold (cooldown enforced inside)
    await maybeSendDiffAlert(s);
  } catch (e) {
    console.error("[snapshot] record failed:", e);
  }
}

async function runAll(
  fn: (id: number) => Promise<void>,
  list: { id: number; name: string }[],
) {
  return Promise.all(
    list.map(async (a) => {
      try {
        await fn(a.id);
        return { id: a.id, name: a.name, ok: true } as const;
      } catch (e: unknown) {
        return {
          id: a.id,
          name: a.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } as const;
      }
    }),
  );
}

// Poll the sub2api `snapshot-v2` per sub2api site for the last 1h, then
// hand it to the mailer to decide whether the configured threshold is
// breached. Best-effort: per-site failures don't block the others, and
// the whole step never throws.
async function pollAndAlertErrorRates() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.errorRateAlertEnabled) return;
  const sites = await prisma.siteAccount.findMany({
    where: { type: "sub2api" },
    select: { id: true, name: true },
  });
  const rows: SiteErrorSnapshot[] = [];
  for (const s of sites) {
    try {
      const client = await makeSiteClientById(s.id);
      const snap = await client.getOpsSnapshot({ timeRange: "1h" });
      rows.push({
        siteId: s.id,
        siteName: s.name,
        errorRate: snap.overview.error_rate ?? 0,
        upstreamErrorRate: snap.overview.upstream_error_rate ?? 0,
        requestCountTotal: snap.overview.request_count_total ?? 0,
        errorCountTotal: snap.overview.error_count_total ?? 0,
        successCount: snap.overview.success_count ?? 0,
        sla: snap.overview.sla ?? 0,
        generatedAt: snap.generated_at,
      });
    } catch (e) {
      console.warn(
        `[errorRateAlert] snapshot fetch failed for site ${s.id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (rows.length > 0) await maybeSendErrorRateAlert(rows);
}

export async function syncAll(): Promise<SyncAllResult> {
  const t0 = Date.now();
  const [ups, sites] = await Promise.all([
    prisma.upstreamAccount.findMany({ select: { id: true, name: true } }),
    prisma.siteAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const tBatch = Date.now();
  const [upRes, siteRes] = await Promise.all([
    runAll(syncUpstreamAccount, ups),
    runAll(syncSiteAccount, sites),
  ]);
  const batchMs = Date.now() - tBatch;
  const tSnap = Date.now();
  await recordSnapshot();
  const snapMs = Date.now() - tSnap;
  // Error-rate alert lives outside recordSnapshot because it queries a
  // different sub2api endpoint and a separate threshold/cooldown.
  pollAndAlertErrorRates().catch((e) =>
    console.error("[errorRateAlert] poll failed:", e),
  );
  console.log(
    `[syncAll] up=${ups.length} site=${sites.length} batch=${batchMs}ms snapshot=${snapMs}ms total=${
      Date.now() - t0
    }ms`,
  );
  return { upstream: upRes, site: siteRes };
}

export async function refreshAll(): Promise<SyncAllResult> {
  const [ups, sites] = await Promise.all([
    prisma.upstreamAccount.findMany({ select: { id: true, name: true } }),
    prisma.siteAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const [upRes, siteRes] = await Promise.all([
    runAll(refreshUpstreamAccount, ups),
    runAll(refreshSiteAccount, sites),
  ]);
  await recordSnapshot();
  return { upstream: upRes, site: siteRes };
}

// Upstream-only refresh + sync. Used by the 渠道管理 page's
// "一键刷新同步" header button. We do refresh first (pull structure /
// keys list) then sync (today's usage) so the synced cost lines up with
// the freshly imported keys, with no race vs an in-flight scheduler tick.
export async function refreshAndSyncAllUpstream(): Promise<{
  refresh: { id: number; name: string; ok: boolean; error?: string }[];
  sync: { id: number; name: string; ok: boolean; error?: string }[];
}> {
  const ups = await prisma.upstreamAccount.findMany({
    select: { id: true, name: true },
  });
  const refreshRes = await runAll(refreshUpstreamAccount, ups);
  const syncRes = await runAll(syncUpstreamAccount, ups);
  return { refresh: refreshRes, sync: syncRes };
}
