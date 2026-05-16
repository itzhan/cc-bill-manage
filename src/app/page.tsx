"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectItem,
  Spinner,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
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
import { type TrendPoint } from "@/components/TrendLineChart";
import DailyRevenueChart from "@/components/DailyRevenueChart";
import DailyDetailModal, {
  ExpenseRulesDialog,
} from "@/components/DailyDetailModal";
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
}
interface UnboundAccountsResp {
  days: number;
  totalRevenue: number;
  totalCostBase: number;
  totalProfit: number;
  items: UnboundAccountRow[];
  excludePrefixes?: string[];
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
        fetch(`/api/daily-profit?days=30&_=${ts}`, { cache: "no-store" }).then((r) =>
          r.json(),
        ),
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
      addToast({ title: "加载失败", description: String(e), color: "danger" });
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

        <div className="flex items-center gap-2 flex-wrap">
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
                <span className="hidden sm:inline">
                  {RANGE_LABELS[range] ?? range}
                </span>
                <span className="sm:hidden">{range}</span>
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
            isIconOnly={false}
            onPress={refreshNow}
            isLoading={refreshing}
            startContent={<RefreshCw size={14} />}
          >
            <span className="hidden sm:inline">完整刷新</span>
            <span className="sm:hidden">刷新</span>
          </Button>
          <Button
            color="primary"
            radius="full"
            startContent={<RotateCw size={14} />}
            onPress={syncNow}
            isLoading={syncing}
          >
            <span className="hidden sm:inline">立即同步</span>
            <span className="sm:hidden">同步</span>
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

