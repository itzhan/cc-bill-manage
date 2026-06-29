"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  RefreshCw,
  RotateCw,
  Calendar,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import Shell from "@/components/Shell";
import StatCard from "@/components/StatCard";
import TopBar from "@/components/TopBar";
import ExpenseBarChart, {
  type ExpenseBarPoint,
} from "@/components/ExpenseBarChart";
import { type TrendPoint } from "@/components/TrendLineChart";
import DailyRevenueChart from "@/components/DailyRevenueChart";
import DailyProfitChart from "@/components/DailyProfitChart";
import DailyDetailModal, {
  ExpenseRulesDialog,
} from "@/components/DailyDetailModal";
import { fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard";

// 每日利润起始日期 — 用户要求从 2025-04-18 起的所有记录全部展示, 客户端分页。
const DAILY_START_DATE = "2025-04-18";

const RANGE_LABELS: Record<string, string> = {
  "1h": "最近 1 小时",
  "6h": "最近 6 小时",
  "24h": "最近 24 小时",
  "7d": "最近 7 天",
  "30d": "最近 30 天",
};

interface DailyProfitRow {
  id: number;
  date: string;
  revenue: number;
  expense: number;
  profit: number;
  siteCostBase: number;
  upstreamCostBase: number;
  diff: number;
  capturedAt: string;
  updatedAt: string;
}

interface UnboundAccountRow {
  id: number;
  siteAccountId: number;
  siteAccountName: string;
  accountName: string;
  rateMultiplier: number;
  fixedCost: number | null;
  revenue: number;
  costBase: number;
  profit: number;
  hasFixedCost: boolean;
  accumExpense: number;
  lastUsedDate: string | null;
}
interface UnboundAccountsResp {
  days: number;
  totalRevenue: number;
  totalCostBase: number;
  totalProfit: number;
  items: UnboundAccountRow[];
  excludePrefixes?: string[];
  excludeSuffixes?: string[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topExpense, setTopExpense] = useState<ExpenseBarPoint[]>([]);
  const [daily, setDaily] = useState<DailyProfitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<string>("24h");
  const [view, setView] = useState<string>("overview");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const [backfillStart, setBackfillStart] = useState<string>(monthAgo);
  const [backfillEnd, setBackfillEnd] = useState<string>(today);
  const [backfilling, setBackfilling] = useState(false);
  const [showUnusedBindings, setShowUnusedBindings] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  // 每日利润卡片的视图切换：按日期 / 未绑定账号
  const [dailyView, setDailyView] = useState<"by-date" | "unbound">("by-date");
  // 「按日期」分页 — 每页条数 + 当前页。每页条数可选。
  const [dailyPageSize, setDailyPageSize] = useState<number>(30);
  const [dailyPage, setDailyPage] = useState<number>(1);
  const dailyTotalPages = Math.max(
    1,
    Math.ceil(daily.length / dailyPageSize),
  );
  const dailyPageClamped = Math.min(dailyPage, dailyTotalPages);
  const dailyPageSlice = daily.slice(
    (dailyPageClamped - 1) * dailyPageSize,
    dailyPageClamped * dailyPageSize,
  );
  const [unboundDays, setUnboundDays] = useState(30);
  const [unbound, setUnbound] = useState<UnboundAccountsResp | null>(null);
  const [unboundLoading, setUnboundLoading] = useState(false);
  async function loadUnbound(d: number = unboundDays) {
    setUnboundLoading(true);
    try {
      const r = await fetch(`/api/unbound-accounts?days=${d}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as UnboundAccountsResp;
      setUnbound(j);
    } finally {
      setUnboundLoading(false);
    }
  }
  useEffect(() => {
    if (dailyView === "unbound" && unbound == null) loadUnbound(unboundDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyView]);

  // 请求序号 — 防止 30s 轮询的 in-flight 响应在 backfill 后晚到，把
  // runBackfill 写入的新值再覆盖回旧值（典型 race）。
  const loadSeqRef = useRef(0);
  async function loadAll(rangeArg: string = range) {
    const mySeq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const ts = Date.now(); // 强制 cache-bust，绕过任何中间层缓存
      const [a, b, c, d] = await Promise.all([
        fetch(`/api/dashboard?_=${ts}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/dashboard/timeseries?range=${rangeArg}&_=${ts}`, {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch(`/api/dashboard/top-expenses?_=${ts}`, { cache: "no-store" }).then((r) =>
          r.json(),
        ),
        fetch(`/api/daily-profit?startDate=${DAILY_START_DATE}&_=${ts}`, {
          cache: "no-store",
        }).then((r) => r.json()),
      ]);
      // 我若已过时（有人发起了更新的 loadAll），直接丢弃这一轮结果。
      if (mySeq !== loadSeqRef.current) return;
      setData(a as DashboardSummary);
      setTrend((b.points || []) as TrendPoint[]);
      setTopExpense(
        (c.items || []).map(
          (
            i: {
              label: string;
              cost: number;
              group: string;
              multiplier: number;
            },
          ) => ({
            label: i.label,
            cost: i.cost,
            group: i.group,
            multiplier: i.multiplier,
          }),
        ),
      );
      setDaily((d.items || []) as DailyProfitRow[]);
    } catch (e) {
      if (mySeq !== loadSeqRef.current) return;
      toast.error("加载失败", { description: String(e) });
    } finally {
      if (mySeq === loadSeqRef.current) setLoading(false);
    }
  }

  async function callBatch(
    url: string,
    successTitle: string,
    setBusy: (b: boolean) => void,
  ) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as {
        upstream: { name: string; ok: boolean; error?: string }[];
        site: { name: string; ok: boolean; error?: string }[];
      };
      const failed = [...j.upstream, ...j.site].filter((x) => !x.ok);
      if (failed.length) {
        toast.warning("部分失败", {
          description: failed.map((f) => `${f.name}: ${f.error}`).join("; "),
        });
      } else {
        toast.success(successTitle);
      }
      await loadAll();
    } catch (e) {
      toast.error("失败", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const syncNow = () => callBatch("/api/sync", "用量已更新", setSyncing);
  const refreshNow = () =>
    callBatch("/api/refresh", "结构已刷新", setRefreshing);

  async function runBackfill() {
    if (!backfillStart || !backfillEnd) {
      toast.warning("请选择起止日期");
      return;
    }
    if (backfillStart > backfillEnd) {
      toast.warning("起始日期晚于结束日期");
      return;
    }
    setBackfilling(true);
    try {
      const r = await fetch("/api/history/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: backfillStart, end: backfillEnd }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("回填失败", { description: j.error });
        return;
      }
      const j = (await r.json()) as {
        rows: { date: string }[];
        totals: { days: number; profit: number };
        errors: { date: string; kind: string; id: number; error: string }[];
      };
      if (j.errors.length) {
        toast.warning(`回填完成 ${j.totals.days} 天`, {
          description:
            `${j.errors.length} 条失败 · 区间利润 ${j.totals.profit.toFixed(2)}`,
        });
      } else {
        toast.success(`回填完成 ${j.totals.days} 天`, {
          description: `区间利润 ${j.totals.profit.toFixed(2)}`,
        });
      }
      await loadAll();
    } catch (e) {
      toast.error("失败", { description: String(e) });
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    loadAll();
    // backfilling 期间暂停轮询，否则 30s tick 可能在 backfill 完成前
    // 用旧 DB 值起飞 + 晚到，被序号守卫拦截但成本浪费。
    const t = setInterval(() => {
      if (backfilling) return;
      loadAll();
    }, 30 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backfilling]);

  // Compare last vs first snapshot in selected range to compute trend deltas
  const trendDeltas = useMemo(() => {
    if (trend.length < 2) return null;
    const first = trend[0];
    const last = trend[trend.length - 1];
    function pct(a: number, b: number): number {
      if (a === 0 && b === 0) return 0;
      if (a === 0) return b > 0 ? 100 : -100;
      return ((b - a) / Math.abs(a)) * 100;
    }
    return {
      revenue: pct(first.revenue, last.revenue),
      expense: pct(first.expense, last.expense),
      profit: pct(first.profit, last.profit),
    };
  }, [trend]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return "凌晨好";
    if (h < 11) return "早上好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  }, []);

  return (
    <Shell>
      <TopBar
        title={`${greeting}，Admin`}
        subtitle={`最后同步：${fmtDate(data?.lastSyncAt)}`}
      />

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <Tabs
          value={view}
          onValueChange={(k) => setView(k)}
        >
          <TabsList>
            <TabsTrigger value="overview" className="px-4 h-9">总览</TabsTrigger>
            <TabsTrigger value="revenue" className="px-4 h-9">收入</TabsTrigger>
            <TabsTrigger value="expense" className="px-4 h-9">支出</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="icon"
            variant="secondary"
            className="rounded-full"
            aria-label="reload"
            onClick={() => loadAll()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                className="rounded-full"
              >
                <Calendar size={14} />
                <span className="hidden sm:inline">
                  {RANGE_LABELS[range] ?? range}
                </span>
                <span className="sm:hidden">{range}</span>
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <DropdownMenuItem
                  key={k}
                  onClick={() => {
                    setRange(k);
                    loadAll(k);
                  }}
                >
                  {l}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={refreshNow}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
            <span className="hidden sm:inline">完整刷新</span>
            <span className="sm:hidden">刷新</span>
          </Button>
          <Button
            className="rounded-full"
            onClick={syncNow}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw size={14} />}
            <span className="hidden sm:inline">立即同步</span>
            <span className="sm:hidden">同步</span>
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 ${view === "overview" ? "lg:grid-cols-4" : "lg:grid-cols-2"} gap-4 mb-6`}
          >
            {(view === "overview" || view === "revenue") && (
              <StatCard
                label="今日收入"
                value={fmtMoneyShort(data.totalRevenue)}
                trend={
                  trendDeltas ? { delta: trendDeltas.revenue } : undefined
                }
                hint="本站 user_cost 总和"
                positiveIsGood
                icon={TrendingUp}
                accent="success"
              />
            )}
            {(view === "overview" || view === "expense") && (
              <StatCard
                label="今日支出"
                value={fmtMoneyShort(data.totalExpense)}
                trend={
                  trendDeltas ? { delta: trendDeltas.expense } : undefined
                }
                hint="上游 today_actual_cost 总和"
                positiveIsGood={false}
                icon={TrendingDown}
                accent="danger"
              />
            )}
            {(view === "overview" || view === "revenue") && (
              <StatCard
                label="今日利润"
                value={fmtMoneyShort(data.totalProfit)}
                trend={
                  trendDeltas ? { delta: trendDeltas.profit } : undefined
                }
                hint={
                  data.totalAzRevenue > 0
                    ? `含 az 今日 +${fmtMoneyShort(data.totalAzRevenue)}（不扣 az 投入）`
                    : "收入 − 支出"
                }
                positiveIsGood
                icon={Wallet}
                accent={data.totalProfit >= 0 ? "primary" : "danger"}
              />
            )}
            {(view === "overview" || view === "expense") && (
              <StatCard
                label="差异（1×）"
                value={fmtMoneyShort(data.totalDiff)}
                hint={`阈值 ${data.diffThreshold} ${
                  data.diffOverThreshold ? "·已超阈值" : "·正常"
                }`}
                positiveIsGood={false}
                trend={
                  data.totalDiff > 0
                    ? { delta: data.diffOverThreshold ? 100 : -100 }
                    : undefined
                }
                icon={AlertTriangle}
                accent={data.diffOverThreshold ? "danger" : "warning"}
              />
            )}
          </div>

          {view === "overview" && daily.length > 0 && (
            <Card className="bg-card border border-border shadow-sm mb-6">
              <CardHeader className="flex justify-between items-center pb-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Wallet size={16} />
                  </div>
                  <div>
                    <h2 className="font-semibold leading-tight">
                      近一周利润趋势
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      按 Asia/Shanghai 日期
                    </p>
                  </div>
                </div>
                {(() => {
                  const last7 = daily.slice(0, 7);
                  const sum = last7.reduce((s, d) => s + d.profit, 0);
                  return (
                    <span className="text-xs text-muted-foreground">
                      7 日累计{" "}
                      <b
                        className={
                          sum > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : sum < 0
                              ? "text-destructive"
                              : "text-foreground"
                        }
                      >
                        {fmtMoneyShort(sum)}
                      </b>
                    </span>
                  );
                })()}
              </CardHeader>
              <CardContent className="pt-2">
                <DailyProfitChart data={daily.slice(0, 7)} />
              </CardContent>
            </Card>
          )}

          {view !== "overview" && (
            <div className="grid grid-cols-1 gap-4 mb-6">
              {view === "expense" && (
                <Card className="bg-card border border-border shadow-sm">
                  <CardHeader className="flex justify-between items-center pb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
                        <TrendingDown size={16} />
                      </div>
                      <div>
                        <h2 className="font-semibold leading-tight">
                          支出 Top（按上游 Key）
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          今日 today_actual_cost
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {topExpense.length} keys
                    </Badge>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <ExpenseBarChart data={topExpense} />
                  </CardContent>
                </Card>
              )}

              {view === "revenue" && (
                <Card className="bg-card border border-border shadow-sm">
                  <CardHeader className="flex justify-between items-center pb-1 gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <TrendingUp size={16} />
                      </div>
                      <div>
                        <h2 className="font-semibold leading-tight">每日收入</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          按 Asia/Shanghai 日期 · 最近 {daily.length} 天
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <DailyRevenueChart data={daily} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {view === "overview" && (
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex justify-between items-center flex-wrap gap-2">
              <div>
                <h2 className="font-semibold">利润明细</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  上游绑定（含差异）+ az 站点账号
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={showUnusedBindings}
                    onCheckedChange={(v) => setShowUnusedBindings(v === true)}
                  />
                  <span className="text-xs">显示今日无使用</span>
                </label>
                <span>
                  本站 1× <b className="text-foreground">{fmtMoneyShort(data.totalSiteCostBase)}</b>
                </span>
                <span>·</span>
                <span>
                  上游 1× <b className="text-foreground">{fmtMoneyShort(data.totalUpstreamCostBase)}</b>
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                上游绑定
              </div>
              {(() => {
                const visibleBindings = showUnusedBindings
                  ? data.bindings
                  : data.bindings.filter(
                      (b) => b.siteUserCost > 0 || b.upstreamTodayCost > 0,
                    );
                if (data.bindings.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm">
                      暂无绑定。先在「绑定」页配置。
                    </p>
                  );
                }
                if (visibleBindings.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm">
                      今日暂无使用记录。勾选「显示今日无使用」查看全部 {data.bindings.length} 个绑定。
                    </p>
                  );
                }
                return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>本站 → 上游</TableHead>
                      <TableHead>收入</TableHead>
                      <TableHead>支出</TableHead>
                      <TableHead>利润</TableHead>
                      <TableHead>本站 1×</TableHead>
                      <TableHead>上游 1×</TableHead>
                      <TableHead>差异 (1×)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleBindings.map((b) => {
                      const profit = b.siteUserCost - b.upstreamTodayCost;
                      const diffOver =
                        Math.abs(b.diff) > data.diffThreshold;
                      const hasOverride = b.siteAccounts.some(
                        (s) => s.rateMultiplierOverride != null,
                      );
                      // Average effective rate across the bound accounts
                      // (good enough scalar; the per-account list is below).
                      const avgRate =
                        b.siteCostBase > 0
                          ? b.siteUserCost / b.siteCostBase
                          : 0;
                      return (
                        <TableRow key={b.upstreamKeyId}>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="text-sm font-medium">
                                {b.upstreamKeyName}
                              </span>
                              <span className="text-xs text-muted-foreground/70">
                                {b.upstreamGroupName} ×
                                {b.upstreamEffectiveMultiplier}
                                {b.upstreamHasExclusiveRate && (
                                  <span className="text-primary">（专属）</span>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground mt-0.5">
                                ← {b.siteAccounts.length} 个本站绑定
                                {b.siteAccounts.length > 1 && (
                                  <span
                                    className="ml-1 text-muted-foreground/70"
                                    title={b.siteAccounts
                                      .map((s) => s.name)
                                      .join("\n")}
                                  >
                                    （hover 查看）
                                  </span>
                                )}
                              </span>
                              {b.siteAccounts.length === 1 ? (
                                <span className="text-xs text-muted-foreground/70">
                                  · {b.siteAccounts[0].name}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/70 truncate max-w-md">
                                  ·{" "}
                                  {b.siteAccounts
                                    .map((s) => s.name)
                                    .join("，")}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium">
                                {fmtMoneyShort(b.siteUserCost)}
                              </span>
                              <span className="text-xs text-muted-foreground/70">
                                ×{avgRate.toFixed(2)}
                                {hasOverride && (
                                  <span className="text-primary ml-1">
                                    （含覆盖）
                                  </span>
                                )}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">
                              {fmtMoneyShort(b.upstreamTodayCost)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                profit > 0
                                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                  : profit < 0
                                    ? "font-semibold text-destructive"
                                    : "text-muted-foreground"
                              }
                            >
                              {fmtMoneyShort(profit)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="font-medium"
                              title={fmtMoney(b.siteCostBase)}
                            >
                              {fmtMoneyShort(b.siteCostBase)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="font-medium"
                              title={fmtMoney(b.upstreamTodayCostBase)}
                            >
                              {fmtMoneyShort(b.upstreamTodayCostBase)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                diffOver
                                  ? "text-destructive font-semibold"
                                  : "text-muted-foreground"
                              }
                              title={`本站 1× ${fmtMoney(b.siteCostBase)} · 上游 1× ${fmtMoney(b.upstreamTodayCostBase)}`}
                            >
                              {fmtMoneyShort(b.diff)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                );
              })()}

              <div className="text-xs font-medium text-muted-foreground mt-6 mb-2 flex items-center gap-2">
                <span>az 站点账号</span>
                <span className="text-muted-foreground/70 font-normal">
                  收入 {fmtMoneyShort(data.totalAzRevenue)} · 成本{" "}
                  {fmtMoneyShort(data.totalAzExpense)} · 利润{" "}
                  <b
                    className={
                      data.totalAzProfit > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : data.totalAzProfit < 0
                          ? "text-destructive"
                          : ""
                    }
                  >
                    {fmtMoneyShort(data.totalAzProfit)}
                  </b>
                </span>
              </div>
              {(() => {
                // az 段固定只展示今日有收入的账号（todayUserCost > 0）—
                // 不受上方"显示今日无使用" checkbox 影响（该 checkbox 只
                //控制上游绑定段）。固定成本 fixedCost 不算"今日有消费"。
                const visibleAz = data.azAccounts.filter(
                  (a) => a.todayUserCost > 0,
                );
                if (data.azAccounts.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm">
                      暂无 az 账号。在「az 管理」页批量创建后会自动出现。
                    </p>
                  );
                }
                if (visibleAz.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm">
                      今日 az 暂无使用。共{" "}
                      {data.azAccounts.length} 个 az 账号。
                    </p>
                  );
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>账号</TableHead>
                        <TableHead>收入</TableHead>
                        <TableHead>成本</TableHead>
                        <TableHead>利润</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleAz.map((a) => (
                        <TableRow key={a.siteBoundAccountId}>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="text-sm font-medium">
                                {a.name}
                              </span>
                              <span className="text-xs text-muted-foreground/70">
                                {a.siteAccountName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium">
                                {fmtMoneyShort(a.todayUserCost)}
                              </span>
                              <span className="text-xs text-muted-foreground/70">
                                ×{a.rateEffective.toFixed(2)}
                                {a.rateMultiplierOverride != null && (
                                  <span className="text-primary ml-1">
                                    （覆盖）
                                  </span>
                                )}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium">
                                {fmtMoneyShort(a.todayCost)}
                              </span>
                              {a.fixedCost != null && (
                                <span className="text-xs text-muted-foreground/70">
                                  固定
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                a.profit > 0
                                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                  : a.profit < 0
                                    ? "font-semibold text-destructive"
                                    : "text-muted-foreground"
                              }
                            >
                              {fmtMoneyShort(a.profit)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>
          )}

          <Card className="bg-card border border-border shadow-sm mt-6">
            <CardHeader className="flex flex-col items-start gap-3">
              <div className="flex justify-between items-start flex-wrap gap-3 w-full">
              <div>
                <h2 className="font-semibold">每日利润</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  按 Asia/Shanghai 日期。当天的行随每次同步刷新；跨天后自然冻结。可选起止日期回填历史
                </p>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">起</label>
                  <Input
                    type="date"
                    value={backfillStart}
                    onChange={(e) => setBackfillStart(e.target.value)}
                    className="w-[150px] h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">止</label>
                  <Input
                    type="date"
                    value={backfillEnd}
                    onChange={(e) => setBackfillEnd(e.target.value)}
                    className="w-[150px] h-8 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={runBackfill}
                  disabled={backfilling}
                >
                  {backfilling && <Loader2 className="h-4 w-4 animate-spin" />}
                  回填
                </Button>
                {(() => {
                  const grossProfit = daily.reduce((s, d) => s + d.profit, 0);
                  const azInvestment = data?.totalAzExpense ?? 0;
                  const netProfit = grossProfit - azInvestment;
                  const totalLoss = daily.reduce(
                    (s, d) => s + Math.max(0, d.upstreamCostBase - d.siteCostBase),
                    0,
                  );
                  const totalSurplus = daily.reduce(
                    (s, d) => s + Math.max(0, d.siteCostBase - d.upstreamCostBase),
                    0,
                  );
                  const lossDays = daily.filter(
                    (d) => d.upstreamCostBase > d.siteCostBase,
                  ).length;
                  const surplusDays = daily.filter(
                    (d) => d.siteCostBase > d.upstreamCostBase,
                  ).length;
                  return (
                    <span className="text-xs text-muted-foreground self-center ml-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        累计利润{" "}
                        <b
                          className={
                            grossProfit > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : grossProfit < 0
                                ? "text-destructive"
                                : "text-foreground"
                          }
                        >
                          {fmtMoneyShort(grossProfit)}
                        </b>
                      </span>
                      {azInvestment > 0 && (
                        <>
                          <span>
                            扣 az 投入{" "}
                            <b className="text-amber-600 dark:text-amber-400">
                              −{fmtMoneyShort(azInvestment)}
                            </b>
                          </span>
                          <span>
                            净利润{" "}
                            <b
                              className={
                                netProfit > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : netProfit < 0
                                    ? "text-destructive"
                                    : "text-foreground"
                              }
                            >
                              {fmtMoneyShort(netProfit)}
                            </b>
                          </span>
                        </>
                      )}
                      <span>
                        累计盈余{" "}
                        <b className="text-emerald-600 dark:text-emerald-400">
                          +{fmtMoneyShort(totalSurplus)}
                        </b>
                        {surplusDays > 0 && (
                          <span className="text-muted-foreground/70 ml-0.5">
                            · {surplusDays} 天
                          </span>
                        )}
                      </span>
                      <span>
                        累计差异{" "}
                        <b className="text-destructive">−{fmtMoneyShort(totalLoss)}</b>
                        {lossDays > 0 && (
                          <span className="text-muted-foreground/70 ml-0.5">
                            · {lossDays} 天
                          </span>
                        )}
                      </span>
                    </span>
                  );
                })()}
              </div>
              </div>
              <Tabs
                value={dailyView}
                onValueChange={(k) =>
                  setDailyView(k as "by-date" | "unbound")
                }
              >
                <TabsList className="h-8">
                  <TabsTrigger value="by-date" className="text-xs px-3 h-7">按日期</TabsTrigger>
                  <TabsTrigger value="unbound" className="text-xs px-3 h-7">
                    <span className="flex items-center gap-1.5">
                      未绑定账号
                      {unbound && unbound.items.length > 0 && (
                        <Badge
                          variant="warning"
                          className="h-4 px-1 text-[10px]"
                        >
                          {unbound.items.length}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {dailyView === "unbound" ? (
                <UnboundView
                  data={unbound}
                  loading={unboundLoading}
                  days={unboundDays}
                  onDaysChange={(d) => {
                    setUnboundDays(d);
                    loadUnbound(d);
                  }}
                  onRefresh={() => loadUnbound(unboundDays)}
                />
              ) : daily.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  暂无每日记录。每次同步会写入当天的累计值
                </p>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>收入</TableHead>
                      <TableHead>支出</TableHead>
                      <TableHead>利润</TableHead>
                      <TableHead>差异 / 盈余 (1×)</TableHead>
                      <TableHead>更新时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyPageSlice.map((d, idx) => {
                      // "今天" 标志只看绝对位置 (page 1 第一行 = 最新), 翻页不再标。
                      const isToday = dailyPageClamped === 1 && idx === 0;
                      return (
                        <TableRow
                          key={d.id}
                          className="cursor-pointer hover:bg-muted/60 transition-colors"
                          onClick={() => setDetailDate(d.date)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium underline decoration-dotted underline-offset-2">
                                {d.date}
                              </span>
                              {isToday && (
                                <Badge
                                  variant="default"
                                  className="h-4 px-1 text-[10px]"
                                >
                                  今天
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{fmtMoneyShort(d.revenue)}</TableCell>
                          <TableCell>{fmtMoneyShort(d.expense)}</TableCell>
                          <TableCell>
                            <span
                              className={
                                d.profit > 0
                                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                  : d.profit < 0
                                    ? "font-semibold text-destructive"
                                    : ""
                              }
                            >
                              {fmtMoneyShort(d.profit)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const surplus = Math.max(
                                0,
                                d.siteCostBase - d.upstreamCostBase,
                              );
                              if (d.diff > 0) {
                                return (
                                  <span
                                    className="text-destructive font-medium"
                                    title={`上游 1× ${fmtMoneyShort(d.upstreamCostBase)} > 本站 1× ${fmtMoneyShort(d.siteCostBase)}`}
                                  >
                                    −{fmtMoneyShort(d.diff)}
                                  </span>
                                );
                              }
                              if (surplus > 0) {
                                return (
                                  <span
                                    className="text-emerald-600 dark:text-emerald-400 font-medium"
                                    title={`本站 1× ${fmtMoneyShort(d.siteCostBase)} > 上游 1× ${fmtMoneyShort(d.upstreamCostBase)}`}
                                  >
                                    +{fmtMoneyShort(surplus)}
                                  </span>
                                );
                              }
                              return (
                                <span className="text-muted-foreground/70">0</span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground/70">
                            {fmtDate(d.updatedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between flex-wrap gap-3 mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      共 {daily.length} 天 · 起 {DAILY_START_DATE}
                    </span>
                    <span className="text-muted-foreground/70">·</span>
                    <span>每页</span>
                    <Select
                      value={String(dailyPageSize)}
                      onValueChange={(v) => {
                        const n = Number(v);
                        if (!Number.isFinite(n) || n <= 0) return;
                        setDailyPageSize(n);
                        setDailyPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="30">30</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                    <span>条</span>
                  </div>
                  {dailyTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <Button size="sm" variant="outline" disabled={dailyPageClamped <= 1} onClick={() => setDailyPage(dailyPageClamped - 1)}>上一页</Button>
                      <span className="text-sm text-muted-foreground">{dailyPageClamped} / {dailyTotalPages}</span>
                      <Button size="sm" variant="outline" disabled={dailyPageClamped >= dailyTotalPages} onClick={() => setDailyPage(dailyPageClamped + 1)}>下一页</Button>
                    </div>
                  )}
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <DailyDetailModal
        date={detailDate}
        isOpen={detailDate !== null}
        onOpenChange={(v) => {
          if (!v) setDetailDate(null);
        }}
      />
    </Shell>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

interface UpstreamKeyOpt {
  id: number;
  label: string;
  groupName: string;
  groupRateMultiplier: number;
  effectiveRateMultiplier: number;
  hasExclusiveRate: boolean;
  keyMasked: string;
  upstreamAccountId: number;
  upstreamAccountName: string;
}

interface AutoMatchPlan {
  summary: {
    totalSite: number;
    excluded?: number;
    totalUpstreamKey: number;
    newBindings: number;
    misbound: number;
    alreadyCorrect: number;
    unmatched: number;
    errors: number;
  };
  excludePrefixes?: string[];
  proposed: Array<{
    siteBoundAccountId: number;
    siteLabel: string;
    upstreamKeyId: number;
    upstreamLabel: string;
  }>;
  misbound: Array<{
    siteBoundAccountId: number;
    siteLabel: string;
    currentBindingId: number;
    currentUpstreamKeyId: number;
    currentUpstreamLabel: string;
    correctUpstreamKeyId: number;
    correctUpstreamLabel: string;
  }>;
  unmatched: Array<{
    siteBoundAccountId: number;
    siteLabel: string;
    apiKeyMasked: string;
  }>;
  errors: Array<{ siteBoundAccountId: number; siteLabel: string; error: string }>;
}

function UnboundView({
  data,
  loading,
  days,
  onDaysChange,
  onRefresh,
}: {
  data: UnboundAccountsResp | null;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
}) {
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState("");
  const [suffixDraft, setSuffixDraft] = useState("");
  const [savingPrefix, setSavingPrefix] = useState(false);
  // "支出规则" 弹窗 — 跟每日明细 modal 里的 ExpenseRulesDialog 共用
  const [editingRules, setEditingRules] = useState(false);
  // 排序方式: 默认按"最近使用"倒序; 其他维度 desc。
  const [sortBy, setSortBy] = useState<
    "lastUsed" | "revenue" | "accumExpense" | "profit"
  >("lastUsed");

  // 绑定弹窗状态
  const [bindTarget, setBindTarget] = useState<UnboundAccountRow | null>(null);
  const [upstreamKeyOpts, setUpstreamKeyOpts] = useState<UpstreamKeyOpt[]>([]);
  const [optsLoading, setOptsLoading] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [binding, setBinding] = useState(false);

  // 自动匹配状态
  const [autoMatching, setAutoMatching] = useState(false);
  const [autoPlan, setAutoPlan] = useState<AutoMatchPlan | null>(null);
  const [autoApplying, setAutoApplying] = useState(false);

  // 一次性投入编辑状态——per 行 Popover open + 草稿 + busy
  const [fcOpenId, setFcOpenId] = useState<number | null>(null);
  const [fcDraft, setFcDraft] = useState<Record<number, string>>({});
  const [fcSaving, setFcSaving] = useState<Record<number, boolean>>({});
  async function saveFixedCost(id: number, clear: boolean) {
    const v = clear ? null : Number(fcDraft[id]);
    if (!clear && (!Number.isFinite(v as number) || (v as number) < 0)) {
      toast.warning("数值非法");
      return;
    }
    setFcSaving((s) => ({ ...s, [id]: true }));
    try {
      const r = await fetch(`/api/site-bound-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedCost: v }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success(clear ? "已清除一次性投入" : "已保存一次性投入");
      setFcOpenId(null);
      onRefresh();
    } finally {
      setFcSaving((s) => ({ ...s, [id]: false }));
    }
  }
  async function runAutoMatch() {
    setAutoMatching(true);
    setAutoPlan(null);
    try {
      const r = await fetch("/api/bindings/auto-match", { method: "POST" });
      const j = (await r.json()) as AutoMatchPlan;
      if (!r.ok) {
        toast.error("匹配失败", {
          description: (j as unknown as { error?: string }).error,
        });
        return;
      }
      setAutoPlan(j);
    } finally {
      setAutoMatching(false);
    }
  }
  async function applyAutoPlan() {
    if (!autoPlan) return;
    setAutoApplying(true);
    try {
      const r = await fetch("/api/bindings/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposed: autoPlan.proposed,
          misbound: autoPlan.misbound,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("执行失败", { description: j.error });
        return;
      }
      toast.success(`已执行 ${j.created} 条（含替换 ${j.replaced}）`);
      setAutoPlan(null);
      onRefresh();
    } finally {
      setAutoApplying(false);
    }
  }

  async function openBindDialog(row: UnboundAccountRow) {
    setBindTarget(row);
    setSelectedKeyId(null);
    if (upstreamKeyOpts.length === 0) {
      setOptsLoading(true);
      try {
        const r = await fetch("/api/bindings/options", { cache: "no-store" });
        const j = await r.json();
        setUpstreamKeyOpts((j.upstreamKeys ?? []) as UpstreamKeyOpt[]);
      } catch (e) {
        toast.error("加载 upstream key 失败", { description: String(e) });
      } finally {
        setOptsLoading(false);
      }
    }
  }
  async function doBind() {
    if (!bindTarget || !selectedKeyId) return;
    setBinding(true);
    try {
      const r = await fetch("/api/bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteBoundAccountId: bindTarget.id,
          upstreamKeyId: selectedKeyId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("绑定失败", { description: j.error });
        return;
      }
      toast.success(`已绑定 "${bindTarget.accountName}"`);
      setBindTarget(null);
      onRefresh();
    } finally {
      setBinding(false);
    }
  }

  async function openPrefixDialog() {
    // 拉一次 settings 以加载原始 raw 值（API 返回的是已解析的数组）。
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const j = await r.json();
      setPrefixDraft(j.settings?.unboundExcludePrefixes ?? "");
      setSuffixDraft(j.settings?.unboundExcludeSuffixes ?? "");
    } catch {
      setPrefixDraft("");
      setSuffixDraft("");
    }
    setEditingPrefix(true);
  }
  async function savePrefix() {
    setSavingPrefix(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unboundExcludePrefixes: prefixDraft || null,
          unboundExcludeSuffixes: suffixDraft || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return;
      }
      setEditingPrefix(false);
      toast.success("已保存");
      onRefresh();
    } finally {
      setSavingPrefix(false);
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2 mb-3 flex-wrap">
        <div className="text-xs text-muted-foreground flex-1 min-w-0">
          所有"未绑定 upstream key"的 site 账号，按近 {days} 天
          <b>收入</b> 降序排。这些账号的支出无法从 binding 推出，绑定后利润才
          算得准。
          {data?.excludePrefixes && data.excludePrefixes.length > 0 && (
            <span className="ml-1 text-amber-600 dark:text-amber-400">
              · 已排除前缀: {data.excludePrefixes.join(", ")}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={runAutoMatch}
          disabled={autoMatching}
        >
          {autoMatching && <Loader2 className="h-4 w-4 animate-spin" />}
          自动匹配绑定
        </Button>
        <Button size="sm" variant="secondary" onClick={openPrefixDialog}>
          排除前缀/后缀
          {(() => {
            const n =
              (data?.excludePrefixes?.length ?? 0) +
              (data?.excludeSuffixes?.length ?? 0);
            return n > 0 ? (
              <span className="ml-0.5 text-muted-foreground/70">({n})</span>
            ) : null;
          })()}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setEditingRules(true)}
        >
          支出规则
        </Button>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">近 N 天</label>
          <Input
            type="number"
            value={String(days)}
            className="w-24 h-8 text-sm"
            min={1}
            max={365}
            onChange={(e) => {
              const n = Math.max(1, Math.min(365, Number(e.target.value) || 30));
              onDaysChange(n);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">排序</label>
          <Select
            value={sortBy}
            onValueChange={(v) => {
              if (
                v === "lastUsed" ||
                v === "revenue" ||
                v === "accumExpense" ||
                v === "profit"
              ) {
                setSortBy(v);
              }
            }}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastUsed">最近使用</SelectItem>
              <SelectItem value="revenue">收入</SelectItem>
              <SelectItem value="accumExpense">累计支出</SelectItem>
              <SelectItem value="profit">估算利润</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
          刷新
        </Button>
      </div>

      <ExpenseRulesDialog
        isOpen={editingRules}
        onClose={() => setEditingRules(false)}
        onChanged={onRefresh}
      />

      <PrefixDialog
        isOpen={editingPrefix}
        prefixValue={prefixDraft}
        suffixValue={suffixDraft}
        onPrefixChange={setPrefixDraft}
        onSuffixChange={setSuffixDraft}
        onClose={() => setEditingPrefix(false)}
        onSave={savePrefix}
        saving={savingPrefix}
      />

      {loading && !data && (
        <div className="flex justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-card border border-border rounded-xl p-3 mb-3">
            <StatTile label="未绑定账号" value={String(data.items.length)} />
            <StatTile
              label={`近 ${data.days} 天收入`}
              value={fmtMoneyShort(data.totalRevenue)}
            />
            <StatTile
              label="1× 成本"
              value={fmtMoneyShort(data.totalCostBase)}
            />
            <StatTile
              label="估算利润"
              value={fmtMoneyShort(data.totalProfit)}
              valueClass={
                data.totalProfit > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : data.totalProfit < 0
                    ? "text-destructive"
                    : ""
              }
            />
          </div>

          {data.items.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6 text-center">
              当前没有未绑定且有使用记录的账号
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>所属站点</TableHead>
                  <TableHead>倍率</TableHead>
                  <TableHead>最近使用</TableHead>
                  <TableHead>累计支出</TableHead>
                  <TableHead>1× 成本</TableHead>
                  <TableHead>收入</TableHead>
                  <TableHead>估算利润</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const sorted = [...data.items].sort((a, b) => {
                    if (sortBy === "lastUsed") {
                      if (a.lastUsedDate == null && b.lastUsedDate == null)
                        return 0;
                      if (a.lastUsedDate == null) return 1;
                      if (b.lastUsedDate == null) return -1;
                      return a.lastUsedDate > b.lastUsedDate
                        ? -1
                        : a.lastUsedDate < b.lastUsedDate
                          ? 1
                          : 0;
                    }
                    if (sortBy === "revenue") return b.revenue - a.revenue;
                    if (sortBy === "accumExpense")
                      return b.accumExpense - a.accumExpense;
                    return b.profit - a.profit;
                  });
                  return sorted;
                })().map((r) => (
                  <TableRow
                    key={r.id}
                    className="bg-amber-50/40 dark:bg-amber-950/20"
                  >
                    <TableCell>
                      <span className="font-medium text-sm">{r.accountName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {r.siteAccountName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm tabular-nums">
                        ×{r.rateMultiplier.toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.lastUsedDate ? (
                        <span className="text-xs tabular-nums">
                          {r.lastUsedDate}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Popover
                        open={fcOpenId === r.id}
                        onOpenChange={(v) => {
                          if (v) {
                            setFcDraft((s) => ({
                              ...s,
                              [r.id]: String(r.fixedCost ?? ""),
                            }));
                            setFcOpenId(r.id);
                          } else {
                            setFcOpenId(null);
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:bg-muted/60 rounded px-1 py-0.5"
                          >
                            {r.accumExpense > 0 ? (
                              <span
                                className="tabular-nums text-primary font-medium"
                                title={fmtMoney(r.accumExpense)}
                              >
                                {fmtMoneyShort(r.accumExpense)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/70 text-xs">
                                点击设置
                              </span>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="p-3" align="start">
                          <div className="flex flex-col gap-2 w-72">
                            <div className="text-[11px] text-muted-foreground">
                              {r.accountName}
                            </div>
                            <div className="text-xs text-foreground/80">
                              历史累计支出{" "}
                              <span className="font-medium tabular-nums">
                                ${fmtMoney(r.accumExpense)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-muted-foreground">每日默认支出 (fixedCost)</label>
                              <Input
                                type="number"
                                value={fcDraft[r.id] ?? ""}
                                onChange={(e) =>
                                  setFcDraft((s) => ({ ...s, [r.id]: e.target.value }))
                                }
                                className="h-8 text-sm"
                              />
                              <p className="text-[11px] text-muted-foreground">设置后未手填支出的日子都按此金额算; 单日覆盖请在「每日明细」里改</p>
                            </div>
                            <div className="flex justify-between gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={fcSaving[r.id] || r.fixedCost == null}
                                onClick={() => saveFixedCost(r.id, true)}
                              >
                                {fcSaving[r.id] && <Loader2 className="h-4 w-4 animate-spin" />}
                                清除
                              </Button>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setFcOpenId(null)}
                                >
                                  取消
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={fcSaving[r.id]}
                                  onClick={() => saveFixedCost(r.id, false)}
                                >
                                  {fcSaving[r.id] && <Loader2 className="h-4 w-4 animate-spin" />}
                                  保存
                                </Button>
                              </div>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell>
                      <span className="tabular-nums" title={fmtMoney(r.costBase)}>
                        {fmtMoneyShort(r.costBase)}
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
                    <TableCell>
                      <span
                        className={
                          r.profit > 0
                            ? "tabular-nums font-semibold text-emerald-600 dark:text-emerald-400"
                            : r.profit < 0
                              ? "tabular-nums font-semibold text-destructive"
                              : "tabular-nums"
                        }
                        title={fmtMoney(r.profit)}
                      >
                        {fmtMoneyShort(r.profit)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openBindDialog(r)}
                      >
                        绑定
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <BindDialog
        target={bindTarget}
        upstreamKeyOpts={upstreamKeyOpts}
        optsLoading={optsLoading}
        selectedKeyId={selectedKeyId}
        onSelectKey={setSelectedKeyId}
        binding={binding}
        onClose={() => setBindTarget(null)}
        onConfirm={doBind}
      />

      <AutoMatchPlanDialog
        plan={autoPlan}
        applying={autoApplying}
        onClose={() => setAutoPlan(null)}
        onApply={applyAutoPlan}
      />
    </div>
  );
}

function StatTile({
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

function PrefixDialog({
  isOpen,
  prefixValue,
  suffixValue,
  onPrefixChange,
  onSuffixChange,
  onClose,
  onSave,
  saving,
}: {
  isOpen: boolean;
  prefixValue: string;
  suffixValue: string;
  onPrefixChange: (s: string) => void;
  onSuffixChange: (s: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>未绑定账号 · 排除前缀 / 后缀</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              以前缀匹配(大小写不敏感),账号名以这些前缀开头会被隐藏。
              一行一个;# 开头视作注释。
            </p>
            <Textarea
              placeholder={"az-\n# 隐藏所有以 trial- 开头的账号\ntrial-"}
              rows={3}
              value={prefixValue}
              onChange={(e) => onPrefixChange(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              账号名以这些后缀结尾会被隐藏。一行一个;# 开头视作注释。
            </p>
            <Textarea
              placeholder={"-o总\n# 隐藏所有以 -test 结尾的账号\n-test"}
              rows={3}
              value={suffixValue}
              onChange={(e) => onSuffixChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BindDialog({
  target,
  upstreamKeyOpts,
  optsLoading,
  selectedKeyId,
  onSelectKey,
  binding,
  onClose,
  onConfirm,
}: {
  target: UnboundAccountRow | null;
  upstreamKeyOpts: UpstreamKeyOpt[];
  optsLoading: boolean;
  selectedKeyId: number | null;
  onSelectKey: (id: number | null) => void;
  binding: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // 两段选择：先选上游账号，再选该账号下的 key。account 选项从 keys 推出。
  const [selectedAccId, setSelectedAccId] = useState<number | null>(null);
  // target 变化时重置 — Modal 关闭再开避免残留状态
  useEffect(() => {
    setSelectedAccId(null);
  }, [target]);
  // selectedKeyId 由父组件持有；如果父组件清掉了，本地的 account 也得跟着清
  useEffect(() => {
    if (selectedKeyId == null) return;
    const k = upstreamKeyOpts.find((x) => x.id === selectedKeyId);
    if (k) setSelectedAccId(k.upstreamAccountId);
  }, [selectedKeyId, upstreamKeyOpts]);

  // 去重得到上游账号列表（按 id 升序）
  const accountOpts = useMemo(() => {
    const m = new Map<number, { id: number; name: string; keyCount: number }>();
    for (const k of upstreamKeyOpts) {
      const cur = m.get(k.upstreamAccountId);
      if (cur) cur.keyCount++;
      else
        m.set(k.upstreamAccountId, {
          id: k.upstreamAccountId,
          name: k.upstreamAccountName,
          keyCount: 1,
        });
    }
    return [...m.values()].sort((a, b) => a.id - b.id);
  }, [upstreamKeyOpts]);

  // 切换账号时清掉之前选的 key（要从新账号的 keys 里重选）
  function onAccChange(accId: number | null) {
    setSelectedAccId(accId);
    if (selectedKeyId != null) {
      const k = upstreamKeyOpts.find((x) => x.id === selectedKeyId);
      if (k && k.upstreamAccountId !== accId) onSelectKey(null);
    }
  }

  const keysOfAccount = useMemo(
    () =>
      selectedAccId == null
        ? []
        : upstreamKeyOpts.filter((k) => k.upstreamAccountId === selectedAccId),
    [upstreamKeyOpts, selectedAccId],
  );

  return (
    <Dialog open={target !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>绑定到 upstream key</DialogTitle>
          {target && (
            <DialogDescription>
              {target.siteAccountName} / <b>{target.accountName}</b>
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            先选上游渠道（账号），再选该渠道下的具体 key。绑定后利润计算才能算上它的支出端。
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">① 选择上游渠道</label>
            <Select
              value={selectedAccId != null ? String(selectedAccId) : ""}
              onValueChange={(v) => onAccChange(v ? Number(v) : null)}
              disabled={optsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={optsLoading ? "加载中…" : "选择一个渠道…"} />
              </SelectTrigger>
              <SelectContent>
                {accountOpts.map((a) => (
                  <SelectItem key={String(a.id)} value={String(a.id)}>
                    <div className="flex justify-between items-center w-full">
                      <span className="text-sm">{a.name}</span>
                      <span className="text-[10px] text-muted-foreground/70 ml-2">
                        {a.keyCount} key
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">② 选择 key</label>
            <Select
              value={selectedKeyId != null ? String(selectedKeyId) : ""}
              onValueChange={(v) => onSelectKey(v ? Number(v) : null)}
              disabled={selectedAccId == null || keysOfAccount.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    selectedAccId == null
                      ? "请先选择上游渠道"
                      : keysOfAccount.length === 0
                        ? "该渠道下没有 key"
                        : "选择一个 key…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {keysOfAccount.map((opt) => {
                  const rateLabel = opt.hasExclusiveRate
                    ? `专属 ×${opt.effectiveRateMultiplier}`
                    : `×${opt.groupRateMultiplier}`;
                  return (
                    <SelectItem key={String(opt.id)} value={String(opt.id)}>
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm">
                          {opt.label.split(" / ").slice(1).join(" / ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                          {opt.groupName} · {rateLabel} · {opt.keyMasked}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={binding || !selectedKeyId}
            onClick={onConfirm}
          >
            {binding && <Loader2 className="h-4 w-4 animate-spin" />}
            确认绑定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutoMatchPlanDialog({
  plan,
  applying,
  onClose,
  onApply,
}: {
  plan: AutoMatchPlan | null;
  applying: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const hasChanges =
    plan != null && (plan.proposed.length > 0 || plan.misbound.length > 0);
  return (
    <Dialog open={plan !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>自动匹配绑定 · 预览</DialogTitle>
          <DialogDescription>
            通过对碰 sub2api admin account 的 credentials.api_key
            与 UpstreamKey.apiKey 来匹配
          </DialogDescription>
          {plan &&
            plan.excludePrefixes &&
            plan.excludePrefixes.length > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-normal">
                已按前缀排除 {plan.summary.excluded ?? 0} 个账号:{" "}
                {plan.excludePrefixes.join(", ")}
              </p>
            )}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {plan && (
            <>
              {/* 概览 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card border border-border rounded-xl p-3 text-xs">
                <div>
                  <div className="text-muted-foreground">扫描账号</div>
                  <div className="font-semibold tabular-nums">
                    {plan.summary.totalSite}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">候选 key</div>
                  <div className="font-semibold tabular-nums">
                    {plan.summary.totalUpstreamKey}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">已正确</div>
                  <div className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {plan.summary.alreadyCorrect}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">错绑</div>
                  <div className="font-semibold tabular-nums text-destructive">
                    {plan.summary.misbound}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">将新建绑定</div>
                  <div className="font-semibold tabular-nums text-primary">
                    {plan.summary.newBindings}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">匹配不到</div>
                  <div className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {plan.summary.unmatched}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">错误</div>
                  <div className="font-semibold tabular-nums text-destructive">
                    {plan.summary.errors}
                  </div>
                </div>
              </div>

              {plan.misbound.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-destructive flex items-center gap-1.5">
                    <AlertTriangle size={14} /> 错绑修正 ({plan.misbound.length})
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>站点账号</TableHead>
                        <TableHead>当前（错）</TableHead>
                        <TableHead>应改为</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan.misbound.map((m) => (
                        <TableRow
                          key={m.siteBoundAccountId}
                          className="bg-destructive/10"
                        >
                          <TableCell>
                            <span className="text-sm font-medium">{m.siteLabel}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs line-through text-muted-foreground">
                              {m.currentUpstreamLabel}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {m.correctUpstreamLabel}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              {plan.proposed.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-primary">
                    新建绑定 ({plan.proposed.length})
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>站点账号</TableHead>
                        <TableHead>要绑定的 upstream key</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan.proposed.map((p) => (
                        <TableRow key={p.siteBoundAccountId}>
                          <TableCell>
                            <span className="text-sm font-medium">{p.siteLabel}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">{p.upstreamLabel}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              {plan.unmatched.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-amber-600 dark:text-amber-400">
                    匹配不到 ({plan.unmatched.length})
                  </h4>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    这些站点账号的 credentials.api_key 在我们的 UpstreamKey 表里没找到——
                    可能上游渠道还没同步过来，或者用的是别的渠道。先去渠道管理 sync 一下。
                  </p>
                  <ul className="text-xs text-foreground/80 max-h-40 overflow-auto space-y-0.5">
                    {plan.unmatched.map((u) => (
                      <li key={u.siteBoundAccountId} className="flex justify-between">
                        <span>{u.siteLabel}</span>
                        <span className="text-muted-foreground/70 font-mono">
                          {u.apiKeyMasked}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.errors.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-destructive">
                    抓取错误 ({plan.errors.length})
                  </h4>
                  <ul className="text-xs text-foreground/80 max-h-32 overflow-auto space-y-0.5">
                    {plan.errors.slice(0, 30).map((e) => (
                      <li key={e.siteBoundAccountId}>
                        {e.siteLabel}: <span className="text-destructive">{e.error}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={applying || !hasChanges}
            onClick={onApply}
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {hasChanges
              ? `执行 ${(plan?.proposed.length ?? 0) + (plan?.misbound.length ?? 0)} 条变更`
              : "无变更可执行"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
