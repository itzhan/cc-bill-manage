"use client";
import { useEffect, useState } from "react";
import {
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/react";
import { fmtMoney, fmtMoneyShort } from "@/lib/format";

interface UpstreamRow {
  keyId: number;
  keyName: string;
  groupName: string;
  effectiveRate: number;
  rechargeMultiplier: number;
  upstreamAccountId: number;
  upstreamAccountName: string;
  upstreamType: string;
  cost: number;
  actualCost: number;
}
interface SiteRow {
  siteBoundAccountId: number;
  accountName: string;
  siteAccountId: number;
  siteAccountName: string;
  rateMultiplier: number;
  cost: number;
  actualCost: number;
}
interface Breakdown {
  date: string;
  upstream: UpstreamRow[];
  site: SiteRow[];
  totals: {
    revenue: number;
    expense: number;
    profit: number;
    siteCostBase: number;
    upstreamCostBase: number;
    diff: number;
  };
  errors: { date: string; kind: "site" | "upstream"; id: number; error: string }[];
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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !date) {
      setData(null);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    setData(null);
    fetch(`/api/daily-profit/${date}/breakdown`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `${r.status}`);
        }
        return r.json();
      })
      .then((j: Breakdown) => setData(j))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [isOpen, date]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="5xl" scrollBehavior="inside">
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
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
              </div>
              <p className="text-xs text-default-500 font-normal">
                按每把上游 key、每个本站绑定账号的当日数据汇总。点击日期实时
                拉取，不写 DB
              </p>
            </ModalHeader>
            <ModalBody className="pb-6">
              {loading && (
                <div className="flex justify-center p-8">
                  <Spinner label="加载明细中" />
                </div>
              )}
              {err && (
                <div className="text-danger text-sm py-3">{err}</div>
              )}
              {data && (
                <>
                  <TotalsCard b={data} />

                  {data.errors.length > 0 && (
                    <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 my-3 text-sm">
                      <div className="font-medium text-danger mb-1">
                        {data.errors.length} 个抓取错误（已从汇总中排除）
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

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      支出来源 · 上游 keys
                      <Chip size="sm" variant="flat">
                        {data.upstream.length}
                      </Chip>
                    </h3>
                    {data.upstream.length === 0 ? (
                      <p className="text-default-500 text-sm">无</p>
                    ) : (
                      <Table aria-label="upstream breakdown" removeWrapper>
                        <TableHeader>
                          <TableColumn>Key</TableColumn>
                          <TableColumn>上游账号 / 分组</TableColumn>
                          <TableColumn>倍率</TableColumn>
                          <TableColumn>充值倍率</TableColumn>
                          <TableColumn>1× 成本</TableColumn>
                          <TableColumn>实际支出</TableColumn>
                        </TableHeader>
                        <TableBody>
                          {data.upstream.map((r) => (
                            <TableRow key={r.keyId}>
                              <TableCell>
                                <span className="font-medium">{r.keyName}</span>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="text-xs">
                                    {r.upstreamAccountName}
                                  </span>
                                  <span className="text-xs text-default-400">
                                    {r.groupName}
                                    <span className="ml-1 text-default-400">
                                      [{r.upstreamType}]
                                    </span>
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm tabular-nums">
                                  ×{r.effectiveRate.toFixed(2)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={
                                    r.rechargeMultiplier !== 1
                                      ? "text-primary tabular-nums text-sm"
                                      : "text-default-400 tabular-nums text-sm"
                                  }
                                >
                                  ×{r.rechargeMultiplier.toFixed(2)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums"
                                  title={fmtMoney(r.cost)}
                                >
                                  {fmtMoneyShort(r.cost)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums font-medium"
                                  title={fmtMoney(r.actualCost)}
                                >
                                  {fmtMoneyShort(r.actualCost)}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>

                  <section className="mt-6">
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      收入来源 · 本站绑定账号
                      <Chip size="sm" variant="flat">
                        {data.site.length}
                      </Chip>
                    </h3>
                    {data.site.length === 0 ? (
                      <p className="text-default-500 text-sm">无</p>
                    ) : (
                      <Table aria-label="site breakdown" removeWrapper>
                        <TableHeader>
                          <TableColumn>本站账号</TableColumn>
                          <TableColumn>所属站点</TableColumn>
                          <TableColumn>倍率</TableColumn>
                          <TableColumn>1× 成本</TableColumn>
                          <TableColumn>收入</TableColumn>
                        </TableHeader>
                        <TableBody>
                          {data.site.map((r) => (
                            <TableRow key={r.siteBoundAccountId}>
                              <TableCell>
                                <span className="font-medium">
                                  {r.accountName}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-default-400">
                                  {r.siteAccountName}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm tabular-nums">
                                  ×{r.rateMultiplier.toFixed(2)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums"
                                  title={fmtMoney(r.cost)}
                                >
                                  {fmtMoneyShort(r.cost)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className="tabular-nums font-medium"
                                  title={fmtMoney(r.actualCost)}
                                >
                                  {fmtMoneyShort(r.actualCost)}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>
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
    totals.profit > 0
      ? "text-success"
      : totals.profit < 0
        ? "text-danger"
        : "";
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
        label="差异 (|上游 1× − 本站 1×|)"
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