          {view !== "overview" && (
            <div className="grid grid-cols-1 gap-4 mb-6">
              {view === "expense" && (
                <Card className="bg-content1 border border-divider/50 shadow-none">
                  <CardHeader className="flex justify-between items-center pb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-danger/10 text-danger flex items-center justify-center">
                        <TrendingDown size={16} />
                      </div>
                      <div>
                        <h2 className="font-semibold leading-tight">
                          支出 Top（按上游 Key）
                        </h2>
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

              {view === "revenue" && (
                <Card className="bg-content1 border border-divider/50 shadow-none">
                  <CardHeader className="flex justify-between items-center pb-1 gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-success/10 text-success flex items-center justify-center">
                        <TrendingUp size={16} />
                      </div>
                      <div>
                        <h2 className="font-semibold leading-tight">每日收入</h2>
                        <p className="text-xs text-default-500 mt-0.5">
                          按 Asia/Shanghai 日期 · 最近 {daily.length} 天
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardBody className="pt-2">
                    <DailyRevenueChart data={daily} />
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {view === "overview" && (
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
                    <TableColumn>本站 1×</TableColumn>
                    <TableColumn>上游 1×</TableColumn>
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
                // az 段固定只展示今日有收入的账号（todayUserCost > 0）—
                // 不受上方"显示今日无使用" checkbox 影响（该 checkbox 只
                //控制上游绑定段）。固定成本 fixedCost 不算"今日有消费"。
                const visibleAz = data.azAccounts.filter(
                  (a) => a.todayUserCost > 0,
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
                      今日 az 暂无使用。共{" "}
                      {data.azAccounts.length} 个 az 账号。
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
          )}

          <Card className="bg-content1 border border-divider/50 shadow-none mt-6">
            <CardHeader className="flex flex-col items-start gap-3">
              <div className="flex justify-between items-start flex-wrap gap-3 w-full">
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
                    <span className="text-xs text-default-500 self-center ml-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        累计利润{" "}
                        <b
                          className={
                            grossProfit > 0
                              ? "text-success"
                              : grossProfit < 0
                                ? "text-danger"
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
                            <b className="text-warning">
                              −{fmtMoneyShort(azInvestment)}
                            </b>
                          </span>
                          <span>
                            净利润{" "}
                            <b
                              className={
                                netProfit > 0
                                  ? "text-success"
                                  : netProfit < 0
                                    ? "text-danger"
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
                        <b className="text-success">
                          +{fmtMoneyShort(totalSurplus)}
                        </b>
                        {surplusDays > 0 && (
                          <span className="text-default-400 ml-0.5">
                            · {surplusDays} 天
                          </span>
                        )}
                      </span>
                      <span>
                        累计差异{" "}
                        <b className="text-danger">−{fmtMoneyShort(totalLoss)}</b>
                        {lossDays > 0 && (
                          <span className="text-default-400 ml-0.5">
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
                size="sm"
                selectedKey={dailyView}
                onSelectionChange={(k) =>
                  setDailyView(String(k) as "by-date" | "unbound")
                }
              >
                <Tab key="by-date" title="按日期" />
                <Tab
                  key="unbound"
                  title={
                    <span className="flex items-center gap-1.5">
                      未绑定账号
                      {unbound && unbound.items.length > 0 && (
                        <Chip
                          size="sm"
                          color="warning"
                          variant="flat"
                          classNames={{
                            base: "h-4",
                            content: "text-[10px] px-1",
                          }}
                        >
                          {unbound.items.length}
                        </Chip>
                      )}
                    </span>
                  }
                />
              </Tabs>
            </CardHeader>
            <CardBody>
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
                        <TableRow
                          key={d.id}
                          className="cursor-pointer hover:bg-content2/60 transition-colors"
                          onClick={() => setDetailDate(d.date)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium underline decoration-dotted underline-offset-2">
                                {d.date}
                              </span>
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
  const [savingPrefix, setSavingPrefix] = useState(false);
  // "支出规则" 弹窗 — 跟每日明细 modal 里的 ExpenseRulesDialog 共用
  const [editingRules, setEditingRules] = useState(false);

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
      addToast({ title: "数值非法", color: "warning" });
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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({
        title: clear ? "已清除一次性投入" : "已保存一次性投入",
        color: "success",
      });
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
        addToast({
          title: "匹配失败",
          description: (j as unknown as { error?: string }).error,
          color: "danger",
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
        addToast({
          title: "执行失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      addToast({
        title: `已执行 ${j.created} 条（含替换 ${j.replaced}）`,
        color: "success",
      });
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
        addToast({
          title: "加载 upstream key 失败",
          description: String(e),
          color: "danger",
        });
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
        addToast({
          title: "绑定失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      addToast({
        title: `已绑定 "${bindTarget.accountName}"`,
        color: "success",
      });
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
    } catch {
      setPrefixDraft("");
    }
    setEditingPrefix(true);
  }
  async function savePrefix() {
    setSavingPrefix(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unboundExcludePrefixes: prefixDraft || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      setEditingPrefix(false);
      addToast({ title: "已保存", color: "success" });
      onRefresh();
    } finally {
      setSavingPrefix(false);
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2 mb-3 flex-wrap">
        <div className="text-xs text-default-500 flex-1 min-w-0">
          所有"未绑定 upstream key"的 site 账号，按近 {days} 天
          <b>收入</b> 降序排。这些账号的支出无法从 binding 推出，绑定后利润才
          算得准。
          {data?.excludePrefixes && data.excludePrefixes.length > 0 && (
            <span className="ml-1 text-warning">
              · 已排除前缀: {data.excludePrefixes.join(", ")}
            </span>
          )}
        </div>
        <Button
          size="sm"
          color="primary"
          variant="flat"
          onPress={runAutoMatch}
          isLoading={autoMatching}
        >
          自动匹配绑定
        </Button>
        <Button size="sm" variant="flat" onPress={openPrefixDialog}>
          排除前缀
          {data?.excludePrefixes && data.excludePrefixes.length > 0 && (
            <span className="ml-0.5 text-default-400">
              ({data.excludePrefixes.length})
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant="flat"
          onPress={() => setEditingRules(true)}
        >
          支出规则
        </Button>
        <Input
          type="number"
          size="sm"
          label="近 N 天"
          value={String(days)}
          className="w-24"
          min={1}
          max={365}
          onValueChange={(s) => {
            const n = Math.max(1, Math.min(365, Number(s) || 30));
            onDaysChange(n);
          }}
        />
        <Button
          size="sm"
          variant="flat"
          startContent={<RefreshCw size={14} />}
          onPress={onRefresh}
          isLoading={loading}
        >
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
        value={prefixDraft}
        onChange={setPrefixDraft}
        onClose={() => setEditingPrefix(false)}
        onSave={savePrefix}
        saving={savingPrefix}
      />

      {loading && !data && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-content2/40 rounded-xl p-3 mb-3">
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
                  ? "text-success"
                  : data.totalProfit < 0
                    ? "text-danger"
                    : ""
              }
            />
          </div>

          {data.items.length === 0 ? (
            <p className="text-default-500 text-sm py-6 text-center">
              当前没有未绑定且有使用记录的账号
            </p>
          ) : (
            <Table removeWrapper aria-label="unbound accounts">
              <TableHeader>
                <TableColumn>账号</TableColumn>
                <TableColumn>所属站点</TableColumn>
                <TableColumn>倍率</TableColumn>
                <TableColumn>一次性投入</TableColumn>
                <TableColumn>1× 成本</TableColumn>
                <TableColumn>收入</TableColumn>
                <TableColumn>估算利润</TableColumn>
                <TableColumn>操作</TableColumn>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow
                    key={r.id}
                    className="bg-warning-50/40 dark:bg-warning-950/20"
                  >
                    <TableCell>
                      <span className="font-medium text-sm">{r.accountName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-default-500">
                        {r.siteAccountName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm tabular-nums">
                        ×{r.rateMultiplier.toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Popover
                        isOpen={fcOpenId === r.id}
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
                        placement="bottom-start"
                      >
                        <PopoverTrigger>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:bg-content2/60 rounded px-1 py-0.5"
                          >
                            {r.fixedCost != null ? (
                              <span
                                className="tabular-nums text-primary font-medium"
                                title={fmtMoney(r.fixedCost)}
                              >
                                {fmtMoneyShort(r.fixedCost)}
                              </span>
                            ) : (
                              <span className="text-default-400 text-xs">点击设置</span>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="p-3">
                          <div className="flex flex-col gap-2 w-64">
                            <div className="text-[11px] text-default-500">
                              {r.accountName}
                            </div>
                            <Input
                              type="number"
                              size="sm"
                              label="一次性投入"
                              value={fcDraft[r.id] ?? ""}
                              onValueChange={(v) =>
                                setFcDraft((s) => ({ ...s, [r.id]: v }))
                              }
                              description="设置后每日支出按此金额算，sync/backfill 不会覆盖"
                            />
                            <div className="flex justify-between gap-2">
                              <Button
                                size="sm"
                                variant="flat"
                                isLoading={fcSaving[r.id]}
                                isDisabled={r.fixedCost == null}
                                onPress={() => saveFixedCost(r.id, true)}
                              >
                                清除
                              </Button>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => setFcOpenId(null)}
                                >
                                  取消
                                </Button>
                                <Button
                                  size="sm"
                                  color="primary"
                                  isLoading={fcSaving[r.id]}
                                  onPress={() => saveFixedCost(r.id, false)}
                                >
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
                        className="tabular-nums font-semibold text-warning"
                        title={fmtMoney(r.revenue)}
                      >
                        {fmtMoneyShort(r.revenue)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          r.profit > 0
                            ? "tabular-nums font-semibold text-success"
                            : r.profit < 0
                              ? "tabular-nums font-semibold text-danger"
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
                        color="primary"
                        variant="flat"
                        onPress={() => openBindDialog(r)}
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
      <span className="text-[11px] text-default-500">{label}</span>
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
  value,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  isOpen: boolean;
  value: string;
  onChange: (s: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>未绑定账号 · 排除前缀</ModalHeader>
        <ModalBody>
          <p className="text-xs text-default-500">
            以前缀匹配（区分大小写不敏感），账号名以这些前缀开头会被隐藏。
            一行一个；# 开头视作注释。例如：
          </p>
          <Textarea
            minRows={4}
            placeholder={"az-\n# 隐藏所有以 trial- 开头的账号\ntrial-"}
            value={value}
            onValueChange={onChange}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" isLoading={saving} onPress={onSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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
    <Modal isOpen={target !== null} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex flex-col items-start gap-0.5">
          <span>绑定到 upstream key</span>
          {target && (
            <span className="text-xs text-default-500 font-normal">
              {target.siteAccountName} / <b>{target.accountName}</b>
            </span>
          )}
        </ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-xs text-default-500">
            先选上游渠道（账号），再选该渠道下的具体 key。绑定后利润计算才能算上它的支出端。
          </p>
          <Select
            label="① 选择上游渠道"
            placeholder={optsLoading ? "加载中…" : "选择一个渠道…"}
            selectedKeys={
              selectedAccId != null ? new Set([String(selectedAccId)]) : new Set()
            }
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0];
              onAccChange(v ? Number(v) : null);
            }}
            isDisabled={optsLoading}
          >
            {accountOpts.map((a) => (
              <SelectItem key={String(a.id)} textValue={a.name}>
                <div className="flex justify-between items-center w-full">
                  <span className="text-sm">{a.name}</span>
                  <span className="text-[10px] text-default-400 ml-2">
                    {a.keyCount} key
                  </span>
                </div>
              </SelectItem>
            ))}
          </Select>
          <Select
            label="② 选择 key"
            placeholder={
              selectedAccId == null
                ? "请先选择上游渠道"
                : keysOfAccount.length === 0
                  ? "该渠道下没有 key"
                  : "选择一个 key…"
            }
            selectedKeys={
              selectedKeyId != null ? new Set([String(selectedKeyId)]) : new Set()
            }
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0];
              onSelectKey(v ? Number(v) : null);
            }}
            isDisabled={selectedAccId == null || keysOfAccount.length === 0}
          >
            {keysOfAccount.map((opt) => {
              const rateLabel = opt.hasExclusiveRate
                ? `专属 ×${opt.effectiveRateMultiplier}`
                : `×${opt.groupRateMultiplier}`;
              return (
                <SelectItem key={String(opt.id)} textValue={opt.label}>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm">
                      {opt.label.split(" / ").slice(1).join(" / ")}
                    </span>
                    <span className="text-[10px] text-default-400">
                      {opt.groupName} · {rateLabel} · {opt.keyMasked}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button
            color="primary"
            isLoading={binding}
            isDisabled={!selectedKeyId}
            onPress={onConfirm}
          >
            确认绑定
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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
    <Modal isOpen={plan !== null} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col items-start gap-0.5">
          <span>自动匹配绑定 · 预览</span>
          <span className="text-xs text-default-500 font-normal">
            通过对碰 sub2api admin account 的 credentials.api_key
            与 UpstreamKey.apiKey 来匹配
          </span>
          {plan &&
            plan.excludePrefixes &&
            plan.excludePrefixes.length > 0 && (
              <span className="text-[11px] text-warning font-normal">
                已按前缀排除 {plan.summary.excluded ?? 0} 个账号:{" "}
                {plan.excludePrefixes.join(", ")}
              </span>
            )}
        </ModalHeader>
        <ModalBody className="gap-3">
          {plan && (
            <>
              {/* 概览 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-content2/40 rounded-xl p-3 text-xs">
                <div>
                  <div className="text-default-500">扫描账号</div>
                  <div className="font-semibold tabular-nums">
                    {plan.summary.totalSite}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">候选 key</div>
                  <div className="font-semibold tabular-nums">
                    {plan.summary.totalUpstreamKey}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">已正确</div>
                  <div className="font-semibold tabular-nums text-success">
                    {plan.summary.alreadyCorrect}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">错绑</div>
                  <div className="font-semibold tabular-nums text-danger">
                    {plan.summary.misbound}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">将新建绑定</div>
                  <div className="font-semibold tabular-nums text-primary">
                    {plan.summary.newBindings}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">匹配不到</div>
                  <div className="font-semibold tabular-nums text-warning">
                    {plan.summary.unmatched}
                  </div>
                </div>
                <div>
                  <div className="text-default-500">错误</div>
                  <div className="font-semibold tabular-nums text-danger">
                    {plan.summary.errors}
                  </div>
                </div>
              </div>

              {plan.misbound.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-danger flex items-center gap-1.5">
                    <AlertTriangle size={14} /> 错绑修正 ({plan.misbound.length})
                  </h4>
                  <Table removeWrapper aria-label="misbound">
                    <TableHeader>
                      <TableColumn>站点账号</TableColumn>
                      <TableColumn>当前（错）</TableColumn>
                      <TableColumn>应改为</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {plan.misbound.map((m) => (
                        <TableRow
                          key={m.siteBoundAccountId}
                          className="bg-danger-50/30 dark:bg-danger-950/20"
                        >
                          <TableCell>
                            <span className="text-sm font-medium">{m.siteLabel}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs line-through text-default-500">
                              {m.currentUpstreamLabel}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-success">
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
                  <Table removeWrapper aria-label="proposed">
                    <TableHeader>
                      <TableColumn>站点账号</TableColumn>
                      <TableColumn>要绑定的 upstream key</TableColumn>
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
                  <h4 className="text-sm font-semibold mb-1.5 text-warning">
                    匹配不到 ({plan.unmatched.length})
                  </h4>
                  <p className="text-[11px] text-default-500 mb-1.5">
                    这些站点账号的 credentials.api_key 在我们的 UpstreamKey 表里没找到——
                    可能上游渠道还没同步过来，或者用的是别的渠道。先去渠道管理 sync 一下。
                  </p>
                  <ul className="text-xs text-default-600 max-h-40 overflow-auto space-y-0.5">
                    {plan.unmatched.map((u) => (
                      <li key={u.siteBoundAccountId} className="flex justify-between">
                        <span>{u.siteLabel}</span>
                        <span className="text-default-400 font-mono">
                          {u.apiKeyMasked}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.errors.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1.5 text-danger">
                    抓取错误 ({plan.errors.length})
                  </h4>
                  <ul className="text-xs text-default-600 max-h-32 overflow-auto space-y-0.5">
                    {plan.errors.slice(0, 30).map((e) => (
                      <li key={e.siteBoundAccountId}>
                        {e.siteLabel}: <span className="text-danger">{e.error}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button
            color="primary"
            isLoading={applying}
            isDisabled={!hasChanges}
            onPress={onApply}
          >
            {hasChanges
              ? `执行 ${(plan?.proposed.length ?? 0) + (plan?.misbound.length ?? 0)} 条变更`
              : "无变更可执行"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
