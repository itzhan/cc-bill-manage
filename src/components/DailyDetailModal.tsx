"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
import { Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { fmtMoney, fmtMoneyShort } from "@/lib/format";

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
  expense: number;
  expenseSynced?: number;
  expenseIsManual?: boolean;
  siteCostBase: number;
  upstreamCostBase: number;
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
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="5xl" scrollBehavior="inside">
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span>每日明细 · {date}</span>
                {data && (
                  <span
                    className={
                      data.totals.profit >= 0
                        ? "text-success font-semibold"
                        : "text-danger font-semibold"
                    }
                  >
                    利润 {fmtMoneyShort(data.totals.profit)}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<RefreshCw size={14} />}
                  isLoading={refreshing}
                  onPress={() => load(true)}
                >
                  重新从上游拉取
                </Button>
              </div>
              <p className="text-xs text-default-500 font-normal">
                按 key 配对的当日明细，按利润降序。橙色行 = 无 upstream 绑定（如 AZ 渠道）。
                数据默认从本地存档读取，点"重新从上游拉取"可强制重抓。
              </p>
              {data?.fromCache && (
                <Chip size="sm" color="default" variant="flat">
                  📦 本地存档
                  {data.cachedAt &&
                    ` · ${new Date(data.cachedAt).toLocaleString("zh-CN")}`}
                </Chip>
              )}
            </ModalHeader>
            <ModalBody className="pb-6">
              {loading && (
                <div className="flex justify-center p-8">
                  <Spinner label="加载明细中" />
                </div>
              )}
              {err && <div className="text-danger text-sm py-3">{err}</div>}
              {data && (
                <>
                  <TotalsCard b={data} />

                  {data.errors.length > 0 && (
                    <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 my-3 text-sm">
                      <div className="font-medium text-danger mb-1">
                        {data.errors.length} 个抓取错误（该行数据可能不全）
                      </div>
                      <ul className="text-xs text-danger/80 space-y-0.5 max-h-32 overflow-auto">
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
                    selectedKey={view}
                    onSelectionChange={(k) =>
                      setView(String(k) as "paired" | "unbound")
                    }
                    size="sm"
                  >
                    <Tab
                      key="paired"
                      title={
                        <span className="flex items-center gap-1.5">
                          逐 key 利润
                          <Chip size="sm" variant="flat">
                            {data.paired.length}
                          </Chip>
                        </span>
                      }
                    />
                    <Tab
                      key="unbound"
                      title={
                        <span className="flex items-center gap-1.5">
                          未绑定账号
                          <Chip
                            size="sm"
                            variant="flat"
                            color={unboundRows.length > 0 ? "warning" : "default"}
                          >
                            {unboundRows.length}
                          </Chip>
                        </span>
                      }
                    />
                  </Tabs>

                  {view === "unbound" ? (
                    <section className="mt-2">
                      <p className="text-[11px] text-default-500 mb-2">
                        当天有使用但<b>未绑定 upstream key</b> 的 site 账号，按收入降序排。
                        这些账号的支出不在利润计算里——绑定后才能算出真实利润。
                        共 {unboundRows.length} 个，今日收入合计{" "}
                        <b>{fmtMoneyShort(unboundTotal)}</b>。
                      </p>
                      {unboundRows.length === 0 ? (
                        <p className="text-default-500 text-sm">
                          没有未绑定账号 — 当天所有使用过的账号都已正确配对
                        </p>
                      ) : (
                        <Table aria-label="unbound site accounts" removeWrapper>
                          <TableHeader>
                            <TableColumn>账号</TableColumn>
                            <TableColumn>所属站点</TableColumn>
                            <TableColumn>倍率</TableColumn>
                            <TableColumn>1× 成本</TableColumn>
                            <TableColumn>今日收入</TableColumn>
                          </TableHeader>
                          <TableBody>
                            {unboundRows.map((r) => {
                              const sa = r.siteAccounts?.[0];
                              return (
                                <TableRow
                                  key={r.rowKey}
                                  className="bg-warning-50/40 dark:bg-warning-950/20"
                                >
                                  <TableCell>
                                    <span className="font-medium text-sm">
                                      {sa?.accountName ?? r.label}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-xs text-default-500">
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
                                      className="tabular-nums font-semibold text-warning"
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
                      <p className="text-[11px] text-default-400 mb-2">
                        按利润降序 · 当天 0 流量已隐藏 · 橙色行 = 未绑定 upstream
                      </p>
                    {data.paired.length === 0 ? (
                      <p className="text-default-500 text-sm">当天无任何使用记录</p>
                    ) : (
                      <Table aria-label="paired breakdown" removeWrapper>
                        <TableHeader>
                          <TableColumn>名称</TableColumn>
                          <TableColumn>收入</TableColumn>
                          <TableColumn>支出</TableColumn>
                          <TableColumn>本站 1×</TableColumn>
                          <TableColumn>上游 1×</TableColumn>
                          <TableColumn>1× 差异</TableColumn>
                          <TableColumn>利润</TableColumn>
                        </TableHeader>
                        <TableBody>
                          {data.paired.map((r) => {
                            const isUnbound = r.kind === "unbound_site";
                            const profitNet = r.revenue - r.expense - r.diff; // 第一行：扣 1× 差异
                            const profitGross = r.revenue - r.expense; // 第二行：粗利润
                            return (
                              <TableRow
                                key={r.rowKey}
                                className={
                                  isUnbound
                                    ? "bg-warning-50 dark:bg-warning-950/30"
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
                                        <Chip
                                          size="sm"
                                          variant="flat"
                                          classNames={{
                                            base: "h-5",
                                            content: "text-[10px] px-1.5",
                                          }}
                                        >
                                          {r.groupName}
                                          {r.effectiveRate != null &&
                                            ` ×${r.effectiveRate.toFixed(2)}`}
                                        </Chip>
                                      )}
                                      {r.rechargeMultiplier != null &&
                                        r.rechargeMultiplier !== 1 && (
                                          <Chip
                                            size="sm"
                                            color="primary"
                                            variant="flat"
                                            classNames={{
                                              base: "h-5",
                                              content: "text-[10px] px-1.5",
                                            }}
                                          >
                                            充值 ×{r.rechargeMultiplier.toFixed(2)}
                                          </Chip>
                                        )}
                                    </div>
                                    {isUnbound && (
                                      <span className="text-[10px] text-warning font-medium">
                                        ⚠ 未绑定 upstream（不计支出）
                                      </span>
                                    )}
                                    {r.siteAccounts &&
                                      r.siteAccounts.length > 1 && (
                                        <span className="text-[10px] text-default-400">
                                          含 {r.siteAccounts.length} 个绑定账号
                                        </span>
                                      )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className="tabular-nums"
                                    title={fmtMoney(r.revenue)}
                                  >
                                    {fmtMoneyShort(r.revenue)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <ExpenseCell row={r} date={data.date} onChanged={reload} />
                                </TableCell>
                                <TableCell>
                                  <span
                                    className="tabular-nums text-default-500"
                                    title={fmtMoney(r.siteCostBase)}
                                  >
                                    {fmtMoneyShort(r.siteCostBase)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className="tabular-nums text-default-500"
                                    title={fmtMoney(r.upstreamCostBase)}
                                  >
                                    {fmtMoneyShort(r.upstreamCostBase)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={
                                      r.diff > 0
                                        ? "tabular-nums text-warning"
                                        : "tabular-nums text-default-400"
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
                                          ? "tabular-nums font-semibold text-success"
                                          : profitNet < 0
                                            ? "tabular-nums font-semibold text-danger"
                                            : "tabular-nums font-medium"
                                      }
                                      title={`扣 1× 差异: ${fmtMoney(profitNet)}`}
                                    >
                                      {fmtMoneyShort(profitNet)}
                                    </span>
                                    <span
                                      className={
                                        profitGross > 0
                                          ? "tabular-nums text-[11px] text-success/70"
                                          : profitGross < 0
                                            ? "tabular-nums text-[11px] text-danger/70"
                                            : "tabular-nums text-[11px] text-default-400"
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
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function TotalsCard({ b }: { b: Breakdown }) {
  const { totals } = b;
  const profitClass =
    totals.profit > 0 ? "text-success" : totals.profit < 0 ? "text-danger" : "";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-content2/40 rounded-xl p-4">
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
      <span className="text-[11px] text-default-500">{label}</span>
      <span
        className={`text-lg font-semibold tabular-nums tracking-tight ${valueClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function ExpenseCell({
  row,
  date,
  onChanged,
}: {
  row: PairedRow;
  date: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const canEdit = row.upstreamKeyId != null;
  const isManual = row.expenseIsManual === true;

  async function save(clear: boolean) {
    if (!row.upstreamKeyId) return;
    const v = clear ? null : Number(draft);
    if (!clear && (!Number.isFinite(v as number) || (v as number) < 0)) {
      addToast({ title: "支出数值非法", color: "warning" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(
        `/api/daily-profit/${date}/breakdown/upstream/${row.upstreamKeyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manualActualCost: v }),
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({
        title: clear ? "已恢复同步值" : "已保存手动支出",
        color: "success",
      });
      setOpen(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const displayValue = (
    <span
      className={isManual ? "tabular-nums text-primary font-medium" : "tabular-nums"}
      title={
        isManual && row.expenseSynced != null
          ? `手动: ${fmtMoney(row.expense)} (同步值 ${fmtMoney(row.expenseSynced)})`
          : fmtMoney(row.expense)
      }
    >
      {fmtMoneyShort(row.expense)}
      {isManual && <span className="ml-1 text-[10px] text-primary">✎</span>}
    </span>
  );

  if (!canEdit) {
    return <span className="tabular-nums text-default-400">{fmtMoneyShort(row.expense)}</span>;
  }
  return (
    <Popover
      isOpen={open}
      onOpenChange={(v) => {
        if (v) setDraft(String(row.expense));
        setOpen(v);
      }}
      placement="bottom-start"
    >
      <PopoverTrigger>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:bg-content2/60 rounded px-1 py-0.5"
        >
          {displayValue}
          <Pencil size={11} className="text-default-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-3">
        <div className="flex flex-col gap-2 w-64">
          <div className="text-[11px] text-default-500">
            {row.label}
          </div>
          <Input
            type="number"
            size="sm"
            label="手动支出"
            value={draft}
            onValueChange={setDraft}
            description={
              row.expenseSynced != null
                ? `同步值 ${fmtMoneyShort(row.expenseSynced)}`
                : `当前同步值 ${fmtMoneyShort(row.expense)}`
            }
          />
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="flat"
              startContent={<RotateCcw size={12} />}
              isLoading={saving}
              isDisabled={!isManual}
              onPress={() => save(true)}
            >
              恢复同步
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="flat" onPress={() => setOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                color="primary"
                isLoading={saving}
                onPress={() => save(false)}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
