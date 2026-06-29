"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RpmStatus = {
  user_rpm_used?: number;
  user_rpm_limit?: number;
  per_group?: Array<{
    group_id: number;
    group_name?: string;
    used: number;
    limit?: number;
    source?: string;
  }>;
};

export function TopUsersPanel({
  userConc,
  siteId,
}: {
  userConc: {
    enabled: boolean;
    user: Record<
      string,
      {
        user_id: number;
        user_email?: string;
        username?: string;
        current_in_use: number;
        max_capacity?: number;
      }
    >;
  } | null;
  siteId: number | null;
}) {
  const [topN, setTopN] = useState<number>(3);
  const [topGroups, setTopGroups] = useState<number>(3);

  useEffect(() => {
    try {
      const rawN = localStorage.getItem("scheduling.topUsersN");
      const n = Number(rawN);
      if (Number.isFinite(n) && n >= 1 && n <= 20) setTopN(n);
      const rawG = localStorage.getItem("scheduling.topGroupsPerUser");
      const g = Number(rawG);
      if (Number.isFinite(g) && g >= 1 && g <= 20) setTopGroups(g);
    } catch {
      // ignore
    }
  }, []);

  function persistTopN(n: number) {
    setTopN(n);
    try {
      localStorage.setItem("scheduling.topUsersN", String(n));
    } catch {
      // ignore
    }
  }

  function persistTopGroups(g: number) {
    setTopGroups(g);
    try {
      localStorage.setItem("scheduling.topGroupsPerUser", String(g));
    } catch {
      // ignore
    }
  }

  const [rpmByUser, setRpmByUser] = useState<Record<string, RpmStatus>>({});

  // Pseudo sliding window: sub2api stores RPM in per-minute buckets that
  // reset at minute boundaries. We track the last observed value per
  // (user, group) and when a drop is detected (minute rollover) we stash
  // the pre-rollover final value. Display linearly blends:
  //   displayed = current_partial + prev_final * (60 - sec_into_minute) / 60
  const rollingRef = useRef<
    Map<string, { lastValue: number; prevMinuteFinal: number }>
  >(new Map());

  function getSlidingValue(key: string, raw: number): number {
    const r = rollingRef.current.get(key);
    if (!r) return raw;
    const sec = Math.floor(Date.now() / 1000) % 60;
    const decay = (60 - sec) / 60;
    return Math.round(r.lastValue + r.prevMinuteFinal * decay);
  }

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

  // Top-N users sorted by current_in_use descending, filtering out zeros.
  const top = useMemo(() => {
    if (!userConc) return [];
    return Object.values(userConc.user)
      .filter((u) => (u.current_in_use ?? 0) > 0)
      .sort((a, b) => b.current_in_use - a.current_in_use)
      .slice(0, topN);
  }, [userConc, topN]);

  // Poll per-user RPM status in sync with user-concurrency (same 2s tick).
  // Use idsKey as dependency to avoid re-triggering when the array identity
  // changes but the values are the same.
  const idsKey = top.map((u) => u.user_id).join(",");
  useEffect(() => {
    if (siteId == null || !idsKey) {
      setRpmByUser({});
      return;
    }
    let canceled = false;
    fetch(
      `/api/scheduling/${siteId}/user-rpm-status?userIds=${idsKey}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (canceled) return;
        const status = (j.status ?? {}) as Record<string, RpmStatus>;
        for (const [uid, rpm] of Object.entries(status)) {
          for (const g of rpm.per_group ?? []) {
            recordRolling(`${uid}:${g.group_id}`, g.used);
          }
        }
        setRpmByUser(status);
      })
      .catch(() => {
        // soft-fail; next poll will retry
      });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, idsKey, userConc]);

  if (!userConc) {
    return (
      <div className="mb-5 text-xs text-muted-foreground/70">
        加载用户并发中…
      </div>
    );
  }
  if (!userConc.enabled) {
    return (
      <div className="mb-5 text-xs text-muted-foreground/70">
        sub2api 未开启实时监控（settings 里打开 realtime monitoring 即可显示用户并发）
      </div>
    );
  }

  const header = (
    <CardHeader className="pb-1 pt-3 flex flex-row items-center justify-between flex-wrap gap-2 space-y-0">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-muted-foreground" />
        <span className="font-semibold text-sm">用户实时并发</span>
        <span className="text-[11px] text-muted-foreground/70">每 2 秒刷新</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">用户前</span>
          <Input
            type="number"
            className="w-16 h-7"
            value={String(topN)}
            min={1}
            max={20}
            onChange={(e) => {
              const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
              persistTopN(n);
            }}
          />
          <span className="text-[11px] text-muted-foreground">个</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">每人显示</span>
          <Input
            type="number"
            className="w-16 h-7"
            value={String(topGroups)}
            min={1}
            max={20}
            onChange={(e) => {
              const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
              persistTopGroups(n);
            }}
          />
          <span className="text-[11px] text-muted-foreground">个分组</span>
        </div>
      </div>
    </CardHeader>
  );

  if (top.length === 0) {
    return (
      <Card className="mb-5 rounded-lg border border-border shadow-none">
        {header}
        <CardContent className="pt-1 pb-3 text-xs text-muted-foreground">
          当前没有用户有 in-flight 请求
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-5 rounded-lg border border-border shadow-none">
      {header}
      <CardContent className="pt-1 pb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {top.map((u) => {
            const name = u.username || u.user_email || `用户 #${u.user_id}`;
            const cap = u.max_capacity ?? 0;
            const concPct =
              cap > 0
                ? Math.min(100, Math.round((u.current_in_use / cap) * 100))
                : 0;
            const concBar =
              concPct >= 90
                ? "bg-destructive"
                : concPct >= 70
                  ? "bg-amber-500"
                  : "bg-primary";
            const rpm = rpmByUser[String(u.user_id)];
            const perGroup = [...(rpm?.per_group ?? [])]
              .map((g) => ({
                ...g,
                slidingUsed: getSlidingValue(
                  `${u.user_id}:${g.group_id}`,
                  g.used,
                ),
              }))
              .sort(
                (a, b) =>
                  b.slidingUsed - a.slidingUsed ||
                  (b.limit ?? 0) - (a.limit ?? 0) ||
                  a.group_id - b.group_id,
              )
              .slice(0, topGroups);
            return (
              <div
                key={u.user_id}
                className="rounded-md border border-border/60 bg-muted/30 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-sm font-medium truncate"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-xs tabular-nums shrink-0">
                    {u.current_in_use}
                    {cap > 0 && (
                      <span className="text-muted-foreground/70"> / {cap}</span>
                    )}
                  </span>
                </div>
                {cap > 0 && (
                  <div className="mt-1 h-1.5 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${concBar}`}
                      style={{ width: `${concPct}%` }}
                    />
                  </div>
                )}
                <div className="mt-2 flex flex-col gap-0.5">
                  {perGroup.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground/70">
                      {rpm ? "该用户暂无分组配置" : "加载中…"}
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
                            <span className="text-muted-foreground/70">
                              {" "}
                              / {g.limit}
                            </span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
