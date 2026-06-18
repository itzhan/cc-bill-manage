"use client";
import { use, useEffect, useRef, useState } from "react";
import { Card, CardBody, CardHeader, Chip, Spinner } from "@heroui/react";
import { Activity, Users } from "lucide-react";
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

  // 启动 / 卸载时管理 2s 轮询。404 不重试。
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
        if (aliveRef.current) setStats(j);
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
          <CardBody className="text-center p-8">
            <p className="text-lg font-semibold mb-2">无法访问</p>
            <p className="text-sm text-default-500">{error}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
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
              <p className="text-sm text-default-500 mt-1">
                {config.siteName} · 实时监控面板
              </p>
            </div>
            <Chip size="sm" variant="flat" color="success">
              每 2 秒刷新
            </Chip>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatBox
            label="当前 RPM"
            value={stats ? stats.site.rpm.toLocaleString() : "—"}
            accent="primary"
          />
          <StatBox
            label="当前 TPM"
            value={stats ? stats.site.tpm.toLocaleString() : "—"}
            accent="success"
          />
        </div>

        {config.users.length === 0 ? (
          <Card>
            <CardBody className="text-default-500 text-center p-8">
              该链接尚未配置可展示的用户
            </CardBody>
          </Card>
        ) : (
          <Card className="shadow-none border border-divider/50">
            <CardHeader className="flex items-center gap-2 pb-1 pt-3">
              <Users size={16} className="text-default-500" />
              <span className="font-semibold text-sm">用户实时状态</span>
              <span className="text-[11px] text-default-400">
                共 {config.users.length} 个用户
              </span>
            </CardHeader>
            <CardBody className="pt-2">
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
                      ? "bg-danger"
                      : concPct >= 70
                        ? "bg-warning"
                        : "bg-primary";
                  const perGroup = [...(rpm?.per_group ?? [])].sort(
                    (a, b) =>
                      b.used - a.used ||
                      (b.limit ?? 0) - (a.limit ?? 0) ||
                      a.group_id - b.group_id,
                  );
                  return (
                    <div
                      key={u.id}
                      className="rounded-md border border-divider/60 bg-content2/30 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className="text-sm font-medium truncate"
                          title={u.name}
                        >
                          {u.name}
                        </span>
                        <span className="text-xs tabular-nums shrink-0">
                          <Activity
                            size={11}
                            className="inline mr-0.5 text-default-400"
                          />
                          {used}
                          {cap > 0 && (
                            <span className="text-default-400"> / {cap}</span>
                          )}
                        </span>
                      </div>
                      {cap > 0 && (
                        <div className="mb-2 h-1.5 rounded bg-default-100 overflow-hidden">
                          <div
                            className={`h-full ${concBar}`}
                            style={{ width: `${concPct}%` }}
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 mb-2">
                        {perGroup.length === 0 ? (
                          <span className="text-[11px] text-default-400">
                            {rpm ? "暂无可见分组" : "加载中…"}
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
                              <span className="tabular-nums text-default-500 shrink-0 ml-2">
                                {g.used}
                                {g.limit != null && g.limit > 0 && (
                                  <span className="text-default-400">
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
                        <div className="border-t border-divider/50 pt-2 grid grid-cols-2 gap-1 text-[11px]">
                          <div>
                            <p className="text-default-400">今日消费</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.todayActualCost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-default-400">累计消费</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.effectiveConsumed)}
                            </p>
                          </div>
                          <div>
                            <p className="text-default-400">余额</p>
                            <p className="font-medium">
                              {fmtMoneyShort(acct.balance)}
                            </p>
                          </div>
                          <div>
                            <p className="text-default-400">总充值</p>
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
            </CardBody>
          </Card>
        )}

        <footer className="mt-8 text-center text-xs text-default-400">
          shareId · {config.shareId}
        </footer>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "primary" | "success";
}) {
  const ring =
    accent === "primary"
      ? "ring-primary/20 from-primary/10"
      : "ring-success/20 from-success/10";
  return (
    <div
      className={`rounded-xl bg-gradient-to-br ${ring} to-transparent ring-1 p-4`}
    >
      <p className="text-xs text-default-500">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
