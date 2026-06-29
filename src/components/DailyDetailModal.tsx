"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtMoneyShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PairedRow {
  rowKey: string;
  kind: "paired" | "unbound_site" | "unbound_upstream";
  label: string;
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
  revenue: number;
  revenueSynced?: number;
  revenueIsManual?: boolean;
  expense: number;
  expenseSynced?: number;
  expenseIsManual?: boolean;
  expenseSource?:
    | "synced"
    | "manual"
    | "rule"
    | "account_fixed"
    | "site_1x"; // 兜底:没人设过支出 → 用 site 1×
  expenseRulePrefix?: string;
  // 此 site 本来有 active binding, 但对应 upstream 当日 0 流量 → binding 异常
  bindingMismatch?: {
    upstreamKeyId: number;
    upstreamKeyName: string;
    upstreamAccountName: string;
  };
  siteCostBase: number;
  siteCostBaseSynced?: number;
  siteCostBaseIsManual?: boolean;
  upstreamCostBase: number;
  upstreamCostBaseSynced?: number;
  upstreamCostBaseIsManual?: boolean;
  diff: number;
  profit: number;
}

interface Breakdown {
  date: string;
  paired: PairedRow[];
  totals: {
    revenue: number;
    expense: number;
    profit: number;
    siteCostBase: number;
    upstreamCostBase: number;
    diff: number;
  };
  errors: { date: string; kind: "site" | "upstream"; id: number; error: string }[];
  fromCache?: boolean;
  cachedAt?: string;
}

