"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  ErrorRankAccount,
  ErrorRankPayload,
} from "../_types";
import { ERROR_RANGES, fmtTimeShort } from "../_types";

/* ------------------------------------------------------------------ */
/*  RateTile — compact metric card used in the summary row            */
/* ------------------------------------------------------------------ */

function RateTile({
  label,
  value,
  sub,
  severity,
}: {
  label: string;
  value: string;
  sub: string;
  severity: "ok" | "warning" | "danger";
}) {
  const colorClass =
    severity === "danger"
      ? "text-destructive"
      : severity === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  const borderClass =
    severity === "danger"
      ? "border-destructive/40"
      : severity === "warning"
        ? "border-amber-500/40"
        : "border-border";
  return (
    <Card className={cn("bg-card shadow-none", borderClass)}>
      <CardContent className="py-3 p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("text-2xl font-semibold tabular-nums", colorClass)}>
          {value}
        </div>
        <div
          className="text-[11px] text-muted-foreground/70 mt-0.5 truncate"
          title={sub}
        >
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  ErrorAccountModal                                                 */
/* ------------------------------------------------------------------ */

function ErrorAccountModal({
  account,
  recentCap,
  onClose,
}: {
  account: ErrorRankAccount | null;
  recentCap: number;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string>("all");

  useEffect(() => {
    if (!account) return;
    setQ("");
    setStatusF("all");
  }, [account]);

  const events = account?.recentEvents ?? [];
  const lc = q.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (statusF !== "all" && String(e.statusCode) !== statusF) return false;
    if (!lc) return true;
    return (
      (e.message ?? "").toLowerCase().includes(lc) ||
      (e.userEmail ?? "").toLowerCase().includes(lc) ||
      (e.model ?? "").toLowerCase().includes(lc) ||
      (e.requestId ?? "").toLowerCase().includes(lc)
    );
  });
  const statusCodes = account
    ? Object.keys(account.byStatus).sort(
        (a, b) => account.byStatus[b] - account.byStatus[a],
      )
    : [];

  return (
    <Dialog open={account != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        {account && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{account.accountName}</span>
                <Badge variant="secondary">id={account.accountId}</Badge>
                <Badge variant="destructive">
                  共 {account.count.toLocaleString()} 错
                </Badge>
                <Badge variant="secondary">
                  占比 {(account.share * 100).toFixed(2)}%
                </Badge>
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    分组：
                    {account.groups
                      .map((g) => `${g.groupName}(${g.count})`)
                      .join("、") || "—"}
                  </span>
                  <span>
                    状态码：
                    {Object.entries(account.byStatus)
                      .sort((x, y) => y[1] - x[1])
                      .map(([k, v]) => `${k}×${v}`)
                      .join(" / ") || "—"}
                  </span>
                  <span>
                    模型：
                    {Object.entries(account.byModel)
                      .sort((x, y) => y[1] - x[1])
                      .slice(0, 4)
                      .map(([k, v]) => `${k}×${v}`)
                      .join(" / ") || "—"}
                  </span>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={statusF === "all" ? "default" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => setStatusF("all")}
                >
                  全部
                </Badge>
                {statusCodes.map((sc) => (
                  <Badge
                    key={sc}
                    variant={statusF === sc ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => setStatusF(sc)}
                  >
                    {sc} · {account.byStatus[sc]}
                  </Badge>
                ))}
                <div className="ml-auto w-full sm:w-72">
                  <Input
                    className="h-8"
                    placeholder="搜索消息 / user / 模型 / request_id…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground/70">
                展示最近 {Math.min(events.length, recentCap)} 条原始错误
                {account.count > recentCap &&
                  `（该账号共 ${account.count.toLocaleString()} 条，更早的未保留）`}
                。
              </p>

              {filtered.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  没有匹配的错误。
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>消息</TableHead>
                      <TableHead>request_id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtTimeShort(e.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              e.statusCode >= 500
                                ? "destructive"
                                : e.statusCode >= 400
                                  ? "warning"
                                  : "secondary"
                            }
                          >
                            {e.statusCode || "?"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col leading-tight">
                            <span>{e.model || "—"}</span>
                            {e.requestedModel &&
                              e.requestedModel !== e.model && (
                                <span className="text-[10px] text-muted-foreground/70">
                                  req: {e.requestedModel}
                                </span>
                              )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                          {e.userEmail || "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs text-destructive max-w-[360px] truncate"
                          title={e.message}
                        >
                          {e.message || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground/70 max-w-[140px] truncate">
                          {e.requestId || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                关闭
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  ErrorRankingView — main export                                    */
/* ------------------------------------------------------------------ */

export default function ErrorRankingView({
  siteId,
}: {
  siteId: number | null;
}) {
  const [range, setRange] = useState<string>("1h");
  const [data, setData] = useState<ErrorRankPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ErrorRankAccount | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (siteId == null) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/scheduling/${siteId}/error-ranking?range=${range}`,
        { cache: "no-store", signal: ctl.signal },
      );
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `${r.status}`);
        return;
      }
      setData(j);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctl) setLoading(false);
    }
  }, [siteId, range]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  if (siteId == null) {
    return (
      <Card className="bg-card rounded-lg border border-border shadow-none">
        <CardContent className="p-4 text-muted-foreground text-sm">
          先选站点
        </CardContent>
      </Card>
    );
  }

  const filtered = data
    ? data.accounts.filter((a) => {
        const lc = q.trim().toLowerCase();
        if (!lc) return true;
        return (
          a.accountName.toLowerCase().includes(lc) ||
          a.groups.some((g) =>
            (g.groupName ?? "").toLowerCase().includes(lc),
          )
        );
      })
    : [];

  const maxCount = data
    ? Math.max(1, ...data.accounts.map((a) => a.count))
    : 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <Card className="bg-card rounded-lg border border-border shadow-none">
        <CardContent className="flex flex-row gap-2 items-center flex-wrap py-3 p-4">
          <span className="text-xs text-muted-foreground">时间范围</span>
          {ERROR_RANGES.map((r) => (
            <Badge
              key={r.key}
              variant={range === r.key ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Badge>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
            className="ml-auto"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            刷新
          </Button>
          <div className="w-full sm:w-64">
            <Input
              className="h-8"
              placeholder="搜索账号/分组名…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary tiles */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RateTile
            label="请求错误率"
            value={`${(data.summary.errorRate * 100).toFixed(2)}%`}
            sub={`${data.summary.errorCountTotal.toLocaleString()} / ${data.summary.requestCountTotal.toLocaleString()}`}
            severity={
              data.summary.errorRate >= 0.05
                ? "danger"
                : data.summary.errorRate >= 0.02
                  ? "warning"
                  : "ok"
            }
          />
          <RateTile
            label="上游错误率"
            value={`${(data.summary.upstreamErrorRate * 100).toFixed(2)}%`}
            sub={(() => {
              const o = data.summary.upstreamErrorCountOther;
              const r429 = data.summary.upstreamErrorCount429;
              const r529 = data.summary.upstreamErrorCount529;
              const parts: string[] = [];
              if (o > 0) parts.push(`其他 ${o.toLocaleString()}`);
              if (r429 > 0) parts.push(`429×${r429}`);
              if (r529 > 0) parts.push(`529×${r529}`);
              return parts.join(" / ") || "—";
            })()}
            severity={
              data.summary.upstreamErrorRate >= 0.1
                ? "danger"
                : data.summary.upstreamErrorRate >= 0.05
                  ? "warning"
                  : "ok"
            }
          />
          <RateTile
            label="SLA"
            value={`${(data.summary.sla * 100).toFixed(2)}%`}
            sub={`成功 ${data.summary.successCount.toLocaleString()}`}
            severity={
              data.summary.sla >= 0.99
                ? "ok"
                : data.summary.sla >= 0.95
                  ? "warning"
                  : "danger"
            }
          />
          <RateTile
            label="健康分"
            value={
              data.summary.healthScore != null
                ? String(data.summary.healthScore)
                : "—"
            }
            sub={`时间窗 ${data.range} · ${fmtTimeShort(data.summary.generatedAt)}`}
            severity={
              data.summary.healthScore == null
                ? "ok"
                : data.summary.healthScore >= 80
                  ? "ok"
                  : data.summary.healthScore >= 50
                    ? "warning"
                    : "danger"
            }
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <Card className="bg-card rounded-lg border border-border shadow-none">
          <CardContent className="p-4 text-destructive text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Ranking table */}
      {data && (
        <Card className="bg-card rounded-lg border border-border shadow-none">
          <CardHeader className="flex flex-row justify-between items-center pb-2 flex-wrap gap-2">
            <div>
              <h2 className="font-semibold">账号错误排行</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.range} · 共 {data.totalErrors.toLocaleString()} 条错误 ·
                涉及 {data.accounts.length} 个账号 · 已处理{" "}
                {data.processed.toLocaleString()} 条
                {data.truncated && (
                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                    （达到 {data.processed.toLocaleString()}{" "}
                    上限，更早数据未统计）
                  </span>
                )}
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {data.accounts.length === 0
                  ? "该时间窗内没有错误。"
                  : "当前筛选下没有匹配的账号。"}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>排名</TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>分组</TableHead>
                    <TableHead className="text-right">错误数</TableHead>
                    <TableHead>占比</TableHead>
                    <TableHead>状态码</TableHead>
                    <TableHead>最近错误</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a, i) => {
                    const pct = (a.count / maxCount) * 100;
                    const groupLine = a.groups
                      .map((g) => `${g.groupName} (${g.count})`)
                      .join("、");
                    const statusBreakdown = Object.entries(a.byStatus)
                      .sort((x, y) => y[1] - x[1])
                      .map(([k, v]) => `${k}×${v}`)
                      .join(" / ");
                    return (
                      <TableRow
                        key={a.accountId}
                        className="cursor-pointer"
                        onClick={() => setPicked(a)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col leading-tight max-w-[260px]">
                            <span className="font-medium text-sm truncate">
                              {a.accountName}
                            </span>
                            <span className="text-[11px] text-muted-foreground/70">
                              id={a.accountId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-xs text-muted-foreground break-all"
                            title={groupLine}
                          >
                            {a.groups[0]?.groupName ?? "—"}
                            {a.groups.length > 1 && (
                              <span className="text-muted-foreground/70 ml-1">
                                +{a.groups.length - 1}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {a.count.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-destructive/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                              {(a.share * 100).toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-xs font-mono text-muted-foreground"
                            title={statusBreakdown}
                          >
                            {statusBreakdown || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col leading-tight max-w-[260px]">
                            <span className="text-[11px] text-muted-foreground/70">
                              {fmtTimeShort(a.latestAt)}
                            </span>
                            <span
                              className="text-xs text-destructive truncate"
                              title={a.latestMessage}
                            >
                              {a.latestStatus} · {a.latestMessage || "—"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <ErrorAccountModal
        account={picked}
        recentCap={data?.recentPerAccount ?? 0}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}
