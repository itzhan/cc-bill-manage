"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Spinner,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs,
  addToast,
} from "@heroui/react";
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
import Shell from "@/components/Shell";
import StatCard from "@/components/StatCard";
import TopBar from "@/components/TopBar";
import ExpenseBarChart, {
  type ExpenseBarPoint,
} from "@/components/ExpenseBarChart";
import TrendLineChart, {
  type TrendPoint,
} from "@/components/TrendLineChart";
import { fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard";

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
  const sevenAgo = new Date(Date.now() - 7 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const [backfillStart, setBackfillStart] = useState<string>(sevenAgo);
  const [backfillEnd, setBackfillEnd] = useState<string>(today);
  const [backfilling, setBackfilling] = useState(false);
  const [showUnusedBindings, setShowUnusedBindings] = useState(false);

  async function loadAll(rangeArg: string = range) {
    setLoading(true);
    try {
      const [a, b, c, d] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/dashboard/timeseries?range=${rangeArg}`, {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch("/api/dashboard/top-expenses", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
        fetch("/api/daily-profit?days=30", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
      ]);
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
      addToast({ title: "加载失败", description: String(e), color: "danger" });
    } finally {
      setLoading(false);
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
        addToast({
          title: "部分失败",
          description: failed.map((f) => `${f.name}: ${f.error}`).join("; "),
          color: "warning",
        });
      } else {
        addToast({ title: successTitle, color: "success" });
      }
      await loadAll();
    } catch (e) {
      addToast({ title: "失败", description: String(e), color: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const syncNow = () => callBatch("/api/sync", "用量已更新", setSyncing);
  const refreshNow = () =>
    callBatch("/api/refresh", "结构已刷新", setRefreshing);

  async function runBackfill() {
    if (!backfillStart || !backfillEnd) {
      addToast({ title: "请选择起止日期", color: "warning" });
      return;
    }
    if (backfillStart > backfillEnd) {
      addToast({ title: "起始日期晚于结束日期", color: "warning" });
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
        addToast({ title: "回填失败", description: j.error, color: "danger" });
        return;
      }
      const j = (await r.json()) as {
        rows: { date: string }[];
        totals: { days: number; profit: number };
        errors: { date: string; kind: string; id: number; error: string }[];
      };
      addToast({
        title: `回填完成 ${j.totals.days} 天`,
        description:
          (j.errors.length
            ? `${j.errors.length} 条失败 · `
            : "") + `区间利润 ${j.totals.profit.toFixed(2)}`,
        color: j.errors.length ? "warning" : "success",
      });
      await loadAll();
    } catch (e) {
      addToast({ title: "失败", description: String(e), color: "danger" });
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(() => loadAll(), 30 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          aria-label="dashboard view"
          radius="full"
          color="default"
          variant="solid"
          selectedKey={view}
          onSelectionChange={(k) => setView(String(k))}
          classNames={{
            tabList: "bg-content2 p-1",
            cursor: "bg-content1 shadow-sm",
            tab: "px-4 h-9 data-[selected=true]:text-foreground text-default-500",
          }}
        >
          <Tab key="overview" title="总览" />
          <Tab key="revenue" title="收入" />
          <Tab key="expense" title="支出" />
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            isIconOnly
            variant="flat"
            radius="full"
            aria-label="reload"
            onPress={() => loadAll()}
            isLoading={loading}
          >
            <RefreshCw size={14} />
          </Button>
          <Dropdown>
            <DropdownTrigger>
              <Button
                variant="flat"
                radius="full"
                startContent={<Calendar size={14} />}
                endContent={<ChevronDown size={14} />}
              >
                {RANGE_LABELS[range] ?? range}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="range"
              selectedKeys={new Set([range])}
              selectionMode="single"
              onAction={(k) => {
                const r = String(k);
                setRange(r);
                loadAll(r);
              }}
            >
              {Object.entries(RANGE_LABELS).map(([k, l]) => (
                <DropdownItem key={k}>{l}</DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>
          <Button
            variant="flat"
            radius="full"
            startContent={<RefreshCw size={14} />}
            onPress={refreshNow}
            isLoading={refreshing}
          >
            完整刷新
          </Button>
          <Button
            color="primary"
            radius="full"
            startContent={<RotateCw size={14} />}
            onPress={syncNow}
            isLoading={syncing}
          >
            立即同步
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center p-12">
          <Spinner />
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
                  data.totalAzProfit !== 0
                    ? `含 az ${fmtMoneyShort(data.totalAzProfit)}`
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

          <div
            className={`grid grid-cols-1 ${view === "overview" ? "lg:grid-cols-2" : ""} gap-4 mb-6`}
          >
            {(view === "overview" || view === "expense") && (
              <Card className="bg-content1 border border-divider/50 shadow-none">
                <CardHeader className="flex justify-between items-center pb-1">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-danger/10 text-danger flex items-center justify-center">
                      <TrendingDown size={16} />
                    </div>
                    <div>
                      <h2 className="font-semibold leading-tight">支出 Top（按上游 Key）</h2>
                      <p className="text-xs text-default-500 mt-0.5">
                        今日 today_actual_cost
                      </p>
                    </div>
                  </div>
                  <Chip variant="flat" size="sm">
                    {topExpense.length} keys
                  </Chip>
                </CardHeader>
                <CardBody className="pt-2">
                  <ExpenseBarChart data={topExpense} />
                </CardBody>
              </Card>
            )}

            {(view === "overview" || view === "revenue") && (
              <Card className="bg-content1 border border-divider/50 shadow-none">
                <CardHeader className="flex justify-between items-center pb-1 gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <TrendingUp size={16} />
                    </div>
                    <div>
                      <h2 className="font-semibold leading-tight">收入·支出·利润 趋势</h2>
                      <p className="text-xs text-default-500 mt-0.5">
                        {RANGE_LABELS[range] ?? range} · 每次同步落一个快照
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardBody className="pt-2">
                  <TrendLineChart data={trend} />
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-default-500">
                    <Legend color="bg-success" label="收入" />
                    <Legend color="bg-danger" label="支出" />
                    <Legend color="bg-primary" label="利润" />
                  </div>
                </CardBody>
              </Card>
            )}
          </div>

          <Card className="bg-content1 border border-divider/50 shadow-none">
            <CardHeader className="flex justify-between items-center flex-wrap gap-2">
              <div>
                <h2 className="font-semibold">利润明细</h2>
                <p className="text-xs text-default-500 mt-0.5">
                  上游绑定（含差异）+ az 站点账号
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-default-500">
                <Checkbox
                  size="sm"
                  isSelected={showUnusedBindings}
                  onValueChange={setShowUnusedBindings}
                >
                  <span className="text-xs">显示今日无使用</span>
                </Checkbox>
                <span>
                  本站 1× <b className="text-foreground">{fmtMoneyShort(data.totalSiteCostBase)}</b>
                </span>
                <span>·</span>
                <span>
                  上游 1× <b className="text-foreground">{fmtMoneyShort(data.totalUpstreamCostBase)}</b>
                </span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="text-xs font-medium text-default-500 mb-2">
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
                    <p className="text-default-500 text-sm">
                      暂无绑定。先在「绑定」页配置。
                    </p>
                  );
                }
                if (visibleBindings.length === 0) {
                  return (
                    <p className="text-default-500 text-sm">
                      今日暂无使用记录。勾选「显示今日无使用」查看全部 {data.bindings.length} 个绑定。
                    </p>
                  );
                }
                return (
                <Table aria-label="bindings" removeWrapper>
                  <TableHeader>
                    <TableColumn>本站 → 上游</TableColumn>
                    <TableColumn>收入</TableColumn>
                    <TableColumn>支出</TableColumn>
                    <TableColumn>利润</TableColumn>
                    <TableColumn>差异 (1×)</TableColumn>
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
                              <span className="text-xs text-default-400">
                                {b.upstreamGroupName} ×
                                {b.upstreamEffectiveMultiplier}
                                {b.upstreamHasExclusiveRate && (
                                  <span className="text-primary">（专属）</span>
                                )}
                              </span>
                              <span className="text-xs text-default-500 mt-0.5">
                                ← {b.siteAccounts.length} 个本站绑定
                                {b.siteAccounts.length > 1 && (
                                  <span
                                    className="ml-1 text-default-400"
                                    title={b.siteAccounts
                                      .map((s) => s.name)
                                      .join("\n")}
                                  >
                                    （hover 查看）
                                  </span>
                                )}
                              </span>
                              {b.siteAccounts.length === 1 ? (
                                <span className="text-xs text-default-400">
                                  · {b.siteAccounts[0].name}
                                </span>
                              ) : (
                                <span className="text-xs text-default-400 truncate max-w-md">
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
                              <span className="text-xs text-default-400">
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
                                  ? "font-semibold text-success"
                                  : profit < 0
                                    ? "font-semibold text-danger"
                                    : "text-default-500"
                              }
                            >
                              {fmtMoneyShort(profit)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                diffOver
                                  ? "text-danger font-semibold"
                                  : "text-default-500"
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

              <div className="text-xs font-medium text-default-500 mt-6 mb-2 flex items-center gap-2">
                <span>az 站点账号</span>
                <span className="text-default-400 font-normal">
                  收入 {fmtMoneyShort(data.totalAzRevenue)} · 成本{" "}
                  {fmtMoneyShort(data.totalAzExpense)} · 利润{" "}
                  <b
                    className={
                      data.totalAzProfit > 0
                        ? "text-success"
                        : data.totalAzProfit < 0
                          ? "text-danger"
                          : ""
                    }
                  >
                    {fmtMoneyShort(data.totalAzProfit)}
                  </b>
                </span>
              </div>
              {(() => {
                const visibleAz = showUnusedBindings
                  ? data.azAccounts
                  : data.azAccounts.filter(
                      (a) => a.todayCost > 0 || a.todayUserCost > 0,
                    );
                if (data.azAccounts.length === 0) {
                  return (
                    <p className="text-default-500 text-sm">
                      暂无 az 账号。在「az 管理」页批量创建后会自动出现。
                    </p>
                  );
                }
                if (visibleAz.length === 0) {
                  return (
                    <p className="text-default-500 text-sm">
                      今日 az 暂无使用。勾选「显示今日无使用」查看全部{" "}
                      {data.azAccounts.length} 个账号。
                    </p>
                  );
                }
                return (
                  <Table aria-label="az accounts" removeWrapper>
                    <TableHeader>
                      <TableColumn>账号</TableColumn>
                      <TableColumn>收入</TableColumn>
                      <TableColumn>成本</TableColumn>
                      <TableColumn>利润</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {visibleAz.map((a) => (
                        <TableRow key={a.siteBoundAccountId}>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="text-sm font-medium">
                                {a.name}
                              </span>
                              <span className="text-xs text-default-400">
                                {a.siteAccountName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium">
                                {fmtMoneyShort(a.todayUserCost)}
                              </span>
                              <span className="text-xs text-default-400">
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
                                <span className="text-xs text-default-400">
                                  固定
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                a.profit > 0
                                  ? "font-semibold text-success"
                                  : a.profit < 0
                                    ? "font-semibold text-danger"
                                    : "text-default-500"
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
            </CardBody>
          </Card>

          <Card className="bg-content1 border border-divider/50 shadow-none mt-6">
            <CardHeader className="flex justify-between items-start flex-wrap gap-3">
              <div>
                <h2 className="font-semibold">每日利润</h2>
                <p className="text-xs text-default-500 mt-0.5">
                  按 Asia/Shanghai 日期。当天的行随每次同步刷新；跨天后自然冻结。可选起止日期回填历史
                </p>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <Input
                  type="date"
                  size="sm"
                  label="起"
                  value={backfillStart}
                  onValueChange={setBackfillStart}
                  className="w-[150px]"
                />
                <Input
                  type="date"
                  size="sm"
                  label="止"
                  value={backfillEnd}
                  onValueChange={setBackfillEnd}
                  className="w-[150px]"
                />
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={runBackfill}
                  isLoading={backfilling}
                >
                  回填
                </Button>
                <span className="text-xs text-default-500 self-center ml-2">
                  累计利润{" "}
                  <b className="text-foreground">
                    {fmtMoneyShort(
                      daily.reduce((s, d) => s + d.profit, 0),
                    )}
                  </b>
                </span>
              </div>
            </CardHeader>
            <CardBody>
              {daily.length === 0 ? (
                <p className="text-default-500 text-sm">
                  暂无每日记录。每次同步会写入当天的累计值
                </p>
              ) : (
                <Table removeWrapper aria-label="daily profit">
                  <TableHeader>
                    <TableColumn>日期</TableColumn>
                    <TableColumn>收入</TableColumn>
                    <TableColumn>支出</TableColumn>
                    <TableColumn>利润</TableColumn>
                    <TableColumn>差异 / 盈余 (1×)</TableColumn>
                    <TableColumn>更新时间</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {daily.map((d, i) => {
                      const isToday = i === 0;
                      return (
                        <TableRow key={d.id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{d.date}</span>
                              {isToday && (
                                <Chip
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  classNames={{
                                    base: "h-4",
                                    content: "text-[10px] px-1",
                                  }}
                                >
                                  今天
                                </Chip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{fmtMoneyShort(d.revenue)}</TableCell>
                          <TableCell>{fmtMoneyShort(d.expense)}</TableCell>
                          <TableCell>
                            <span
                              className={
                                d.profit > 0
                                  ? "font-semibold text-success"
                                  : d.profit < 0
                                    ? "font-semibold text-danger"
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
                                    className="text-danger font-medium"
                                    title={`上游 1× ${fmtMoneyShort(d.upstreamCostBase)} > 本站 1× ${fmtMoneyShort(d.siteCostBase)}`}
                                  >
                                    −{fmtMoneyShort(d.diff)}
                                  </span>
                                );
                              }
                              if (surplus > 0) {
                                return (
                                  <span
                                    className="text-success font-medium"
                                    title={`本站 1× ${fmtMoneyShort(d.siteCostBase)} > 上游 1× ${fmtMoneyShort(d.upstreamCostBase)}`}
                                  >
                                    +{fmtMoneyShort(surplus)}
                                  </span>
                                );
                              }
                              return (
                                <span className="text-default-400">0</span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-xs text-default-400">
                            {fmtDate(d.updatedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
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