export default function DailyDetailModal({
  date,
  isOpen,
  onOpenChange,
}: {
  date: string | null;
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"paired" | "unbound">("paired");
  const [showRules, setShowRules] = useState(false);
  const [showScanFix, setShowScanFix] = useState(false);
  // 把孤立 upstream key 归属给一个 site 账号 — 创建一条历史 binding 覆盖那天。
  const [attachTarget, setAttachTarget] = useState<PairedRow | null>(null);

  // 未绑定 site 账号视图：只看 kind=unbound_site，按收入 (actualCost = revenue)
  // 倒序——花得多的排前面，方便优先去绑定补全利润计算。
  const unboundRows = useMemo(() => {
    if (!data) return [];
    return data.paired
      .filter((r) => r.kind === "unbound_site")
      .filter((r) => r.revenue > 0 || r.siteCostBase > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [data]);
  const unboundTotal = useMemo(
    () => unboundRows.reduce((s, r) => s + r.revenue, 0),
    [unboundRows],
  );

  const reload = () => load(false);

  // 一键把这行的"本站 1×" 和 "上游 1×" 都置为 0 — 走 manualCost (per-day,
  // 不影响其他日期)。paired 行两边都置;unbound_site 只置 site, unbound_upstream
  // 只置 upstream。
  async function zeroBoth1x(row: PairedRow) {
    if (!date) return;
    if (!confirm("把这一行的本站 1× 和上游 1× 都设成 0?(仅当日生效)")) return;
    const tasks: Array<Promise<Response>> = [];
    if (row.siteAccounts && row.siteAccounts.length === 1) {
      const sid = row.siteAccounts[0].siteBoundAccountId;
      tasks.push(
        fetch(`/api/daily-profit/${date}/breakdown/site/${sid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manualCost: 0 }),
        }),
      );
    }
    if (row.upstreamKeyId != null) {
      tasks.push(
        fetch(
          `/api/daily-profit/${date}/breakdown/upstream/${row.upstreamKeyId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manualCost: 0 }),
          },
        ),
      );
    }
    if (tasks.length === 0) {
      toast.warning("无可清零字段");
      return;
    }
    const results = await Promise.all(tasks);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      toast.warning("部分失败");
    } else {
      toast.success("已置 0");
    }
    reload();
  }

  async function load(forceRefresh: boolean) {
    if (!date) return;
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setErr(null);
    try {
      const url = `/api/daily-profit/${date}/breakdown${forceRefresh ? "?refresh=1" : ""}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      const j = (await r.json()) as Breakdown;
      setData(j);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !date) {
      setData(null);
      setErr(null);
      return;
    }
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, date]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="flex flex-col items-start gap-1 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>每日明细 · {date}</span>
            {data && (
              <span
                className={
                  data.totals.profit >= 0
                    ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                    : "text-destructive font-semibold"
                }
              >
                利润 {fmtMoneyShort(data.totals.profit)}
              </span>
            )}
          </DialogTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              disabled={refreshing}
              onClick={() => load(true)}
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw size={14} className="mr-1" />
              )}
              重新从上游拉取
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowRules(true)}
            >
              支出规则
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-amber-600 dark:text-amber-400"
              onClick={() => setShowScanFix(true)}
            >
              扫描修复孤立支出
            </Button>
          </div>
          <DialogDescription className="text-xs font-normal">
            按 key 配对的当日明细，按利润降序。橙色行 = 无 upstream 绑定（如 AZ 渠道）。
            数据默认从本地存档读取，点&quot;重新从上游拉取&quot;可强制重抓。
          </DialogDescription>
          {data?.fromCache && (
            <Badge variant="secondary" className="rounded-full">
              📦 本地存档
              {data.cachedAt &&
                ` · ${new Date(data.cachedAt).toLocaleString("zh-CN")}`}
            </Badge>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading && (
            <div className="flex justify-center items-center gap-2 p-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">加载明细中</span>
            </div>
          )}
          {err && <div className="text-destructive text-sm py-3">{err}</div>}
          {data && (
            <>
              <TotalsCard b={data} />

              {data.errors.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 my-3 text-sm">
                  <div className="font-medium text-destructive mb-1">
                    {data.errors.length} 个抓取错误（该行数据可能不全）
                  </div>
                  <ul className="text-xs text-destructive/80 space-y-0.5 max-h-32 overflow-auto">
                    {data.errors.map((e, i) => (
                      <li key={i}>
                        {e.kind}#{e.id}: {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Tabs
                className="mt-3"
                value={view}
                onValueChange={(v) =>
                  setView(v as "paired" | "unbound")
                }
              >
                <TabsList className="h-9">
                  <TabsTrigger value="paired">
                    <span className="flex items-center gap-1.5">
                      逐 key 利润
                      <Badge variant="secondary" className="rounded-full h-5 px-1.5 text-[10px]">
                        {data.paired.length}
                      </Badge>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="unbound">
                    <span className="flex items-center gap-1.5">
                      未绑定账号
                      <Badge
                        variant={unboundRows.length > 0 ? "warning" : "secondary"}
                        className="rounded-full h-5 px-1.5 text-[10px]"
                      >
                        {unboundRows.length}
                      </Badge>
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {view === "unbound" ? (
                <section className="mt-2">
                  <p className="text-[11px] text-muted-foreground mb-2">
                    当天有使用但<b>未绑定 upstream key</b> 的 site 账号，按收入降序排。
                    这些账号的支出不在利润计算里——绑定后才能算出真实利润。
                    共 {unboundRows.length} 个，今日收入合计{" "}
                    <b>{fmtMoneyShort(unboundTotal)}</b>。
                  </p>
                  {unboundRows.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      没有未绑定账号 — 当天所有使用过的账号都已正确配对
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>账号</TableHead>
                          <TableHead>所属站点</TableHead>
                          <TableHead>倍率</TableHead>
                          <TableHead>1× 成本</TableHead>
                          <TableHead>今日收入</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unboundRows.map((r) => {
                          const sa = r.siteAccounts?.[0];
                          return (
                            <TableRow
                              key={r.rowKey}
                              className="bg-amber-50/40 dark:bg-amber-950/20"
                            >
                              <TableCell>
                                <span className="font-medium text-sm">
                                  {sa?.accountName ?? r.label}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-muted-foreground">
                                  {sa?.siteAccountName ?? "—"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm tabular-nums">
                                  {sa
                                    ? `×${sa.rateMultiplier.toFixed(2)}`
                                    : "—"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums"
                                  title={fmtMoney(r.siteCostBase)}
                                >
                                  {fmtMoneyShort(r.siteCostBase)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums font-semibold text-amber-600 dark:text-amber-400"
                                  title={fmtMoney(r.revenue)}
                                >
                                  {fmtMoneyShort(r.revenue)}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </section>
              ) : (
                <section className="mt-2">
                  <p className="text-[11px] text-muted-foreground/70 mb-2">
                    按利润降序 · 当天 0 流量已隐藏 · 橙色行 = 未绑定 upstream
                  </p>
                {data.paired.length === 0 ? (
                  <p className="text-muted-foreground text-sm">当天无任何使用记录</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>名称</TableHead>
                        <TableHead>收入</TableHead>
                        <TableHead>支出</TableHead>
                        <TableHead>本站 1×</TableHead>
                        <TableHead>上游 1×</TableHead>
                        <TableHead>1× 差异</TableHead>
                        <TableHead>利润</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.paired.map((r) => {
                        const isUnbound = r.kind === "unbound_site";
                        const isOrphanUp = r.kind === "unbound_upstream";
                        const isBindingError = !!r.bindingMismatch;
                        const profitNet = r.revenue - r.expense - r.diff; // 第一行：扣 1× 差异
                        const profitGross = r.revenue - r.expense; // 第二行：粗利润
                        return (
                          <TableRow
                            key={r.rowKey}
                            className={
                              isBindingError
                                ? "bg-destructive/10 dark:bg-destructive/30"
                                : isUnbound && !r.expenseSource
                                  ? "bg-amber-50 dark:bg-amber-950/30"
                                  : isOrphanUp
                                    ? "bg-destructive/10 dark:bg-destructive/20"
                                    : ""
                            }
                          >
                            <TableCell>
                              <div className="flex flex-col leading-tight gap-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-sm">
                                    {r.label}
                                  </span>
                                  {r.groupName && (
                                    <Badge
                                      variant="secondary"
                                      className="rounded-full h-5 px-1.5 text-[10px]"
                                    >
                                      {r.groupName}
                                      {r.effectiveRate != null &&
                                        ` ×${r.effectiveRate.toFixed(2)}`}
                                    </Badge>
                                  )}
                                  {r.rechargeMultiplier != null &&
                                    r.rechargeMultiplier !== 1 && (
                                      <Badge
                                        variant="default"
                                        className="rounded-full h-5 px-1.5 text-[10px]"
                                      >
                                        充值 ×{r.rechargeMultiplier.toFixed(2)}
                                      </Badge>
                                    )}
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-5 min-w-0 px-1.5 text-[10px]"
                                    title="把本站 1× 和上游 1× 都置为 0(仅当日生效)"
                                    onClick={() => zeroBoth1x(r)}
                                  >
                                    1×→0
                                  </Button>
                                </div>
                                {isBindingError && r.bindingMismatch && (
                                  <span
                                    className="text-[10px] text-destructive font-medium"
                                    title={`此 site 绑定到 ${r.bindingMismatch.upstreamAccountName} / ${r.bindingMismatch.upstreamKeyName}, 但该 key 当日 0 流量。binding 可能指向了已轮换的新 key — 用上面"扫描修复孤立支出"找当日真正的 upstream。`}
                                  >
                                    ⚠ binding 异常:绑定的 upstream {r.bindingMismatch.upstreamKeyName} 当日无流量
                                  </span>
                                )}
                                {isUnbound && !isBindingError && !r.expenseSource && (
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                    ⚠ 未绑定 upstream（不计支出）
                                  </span>
                                )}
                                {isUnbound && r.expenseSource === "rule" && (
                                  <span className="text-[10px] text-primary font-medium">
                                    支出来自规则 {r.expenseRulePrefix}
                                  </span>
                                )}
                                {isUnbound && r.expenseSource === "account_fixed" && (
                                  <span className="text-[10px] text-primary font-medium">
                                    支出来自手动设置
                                  </span>
                                )}
                                {isUnbound && r.expenseSource === "site_1x" && (
                                  <span
                                    className="text-[10px] text-muted-foreground"
                                    title="未匹配任何规则也未设 fixedCost; 默认按本站 1× 计支出"
                                  >
                                    默认 本站 1×
                                  </span>
                                )}
                                {isOrphanUp && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] text-destructive font-medium">
                                      ⚠ 没绑站点账号 (孤立支出)
                                    </span>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="h-5 min-w-0 px-1.5 text-[10px]"
                                      onClick={() => setAttachTarget(r)}
                                    >
                                      归属给账号…
                                    </Button>
                                  </div>
                                )}
                                {/* paired 行下方列出所有绑定的 site 账号 —
                                    unbound_site / unbound_upstream 的 label 本身
                                    已含 site/account 信息, 不重复显示 */}
                                {r.kind === "paired" &&
                                  r.siteAccounts &&
                                  r.siteAccounts.length > 0 && (
                                    <div className="flex items-start gap-1 text-[10px] text-muted-foreground mt-0.5">
                                      <span className="text-muted-foreground/70 shrink-0">
                                        ↳ 绑定:
                                      </span>
                                      <span className="break-all">
                                        {r.siteAccounts
                                          .map(
                                            (sa) =>
                                              `${sa.siteAccountName} / ${sa.accountName}`,
                                          )
                                          .join("  ·  ")}
                                      </span>
                                    </div>
                                  )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <ManualCell
                                field="revenue"
                                row={r}
                                date={data.date}
                                onChanged={reload}
                              />
                            </TableCell>
                            <TableCell>
                              <ManualCell
                                field="expense"
                                row={r}
                                date={data.date}
                                onChanged={reload}
                              />
                            </TableCell>
                            <TableCell>
                              <ManualCell
                                field="siteCostBase"
                                row={r}
                                date={data.date}
                                onChanged={reload}
                              />
                            </TableCell>
                            <TableCell>
                              <ManualCell
                                field="upstreamCostBase"
                                row={r}
                                date={data.date}
                                onChanged={reload}
                              />
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  r.diff > 0
                                    ? "tabular-nums text-amber-600 dark:text-amber-400"
                                    : "tabular-nums text-muted-foreground/70"
                                }
                                title={fmtMoney(r.diff)}
                              >
                                {fmtMoneyShort(r.diff)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col leading-tight">
                                <span
                                  className={
                                    profitNet > 0
                                      ? "tabular-nums font-semibold text-emerald-600 dark:text-emerald-400"
                                      : profitNet < 0
                                        ? "tabular-nums font-semibold text-destructive"
                                        : "tabular-nums font-medium"
                                  }
                                  title={`扣 1× 差异: ${fmtMoney(profitNet)}`}
                                >
                                  {fmtMoneyShort(profitNet)}
                                </span>
                                <span
                                  className={
                                    profitGross > 0
                                      ? "tabular-nums text-[11px] text-emerald-600/70 dark:text-emerald-400/70"
                                      : profitGross < 0
                                        ? "tabular-nums text-[11px] text-destructive/70"
                                        : "tabular-nums text-[11px] text-muted-foreground/70"
                                  }
                                  title={`粗利润 (收入−支出): ${fmtMoney(profitGross)}`}
                                >
                                  毛 {fmtMoneyShort(profitGross)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                </section>
              )}
            </>
          )}
        </div>
        <ExpenseRulesDialog
          isOpen={showRules}
          onClose={() => setShowRules(false)}
          onChanged={reload}
        />
        <AttachUpstreamDialog
          target={attachTarget}
          date={date ?? ""}
          onClose={() => setAttachTarget(null)}
          onApplied={() => {
            setAttachTarget(null);
            reload();
          }}
        />
        <ScanFixDialog
          isOpen={showScanFix}
          onClose={() => setShowScanFix(false)}
          onApplied={() => {
            setShowScanFix(false);
            reload();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TotalsCard({ b }: { b: Breakdown }) {
  const { totals } = b;
  const profitClass =
    totals.profit > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : totals.profit < 0
        ? "text-destructive"
        : "";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-card border border-border rounded-xl p-4">
      <Stat label="收入 (revenue)" value={fmtMoneyShort(totals.revenue)} />
      <Stat label="支出 (expense)" value={fmtMoneyShort(totals.expense)} />
      <Stat
        label="利润 (= 收入 − 支出)"
        value={fmtMoneyShort(totals.profit)}
        valueClass={profitClass}
      />
      <Stat label="本站 1× 总和" value={fmtMoneyShort(totals.siteCostBase)} />
      <Stat label="上游 1× 总和" value={fmtMoneyShort(totals.upstreamCostBase)} />
      <Stat
        label="差异 (上游 1× − 本站 1×)"
        value={fmtMoneyShort(totals.diff)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={`text-lg font-semibold tabular-nums tracking-tight ${valueClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

type ManualField = "revenue" | "expense" | "siteCostBase" | "upstreamCostBase";

// 把 paired row 的 4 个数字字段全部做成可编辑 popover. 写到 DailyProfitBreakdown
// 表的 manualActualCost / manualCost 字段:
//   revenue (site.actualCost)         → site/[refId] PATCH manualActualCost
//   expense (upstream.actualCost)     → upstream/[refId] PATCH manualActualCost
//   siteCostBase (site.cost)          → site/[refId] PATCH manualCost
//   upstreamCostBase (upstream.cost)  → upstream/[refId] PATCH manualCost
// 多 site 绑定的 paired 行: 无法分摊到具体 site, 暂禁用编辑。
function ManualCell({
  field,
  row,
  date,
  onChanged,
}: {
  field: ManualField;
  row: PairedRow;
  date: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const meta = (() => {
    switch (field) {
      case "revenue":
        return {
          value: row.revenue,
          synced: row.revenueSynced,
          isManual: row.revenueIsManual === true,
          label: "手动收入",
          // 写到 site refId. paired/unbound_site 都有 siteAccounts; 多个时不让编辑。
          target:
            row.siteAccounts && row.siteAccounts.length === 1
              ? { kind: "site" as const, id: row.siteAccounts[0].siteBoundAccountId, body: "manualActualCost" }
              : null,
          allowZero: false,
        };
      case "expense":
        return {
          value: row.expense,
          synced: row.expenseSynced,
          isManual: row.expenseIsManual === true,
          isRule: row.expenseSource === "rule",
          isAccountFixed: row.expenseSource === "account_fixed",
          label: "手动支出（仅当日）",
          // unbound_site (含 binding 异常) → per-day site.manualExpense, 只影响该日
          // paired → upstream key 的 per-day manualActualCost, 也是只影响该日
          // 都不写 SiteBoundAccount.fixedCost 那种全局字段, 避免改一天牵动所有
          target:
            row.kind === "unbound_site" &&
            row.siteAccounts &&
            row.siteAccounts.length === 1
              ? {
                  kind: "site" as const,
                  id: row.siteAccounts[0].siteBoundAccountId,
                  body: "manualExpense",
                }
              : row.upstreamKeyId != null
                ? { kind: "upstream" as const, id: row.upstreamKeyId, body: "manualActualCost" }
                : null,
          allowZero: false,
        };
      case "siteCostBase":
        return {
          value: row.siteCostBase,
          synced: row.siteCostBaseSynced,
          isManual: row.siteCostBaseIsManual === true,
          label: "手动 本站 1×",
          target:
            row.siteAccounts && row.siteAccounts.length === 1
              ? { kind: "site" as const, id: row.siteAccounts[0].siteBoundAccountId, body: "manualCost" }
              : null,
          allowZero: false,
        };
      case "upstreamCostBase":
        return {
          value: row.upstreamCostBase,
          synced: row.upstreamCostBaseSynced,
          isManual: row.upstreamCostBaseIsManual === true,
          label: "手动 上游 1×",
          target:
            row.upstreamKeyId != null
              ? { kind: "upstream" as const, id: row.upstreamKeyId, body: "manualCost" }
              : null,
          allowZero: false,
        };
    }
  })();

  const tinted =
    meta.isManual ||
    ("isRule" in meta && meta.isRule) ||
    ("isAccountFixed" in meta && meta.isAccountFixed);
  const canEdit = meta.target != null;

  async function save(clear: boolean) {
    if (!meta.target) return;
    const v = clear ? null : Number(draft);
    if (!clear && (!Number.isFinite(v as number) || (v as number) < 0)) {
      toast.warning("数值非法");
      return;
    }
    setSaving(true);
    try {
      // 所有写都走 per-day 的 DailyProfitBreakdown 表, 不再写 SiteBoundAccount.fixedCost
      // 那种全局字段, 改一天不会牵动其他天的账。
      const base =
        meta.target.kind === "upstream"
          ? `/api/daily-profit/${date}/breakdown/upstream/${meta.target.id}`
          : `/api/daily-profit/${date}/breakdown/site/${meta.target.id}`;
      const url = base;
      const body: Record<string, unknown> = { [meta.target.body]: v };
      const r = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success(clear ? "已清除手动值" : "已保存手动值");
      setOpen(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <span className="tabular-nums text-muted-foreground/70" title={fmtMoney(meta.value)}>
        {fmtMoneyShort(meta.value)}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) setDraft(String(meta.value));
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:bg-muted/60 rounded px-1 py-0.5"
        >
          <span
            className={tinted ? "tabular-nums text-primary font-medium" : "tabular-nums"}
            title={
              meta.isManual && meta.synced != null
                ? `手动: ${fmtMoney(meta.value)} (同步值 ${fmtMoney(meta.synced)})`
                : "isRule" in meta && meta.isRule
                  ? `规则: ${fmtMoney(meta.value)}`
                  : "isAccountFixed" in meta && meta.isAccountFixed
                    ? `账号 fixedCost: ${fmtMoney(meta.value)}`
                    : fmtMoney(meta.value)
            }
          >
            {fmtMoneyShort(meta.value)}
            {tinted && <span className="ml-1 text-[10px] text-primary">✎</span>}
          </span>
          <Pencil size={11} className="text-muted-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-3" align="start">
        <div className="flex flex-col gap-2 w-64">
          <div className="text-[11px] text-muted-foreground">{row.label}</div>
          <div className="flex flex-col gap-1">
            <Input
              type="number"
              className="h-8"
              placeholder={meta.label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              {meta.synced != null
                ? `同步值 ${fmtMoneyShort(meta.synced)}`
                : `当前同步值 ${fmtMoneyShort(meta.value)}`}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!meta.isManual || saving}
              onClick={() => save(true)}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RotateCcw size={12} className="mr-1" />
              )}
              恢复同步
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => save(false)}
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ExpenseRule {
  id: number;
  prefix: string;
  suffix?: string | null;
  fixedCost: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function ExpenseRulesDialog({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ExpenseRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const [newSuffix, setNewSuffix] = useState("");
  const [newCost, setNewCost] = useState("");
  const [saving, setSaving] = useState(false);
  // 每行的草稿 + busy 状态 — 用 Map 维护，避免给每个 row 起 sub-component
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [rowBusy, setRowBusy] = useState<Record<number, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/expense-rules", { cache: "no-store" });
      const j = await r.json();
      const list = (j.items ?? []) as ExpenseRule[];
      setItems(list);
      // 同步 drafts 默认值
      const next: Record<number, string> = {};
      for (const it of list) next[it.id] = String(it.fixedCost);
      setDrafts(next);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  async function addRule() {
    const prefix = newPrefix.trim();
    const suffix = newSuffix.trim();
    const cost = Number(newCost);
    if (!prefix && !suffix) {
      toast.warning("前缀或后缀至少填一个");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.warning("金额非法");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: prefix || "",
          suffix: suffix || null,
          fixedCost: cost,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("添加失败", { description: j.error });
        return;
      }
      setNewPrefix("");
      setNewSuffix("");
      setNewCost("");
      await load();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function updateRule(id: number) {
    const v = Number(drafts[id]);
    if (!Number.isFinite(v) || v < 0) {
      toast.warning("数值非法");
      return;
    }
    setRowBusy((s) => ({ ...s, [id]: true }));
    try {
      const r = await fetch(`/api/expense-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedCost: v }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("更新失败", { description: j.error });
        return;
      }
      await load();
      onChanged();
    } finally {
      setRowBusy((s) => ({ ...s, [id]: false }));
    }
  }

  async function deleteRule(id: number) {
    if (!confirm("删除这条规则？")) return;
    setRowBusy((s) => ({ ...s, [id]: true }));
    try {
      const r = await fetch(`/api/expense-rules/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("删除失败", { description: j.error });
        return;
      }
      await load();
      onChanged();
    } finally {
      setRowBusy((s) => ({ ...s, [id]: false }));
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>支出规则</DialogTitle>
          <DialogDescription className="text-xs font-normal">
            按账号名前缀或后缀给一类账号设固定支出。例如 az- 前缀 → 500;
            -o总 后缀 → 800。两者任一命中即套用。优先级低于账号自身的
            fixedCost,高于&quot;默认本站 1×&quot;兜底。
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">前缀 (可选)</span>
              <Input
                className="h-8"
                placeholder="az-"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value)}
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">后缀 (可选)</span>
              <Input
                className="h-8"
                placeholder="-o总"
                value={newSuffix}
                onChange={(e) => setNewSuffix(e.target.value)}
              />
            </div>
            <div className="w-32 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">固定支出</span>
              <Input
                className="h-8"
                type="number"
                placeholder="500"
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
              />
            </div>
            <Button disabled={saving} onClick={addRule}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              新增
            </Button>
          </div>

          {loading && (
            <div className="flex justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {items.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground/70">还没有规则</p>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>前缀</TableHead>
                  <TableHead>后缀</TableHead>
                  <TableHead>固定支出</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => {
                  const draft = drafts[r.id] ?? String(r.fixedCost);
                  const dirty = Number(draft) !== r.fixedCost;
                  const busy = rowBusy[r.id] === true;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {r.prefix || (
                            <span className="text-muted-foreground/70">—</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {r.suffix || (
                            <span className="text-muted-foreground/70">—</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-28"
                          value={draft}
                          onChange={(e) =>
                            setDrafts((s) => ({ ...s, [r.id]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!dirty || busy}
                            onClick={() => updateRule(r.id)}
                          >
                            {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                            保存
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => deleteRule(r.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SiteOpt {
  id: number;
  label: string;
  name: string;
  siteAccountName: string;
}

function AttachUpstreamDialog({
  target,
  date,
  onClose,
  onApplied,
}: {
  target: PairedRow | null;
  date: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [opts, setOpts] = useState<SiteOpt[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!target) return;
    setSelectedSiteId(null);
    if (opts.length > 0) return;
    setLoadingOpts(true);
    fetch("/api/bindings/options", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setOpts((j.siteBoundAccounts ?? []) as SiteOpt[]))
      .finally(() => setLoadingOpts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function apply() {
    if (!target?.upstreamKeyId || !selectedSiteId) return;
    setApplying(true);
    try {
      // 创建历史 binding: 覆盖该日期开始 → 昨天结束 (避免与当前 active binding 冲突)
      // createdAt 设成 2000-01-01 表示"从一开始就生效", endedAt = 当前查看日期 23:59:59
      // 这样这条 binding 只对 ≤ 该日期的历史数据生效, 今天的 active binding 不动。
      const endedAt = `${date}T23:59:59.999+08:00`;
      const r = await fetch("/api/bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteBoundAccountId: selectedSiteId,
          upstreamKeyId: target.upstreamKeyId,
          createdAt: "2000-01-01T00:00:00.000Z",
          endedAt,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("归属失败", { description: j.error });
        return;
      }
      toast.success("已创建历史 binding");
      onApplied();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>归属孤立的 upstream key</DialogTitle>
          {target && (
            <DialogDescription className="text-xs font-normal">
              {target.label}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            把这把 upstream key 历史上绑给一个 site 账号——会创建一条
            <b> 历史 binding</b> （生效到 {date} 23:59）。今天起的 active
            binding 不受影响。
          </p>
          <Input
            type="text"
            className="h-8"
            placeholder="过滤名称…"
            disabled
            value={loadingOpts ? "加载中…" : `${opts.length} 个候选`}
          />
          <div className="max-h-80 overflow-auto border border-border/50 rounded-md">
            {opts.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-muted/60 cursor-pointer text-xs border-b border-border/30 last:border-b-0"
              >
                <input
                  type="radio"
                  name="site"
                  checked={selectedSiteId === o.id}
                  onChange={() => setSelectedSiteId(o.id)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={!selectedSiteId || applying}
              onClick={apply}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              确认归属
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ScanSuggestion {
  date: string;
  siteBoundAccountId: number;
  siteLabel: string;
  pairedUpstreamKeyId: number;
  pairedUpstreamLabel: string;
  orphanUpstreamKeyId: number;
  orphanUpstreamLabel: string;
  groupName: string;
  effectiveRate: number;
  revenue: number;
  orphanExpense: number;
  reason: string;
  dates: string[];
  totalRevenue: number;
  totalOrphanExpense: number;
  latestDate: string;
}
interface ScanResult {
  scannedDays: number;
  suggestionCount: number;
  items: ScanSuggestion[];
}

function ScanFixDialog({
  isOpen,
  onClose,
  onApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [days, setDays] = useState(60);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  function keyOf(s: ScanSuggestion): string {
    return `${s.siteBoundAccountId}:${s.orphanUpstreamKeyId}`;
  }

  async function scan() {
    setScanning(true);
    setResult(null);
    try {
      const r = await fetch(`/api/bindings/auto-suggest-history?days=${days}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as ScanResult;
      setResult(j);
      // 默认全选
      setSelected(new Set(j.items.map(keyOf)));
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (isOpen) scan();
    else {
      setResult(null);
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function apply() {
    if (!result) return;
    const toApply = result.items.filter((s) => selected.has(keyOf(s)));
    if (toApply.length === 0) {
      toast.warning("没有勾选任何条目");
      return;
    }
    setApplying(true);
    try {
      const r = await fetch("/api/bindings/apply-history-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: toApply.map((s) => ({
            siteBoundAccountId: s.siteBoundAccountId,
            orphanUpstreamKeyId: s.orphanUpstreamKeyId,
            latestDate: s.latestDate,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("应用失败", { description: j.error });
        return;
      }
      toast.success(`已创建 ${j.created} 条历史 binding`);
      onApplied();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>扫描并修复孤立支出</DialogTitle>
          <DialogDescription className="text-xs font-normal">
            找出&quot;绑定了的 key 当天 0 流量 + 同组同倍率有另一把 key 在跑&quot;的情况，建议把
            孤立 key 归属给当前 paired 行那个 site 账号。同组 + 同倍率 = 同一逻辑渠道
            (新旧迁移产物)。
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          <div className="flex items-end gap-2">
            <div className="w-32 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">扫描近 N 天</span>
              <Input
                type="number"
                className="h-8"
                value={String(days)}
                onChange={(e) =>
                  setDays(Math.max(1, Math.min(365, Number(e.target.value) || 60)))
                }
              />
            </div>
            <Button disabled={scanning} onClick={scan}>
              {scanning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              重新扫描
            </Button>
            <span className="text-xs text-muted-foreground/70 ml-2">
              {result
                ? `扫描了 ${result.scannedDays} 天 · 发现 ${result.suggestionCount} 条建议`
                : ""}
            </span>
          </div>

          {scanning && (
            <div className="flex justify-center items-center gap-2 p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">扫描中…</span>
            </div>
          )}

          {result && result.items.length === 0 && !scanning && (
            <p className="text-muted-foreground text-sm py-3">
              没有发现需要修复的孤立支出。
            </p>
          )}

          {result && result.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={selected.size === result.items.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(result.items.map(keyOf)));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>覆盖天数</TableHead>
                  <TableHead>站点账号</TableHead>
                  <TableHead>当前 paired (0 支出)</TableHead>
                  <TableHead>孤立 key (有支出)</TableHead>
                  <TableHead>累计孤立支出</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((s) => {
                  const k = keyOf(s);
                  const checked = selected.has(k);
                  return (
                    <TableRow key={k}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(k);
                            else next.delete(k);
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs tabular-nums">{s.dates.length} 天</span>
                          <span className="text-[10px] text-muted-foreground/70">
                            截至 {s.latestDate}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{s.siteLabel}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs line-through text-muted-foreground">
                            {s.pairedUpstreamLabel}
                          </span>
                          <Badge
                            variant="secondary"
                            className="rounded-full h-4 px-1 text-[10px] w-fit"
                          >
                            {s.groupName} ×{s.effectiveRate.toFixed(2)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            {s.orphanUpstreamLabel}
                          </span>
                          <span className="text-[10px] text-muted-foreground/70">
                            {s.reason}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="tabular-nums font-medium text-amber-600 dark:text-amber-400"
                          title={fmtMoney(s.totalOrphanExpense)}
                        >
                          {fmtMoneyShort(s.totalOrphanExpense)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={selected.size === 0 || applying}
              onClick={apply}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              应用 {selected.size} 条
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
