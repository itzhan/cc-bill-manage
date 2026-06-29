"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fmtMoneyShort } from "@/lib/format";
import type { GroupUsersRow } from "../_types";

export default function GroupUsersView({
  rows,
  excludeList,
}: {
  rows: GroupUsersRow[];
  excludeList: string[];
}) {
  const visible = useMemo(() => {
    const filtered = rows.filter(
      (g) =>
        !excludeList.some((p) =>
          (g.group_name ?? "").toLowerCase().startsWith(p.toLowerCase()),
        ),
    );
    return filtered
      .map((g) => ({
        ...g,
        totalCost: g.users.reduce((s, u) => s + (u.actual_cost ?? 0), 0),
        totalRequests: g.users.reduce((s, u) => s + (u.requests ?? 0), 0),
      }))
      .filter((g) => g.users.length > 0)
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [rows, excludeList]);

  if (rows.length === 0) {
    return (
      <Card className="bg-card rounded-lg border border-border shadow-none">
        <CardContent className="p-4 text-muted-foreground text-sm">
          加载中…（首次加载会扫描所有分组的用户消费）
        </CardContent>
      </Card>
    );
  }
  if (visible.length === 0) {
    return (
      <Card className="bg-card rounded-lg border border-border shadow-none">
        <CardContent className="p-4 text-muted-foreground text-sm">
          没有今天有消费的分组。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {visible.map((g) => {
        const sorted = [...g.users].sort(
          (a, b) => (b.actual_cost ?? 0) - (a.actual_cost ?? 0),
        );
        const top = sorted[0]?.actual_cost ?? 0;
        return (
          <Card
            key={g.group_id}
            className="bg-card rounded-lg border border-border shadow-none"
          >
            <CardHeader className="flex flex-row justify-between items-start gap-2 pb-2">
              <div className="flex flex-col leading-tight min-w-0">
                <h3 className="font-semibold truncate">{g.group_name}</h3>
                <span className="text-xs text-muted-foreground/70">
                  {g.users.length} 个用户 ·{" "}
                  {g.totalRequests.toLocaleString()} req
                </span>
              </div>
              <span className="text-sm font-bold text-foreground">
                ${fmtMoneyShort(g.totalCost)}
              </span>
            </CardHeader>
            <CardContent className="pt-0 flex flex-col gap-1">
              {sorted.map((u) => {
                const pct =
                  top > 0
                    ? Math.min(100, Math.round((u.actual_cost / top) * 100))
                    : 0;
                return (
                  <div
                    key={u.user_id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {u.email ?? `user#${u.user_id}`}
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-muted-foreground text-[11px] shrink-0">
                      {u.requests.toLocaleString()} req
                    </span>
                    <span className="font-mono text-foreground shrink-0 w-16 text-right">
                      ${fmtMoneyShort(u.actual_cost)}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
