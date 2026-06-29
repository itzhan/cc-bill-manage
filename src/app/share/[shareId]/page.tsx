"use client";
import { use, useEffect, useRef, useState } from "react";
import { Activity, Loader2, Users } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtMoneyShort } from "@/lib/format";

interface ShareConfig {
  shareId: string;
  name: string;
  siteName: string;
  allowedUserIds: number[];
  allowedGroupIds: number[];
  users: Array<{ id: number; name: string }>;
}

interface UserRow {
  id: number;
  name: string;
  balance: number;
  totalRecharged: number;
  todayActualCost: number;
  todayCost: number;
  effectiveConsumed: number;
}

interface ConcRow {
  user_id: number;
  current_in_use: number;
  max_capacity?: number;
}

interface RpmRow {
  user_rpm_used?: number;
  user_rpm_limit?: number;
  per_group: Array<{
    group_id: number;
    group_name?: string;
    used: number;
    limit?: number;
  }>;
}

interface StatsResponse {
  site: { rpm: number; tpm: number };
  users: UserRow[];
  userConcurrency: Record<string, ConcRow>;
  userRpm: Record<string, RpmRow>;
}

export default function PublicSharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = use(params);
  const [config, setConfig] = useState<ShareConfig | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rollingRef = useRef<
    Map<string, { lastValue: number; prevMinuteFinal: number }>
  >(new Map());

  function recordRolling(key: string, cur: number) {
    const prev = rollingRef.current.get(key);
    if (prev && cur < prev.lastValue) {
      rollingRef.current.set(key, {
        lastValue: cur,
        prevMinuteFinal: prev.lastValue,
      });
    } else {
      rollingRef.current.set(key, {
        lastValue: cur,
        prevMinuteFinal: prev?.prevMinuteFinal ?? 0,
      });
    }
  }

  function getSlidingValue(key: string, raw: number): number {
    const r = rollingRef.current.get(key);
    if (!r) return raw;
    const sec = Math.floor(Date.now() / 1000) % 60;
    const decay = (60 - sec) / 60;
    return Math.round(r.lastValue + r.prevMinuteFinal * decay);
  }

  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tickConfig() {
      try {
        const r = await fetch(`/api/public/share/${shareId}`, {
          cache: "no-store",
        });
        if (r.status === 404) {
          setError("链接不存在或已被删除");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as ShareConfig;
        if (aliveRef.current) setConfig(j);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    async function tickStats() {
      try {
        const r = await fetch(`/api/public/share/${shareId}/stats`, {
          cache: "no-store",
        });
        if (r.status === 404) {
          setError("链接不存在或已被删除");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as StatsResponse;
        if (aliveRef.current) {
          for (const [uid, rpmRow] of Object.entries(j.userRpm)) {
            if (typeof rpmRow.user_rpm_used === "number") {
              recordRolling(`u:${uid}`, rpmRow.user_rpm_used);
            }
            for (const g of rpmRow.per_group ?? []) {
              recordRolling(`u:${uid}:g:${g.group_id}`, g.used);
            }
          }
          setStats(j);
        }
      } catch {
        // soft-fail; next tick will retry
      } finally {
        if (aliveRef.current) {
          timer = setTimeout(tickStats, 2000);
        }
      }
    }

    tickConfig();
    tickStats();
    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [shareId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="text-center p-8">
            <p className="text-lg font-semibold mb-2">无法访问</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const userMap = new Map<number, UserRow>();
  if (stats) for (const u of stats.users) userMap.set(u.id, u);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold">
                {config.name || config.siteName}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {config.siteName} · 实时监控面板
              </p>
            </div>
            <Badge variant="success">
              每 2 秒刷新
            </Badge>
          </div>
        </header>

        {config.users.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground text-center p-8">
              该链接尚未配置可展示的用户
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm border border-border">
            <CardHeader className="flex flex-row items-center gap-2 pb-1 pt-3">
              <Users size={16} className="text-muted-foreground" />
              <span className="font-semibold text-sm">用户实时状态</span>
              <span className="text-[11px] text-muted-foreground">
                共 {config.users.length} 个用户
              </span>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {config.users.map((u) => {
                  const conc = stats?.userConcurrency[String(u.id)];
                  const rpm = stats?.userRpm[String(u.id)];
                  const acct = userMap.get(u.id);
                  const cap = conc?.max_capacity ?? 0;
                  const used = conc?.current_in_use ?? 0;
                  const concPct =
                    cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
                  const concBar =
                    concPct >= 90
                      ? "bg-destructive"
                      : concPct >= 70
                        ? "bg-amber-500"
                        : "bg-primary";
                  const perGroup = [...(rpm?.per_group ?? [])]
                    .map((g) => ({
                      ...g,
                      slidingUsed: getSlidingValue(
                        `u:${u.id}:g:${g.group_id}`,
                        g.used,
                      ),
                    }))
                    .sort(
                      (a, b) =>
                        b.slidingUsed - a.slidingUsed ||
                        (b.limit ?? 0) - (a.limit ?? 0) ||
                        a.group_id - b.group_id,
                    );
                  const rpmUsed = getSlidingValue(
                    `u:${u.id}`,
                    rpm?.user_rpm_used ?? 0,
                  );
                  const rpmLimit = rpm?.user_rpm_limit ?? 0;
                  const rpmPct =
                    rpmLimit > 0
                      ? Math.min(100, Math.round((rpmUsed / rpmLimit) * 100))
                      : 0;
                  const rpmBar =
                    rpmPct >= 90
                      ? "bg-destructive"
                      : rpmPct >= 70
                        ? "bg-amber-500"
                        : "bg-emerald-500";
                  return (
                    <div
                      key={u.id}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className="text-sm font-medium truncate"
                          title={u.name}
                        >
                          {u.name}
                        </span>
                        <span className="text-xs tabular-nums shrink-0 text-muted-foreground">
                          <Activity
                            size={11}
                            className="inline mr-0.5 text-muted-foreground"
                          />
                          {used}
                          {cap > 0 && (
                            <span className="text-muted-foreground"> / {cap}</span>
                          )}
                        </span>
                      </div>

                      <div className="mb-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground">
                            当前 RPM
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {rpmLimit > 0 ? `${rpmPct}%` : ""}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-2xl font-bold tabular-nums">
                            {rpmUsed.toLocaleString()}
                          </span>
                          {rpmLimit > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              / {rpmLimit.toLocaleString()}
                            </span>
                          )}
                        </div>
                        {rpmLimit > 0 && (
                          <div className="mt-1.5 h-1 rounded bg-muted overflow-hidden">
                            <div
                              className={`h-full ${rpmBar}`}
                              style={{ width: `${rpmPct}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {cap > 0 && (
                        <>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                            <span>并发</span>
                            <span className="tabular-nums">
                              {used} / {cap}
                            </span>
                          </div>
                          <div className="mb-2 h-1.5 rounded bg-muted overflow-hidden">
                            <div
                              className={`h-full ${concBar}`}
                              style={{ width: `${concPct}%` }}
                            />
                          </div>
                        </>
                      )}
                      <div className="flex flex-col gap-0.5 mb-2">
                        <p className="text-[11px] text-muted-foreground mb-0.5">
                          分组 RPM
                        </p>
                        {perGroup.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground">
                            {rpm ? "暂无可见分组" : "加载中..."}
                          </span>
                        ) : (
                          perGroup.map((g) => (
                            <div
                              key={g.group_id}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <span
                                className="truncate"
                                title={g.group_name || `#${g.group_id}`}
                              >
                                {g.group_name || `#${g.group_id}`}
                              </span>
                              <span className="tabular-nums text-muted-foreground shrink-0 ml-2">
                                {g.slidingUsed}
                                {g.limit != null && g.limit > 0 && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    / {g.limit}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                      {acct && (
                        <div className="border-t border-border pt-2 grid grid-cols-2 gap-1 text-[11px]">
                          <div>
                            <p className="text-muted-foreground">今日消费</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.todayActualCost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">累计消费</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.effectiveConsumed)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">余额</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.balance)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">总充值</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.totalRecharged)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          shareId · {config.shareId}
        </footer>
      </div>
    </div>
  );
}
