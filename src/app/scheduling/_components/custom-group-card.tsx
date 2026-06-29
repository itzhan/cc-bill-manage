"use client";

import { Layers, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fmtMoneyShort } from "@/lib/format";
import {
  type AccountRow,
  type GroupRow,
  type ConcurrencyState,
} from "../_types";

interface CustomGroupRow {
  id: number;
  siteAccountId: number;
  name: string;
  groupIds: number[];
}

interface CustomGroupCardProps {
  customGroup: CustomGroupRow;
  siteId: number | null;
  groups: GroupRow[];
  accounts: AccountRow[];
  concurrency: ConcurrencyState;
  accountStats: Record<
    string,
    { requests: number; cost: number; user_cost: number }
  >;
  onSmartDispatch: (groupIds: number[], label: string) => void;
}

export function CustomGroupCard({
  customGroup,
  siteId,
  groups,
  accounts,
  concurrency,
  accountStats,
  onSmartDispatch,
}: CustomGroupCardProps) {
  const memberSet = new Set(customGroup.groupIds);
  const memberGroups = groups.filter((g) => memberSet.has(g.id));

  // Union of accounts that belong to ANY member group, deduped by id.
  const seen = new Set<number>();
  const memberAccounts: AccountRow[] = [];
  for (const a of accounts) {
    const inAny = (a.group_ids ?? []).some((id) => memberSet.has(id));
    if (!inAny) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    memberAccounts.push(a);
  }

  // Stats roll-up.
  let inFlight = 0;
  let capacity = 0;
  let todayCost = 0;
  let activeCount = 0;
  let errCount = 0;
  for (const a of memberAccounts) {
    const conc = concurrency.account?.[String(a.id)];
    if (conc) {
      inFlight += conc.current_in_use ?? 0;
      capacity += conc.max_capacity ?? 0;
    } else {
      capacity += a.concurrency ?? 0;
    }
    todayCost += accountStats[String(a.id)]?.user_cost ?? 0;
    if (a.status === "active" && a.schedulable !== false) activeCount++;
    if (
      a.status === "error" ||
      (typeof a.error_message === "string" && a.error_message.trim().length > 0)
    )
      errCount++;
  }
  const pct =
    capacity > 0 ? Math.min(100, Math.round((inFlight / capacity) * 100)) : 0;
  const barColor =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
        ? "bg-amber-500"
        : "bg-primary";

  return (
    <Card className="rounded-lg border border-primary/30 shadow-none">
      <CardHeader className="flex flex-col items-stretch gap-2 pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers size={14} className="text-primary" />
            <h3 className="font-semibold">{customGroup.name}</h3>
            <Badge variant="default" className="text-[11px] px-1.5 py-0">
              {memberGroups.length} 个分组
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            {todayCost > 0 && (
              <span className="text-foreground font-medium">
                ${fmtMoneyShort(todayCost)}
              </span>
            )}
            {memberAccounts.length} 渠道
            {errCount > 0 && (
              <Badge variant="destructive" className="text-[11px] px-1.5 py-0">
                {errCount} 异常
              </Badge>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {memberGroups.map((g) => (
            <Badge
              key={g.id}
              variant="secondary"
              className="h-5 text-[11px] px-1.5 py-0"
            >
              {g.name} ×{g.rate_multiplier}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-foreground">
            {inFlight} / {capacity || "∞"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 gap-1 flex flex-col">
        <div className="text-xs text-muted-foreground">
          已启用 {activeCount} / {memberAccounts.length}（合并去重，跨分组同账号只算一次）
        </div>
        {siteId != null && (
          <button
            type="button"
            onClick={() =>
              onSmartDispatch(customGroup.groupIds, customGroup.name)
            }
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline self-start"
          >
            <Sparkles size={12} />
            智能调度
          </button>
        )}
      </CardContent>
    </Card>
  );
}
