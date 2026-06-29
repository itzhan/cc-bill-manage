"use client";
import { useEffect, useState, use } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldAlert,
  StopCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TaskRow {
  id: number;
  taskId: string;
  category: string;
  language: string;
  repo: string;
  status: string;
  mustGot: number | null;
  mustTotal: number | null;
  allGot: number | null;
  allTotal: number | null;
  resolved: boolean | null;
  answerLatencyS: number | null;
  judgeLatencyS: number | null;
  answerInputTokens: number | null;
  answerOutputTokens: number | null;
  judgeInputTokens: number | null;
  judgeOutputTokens: number | null;
  thinkingChars: number | null;
  hasSignature: boolean | null;
  errorText: string | null;
}

interface RunDetail {
  id: number;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  model: string;
  effort: string;
  n: number;
  seed: number;
  concurrency: number;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  mustHavePassRate: number | null;
  taskResolveRate: number | null;
  allItemsPassRate: number | null;
  avgAnswerLatencyS: number | null;
  avgJudgeLatencyS: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalThinkingChars: number | null;
  hasSignature: boolean | null;
  serviceTierPresent: boolean | null;
  cacheCreationPresent: boolean | null;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  // Probe (法医探针) -- runs first, ~30s.
  probeStatus: string;
  probeError: string | null;
  probeLatencyS: number | null;
  probeInputTokens: number | null;
  probeOutputTokens: number | null;
  probeThinkingChars: number | null;
  probeHasSignature: boolean | null;
  probeServiceTierPresent: boolean | null;
  probeCacheCreationPresent: boolean | null;
  probeAuthenticityScore: number | null;
  probeVerdict: string | null;
  probeAnswerPreview: string | null;
  // 长文本思考截断探针
  truncProbeStatus: string;
  truncProbeError: string | null;
  truncProbeLatencyS: number | null;
  truncProbeRequestedMaxTokens: number | null;
  truncProbeStopReason: string | null;
  truncProbeOutputTokens: number | null;
  truncProbeThinkingChars: number | null;
  truncProbeHasText: boolean | null;
  truncProbeVerdict: string | null;
  truncProbeAnswerPreview: string | null;
  tasks: TaskRow[];
}

interface Baseline {
  summary: { must_have_pass_rate: number; task_resolve_rate: number };
  tasks: Record<string, { must_have: [number, number]; resolved: boolean; category: string; answer_latency_s: number }>;
}

// Lite shape for the comparison-source picker (one of every other completed
// BenchRun the user could compare this run against). Pulled from
// /api/bench/runs which already returns this shape minus tasks.
interface RunSummary {
  id: number;
  name: string;
  n: number;
  model: string;
  status: string;
  mustHavePassRate: number | null;
  finishedAt: string | null;
  createdAt: string;
}

// Per-task must-have counters for the chosen comparison. Both the official
// baseline JSON and a sibling BenchRun get folded into this shape so the
// table can render without caring which source it is.
interface CompareEntry {
  got: number;
  total: number;
}
interface CompareData {
  label: string;          // e.g. "官方 (n=30)" or "v4 新 key · 03-12 14:00"
  totalRate: number | null;
  perTask: Record<string, CompareEntry>;
}

const OFFICIAL_PASS = 0.527;
const COMPARE_OFFICIAL = "official";

export default function BenchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [pickedTask, setPickedTask] = useState<string | null>(null);
  // Sibling completed runs the user could compare against. Excludes self.
  const [otherRuns, setOtherRuns] = useState<RunSummary[]>([]);
  // "official" = the vendored 30-题 baseline JSON. Otherwise stringified
  // BenchRun.id of a previously-completed run.
  const [compareKey, setCompareKey] = useState<string>(COMPARE_OFFICIAL);
  const [compareRun, setCompareRun] = useState<RunDetail | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  async function load() {
    const r = await fetch(`/api/bench/runs/${id}`);
    const d = await r.json();
    setRun(d.run);
  }

  useEffect(() => {
    load();
    fetch("/api/bench/baseline").then((r) => r.json()).then(setBaseline).catch(() => {});
    // Pull every previously-completed run so the user can pick one as the
    // comparison source. Filter "done" only -- partial / running runs would
    // confuse a per-task delta.
    fetch("/api/bench/runs")
      .then((r) => r.json())
      .then((j) => {
        const list = (j.items ?? []) as RunSummary[];
        setOtherRuns(
          list.filter((r) => r.id !== Number(id) && r.status === "done"),
        );
      })
      .catch(() => {});
  }, [id]);

  // Fetch the picked sibling run's tasks when the user changes the source.
  // Reset any cached run when switching back to "official".
  useEffect(() => {
    if (compareKey === COMPARE_OFFICIAL) {
      setCompareRun(null);
      return;
    }
    const numId = Number(compareKey);
    if (!Number.isFinite(numId)) return;
    setCompareLoading(true);
    fetch(`/api/bench/runs/${numId}`)
      .then((r) => r.json())
      .then((j) => setCompareRun(j.run))
      .catch(() => setCompareRun(null))
      .finally(() => setCompareLoading(false));
  }, [compareKey]);

  // Materialise the comparison source into a single shape the table can
  // consume regardless of where the data came from.
  const compareData: CompareData | null = (() => {
    if (compareKey === COMPARE_OFFICIAL) {
      if (!baseline) return null;
      const perTask: Record<string, CompareEntry> = {};
      for (const [tid, b] of Object.entries(baseline.tasks)) {
        perTask[tid] = { got: b.must_have[0], total: b.must_have[1] };
      }
      return {
        label: "官方 (n=30, opus-4-7)",
        totalRate: baseline.summary?.must_have_pass_rate ?? OFFICIAL_PASS,
        perTask,
      };
    }
    if (!compareRun) return null;
    const perTask: Record<string, CompareEntry> = {};
    for (const t of compareRun.tasks) {
      if (t.mustGot != null && t.mustTotal != null) {
        perTask[t.taskId] = { got: t.mustGot, total: t.mustTotal };
      }
    }
    return {
      label: `${compareRun.name}（n=${compareRun.n}, ${compareRun.model}）`,
      totalRate: compareRun.mustHavePassRate,
      perTask,
    };
  })();

  useEffect(() => {
    if (!run) return;
    const probeActive =
      run.probeStatus === "running" ||
      run.probeStatus === "pending" ||
      run.truncProbeStatus === "running" ||
      run.truncProbeStatus === "pending";
    const terminal =
      (run.status === "done" || run.status === "error" || run.status === "canceled") &&
      !probeActive;
    if (terminal) return;
    // Faster polling while any probe phase is in flight.
    const interval = probeActive ? 1500 : 3000;
    const t = setInterval(load, interval);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.probeStatus, run?.truncProbeStatus]);

  async function cancel() {
    if (!confirm("取消该测试？已在跑的题会跑完")) return;
    await fetch(`/api/bench/runs/${id}/cancel`, { method: "POST" });
    load();
  }

  async function restart() {
    await fetch(`/api/bench/runs/${id}`, { method: "POST" });
    load();
  }

  async function retryTask(taskId: string) {
    const r = await fetch(
      `/api/bench/runs/${id}/task/${encodeURIComponent(taskId)}/retry`,
      { method: "POST" },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error("重试失败", { description: j.error });
      return;
    }
    toast.success("已重新排队");
    load();
  }

  async function retryAllFailed() {
    if (!run) return;
    if (!confirm(`重跑 ${run.failedCount} 个失败的题?`)) return;
    const r = await fetch(`/api/bench/runs/${id}/retry-failed`, {
      method: "POST",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error("重跑失败", { description: j.error });
      return;
    }
    toast.success(`已重新排队 ${j.restarted} 题`);
    load();
  }

  if (!run) {
    return (
      <Shell>
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </Shell>
    );
  }

  const isRunning = run.status === "running" || run.status === "queued";
  const showRestart = run.status === "canceled" || (run.status === "error" && run.failedCount < run.totalCount);
  const showRetryFailed = !isRunning && run.failedCount > 0;

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4">
        <Button asChild size="sm" variant="ghost">
          <Link href="/bench">
            <ArrowLeft size={14} />
            返回
          </Link>
        </Button>
        <h1 className="text-xl font-semibold flex-1 truncate">{run.name}</h1>
        {isRunning && (
          <Button size="sm" variant="secondary" className="text-amber-600 dark:text-amber-400" onClick={cancel}>
            <StopCircle size={14} />
            取消
          </Button>
        )}
        {showRestart && (
          <Button size="sm" variant="secondary" onClick={restart}>
            <RefreshCw size={14} />
            续跑
          </Button>
        )}
        {showRetryFailed && (
          <Button
            size="sm"
            variant="destructive"
            onClick={retryAllFailed}
          >
            <RefreshCw size={14} />
            重跑 {run.failedCount} 个失败
          </Button>
        )}
      </div>

      <ProbePanel run={run} />
      <TruncationPanel run={run} onRefresh={load} />

      {/* Comparison source picker -- affects the StatTile delta + table column */}
      <Card className="mb-4">
        <CardContent className="py-2.5 flex flex-row items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">对比</span>
          <Select
            value={compareKey}
            onValueChange={setCompareKey}
          >
            <SelectTrigger className="max-w-md h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={COMPARE_OFFICIAL}>
                官方基线（n=30, opus-4-7, 52.70%）
              </SelectItem>
              {otherRuns.map((r) => (
                <SelectItem
                  key={String(r.id)}
                  value={String(r.id)}
                >
                  {`${r.name} · n=${r.n} · ${r.model} · ${
                    r.mustHavePassRate != null
                      ? `${(r.mustHavePassRate * 100).toFixed(2)}%`
                      : "?"
                  }`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {compareLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {compareKey !== COMPARE_OFFICIAL && compareData && (
            <span className="text-xs text-muted-foreground">
              对照 {compareData.label}
            </span>
          )}
          {compareKey === COMPARE_OFFICIAL &&
            !(run.n === 30 && run.model === "claude-opus-4-7") && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ 当前 run 是 n={run.n}/{run.model}，与官方基线 (n=30,
                opus-4-7) 不直接可比；建议改选历史 run
              </span>
            )}
        </CardContent>
      </Card>

      {/* Top status row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile
          label="智商分（must_have）"
          value={run.mustHavePassRate != null ? `${(run.mustHavePassRate * 100).toFixed(2)}%` : "—"}
          sub={(() => {
            if (run.mustHavePassRate == null || compareData?.totalRate == null) {
              return null;
            }
            const delta =
              (run.mustHavePassRate - compareData.totalRate) * 100;
            const sign = delta >= 0 ? "+" : "";
            return `vs ${compareData.label} ${(compareData.totalRate * 100).toFixed(2)}% · Δ ${sign}${delta.toFixed(2)} pp`;
          })()}
        />
        <StatTile
          label="完整通过题数"
          value={
            run.taskResolveRate != null
              ? `${Math.round(run.taskResolveRate * (run.totalCount - run.failedCount))} / ${run.totalCount - run.failedCount}`
              : "—"
          }
          sub={run.taskResolveRate != null ? `${(run.taskResolveRate * 100).toFixed(2)}%` : null}
        />
        <StatTile
          label="平均答题延迟"
          value={run.avgAnswerLatencyS != null ? `${run.avgAnswerLatencyS.toFixed(1)}s` : "—"}
          sub={run.avgJudgeLatencyS != null ? `judge ${run.avgJudgeLatencyS.toFixed(1)}s` : null}
        />
        <StatTile
          label="进度"
          value={`${run.completedCount} / ${run.totalCount}`}
          sub={run.failedCount > 0 ? `${run.failedCount} 失败` : run.status}
        />
      </div>

      {isRunning && (
        <div className="mb-4 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              run.failedCount > 0 ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${(run.completedCount / Math.max(1, run.totalCount)) * 100}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2 text-sm font-semibold">协议指纹</CardHeader>
          <CardContent className="text-xs flex flex-col gap-2 pt-0">
            <FingerprintLine
              label="Thinking 加密"
              ok={(run.totalThinkingChars ?? 0) === 0}
              detail={`${run.totalThinkingChars ?? 0} 字符（应为 0）`}
            />
            <FingerprintLine
              label="Signature"
              ok={run.hasSignature === true}
              detail={run.hasSignature === true ? "存在" : run.hasSignature === false ? "缺失" : "未知"}
            />
            <FingerprintLine
              label="usage.service_tier"
              ok={run.serviceTierPresent === true}
              detail={run.serviceTierPresent === true ? "存在" : run.serviceTierPresent === false ? "缺失" : "未知"}
            />
            <FingerprintLine
              label="usage.cache_creation"
              ok={run.cacheCreationPresent === true}
              detail={run.cacheCreationPresent === true ? "存在" : run.cacheCreationPresent === false ? "缺失" : "未知"}
            />
            <p className="text-muted-foreground mt-2">指纹规则参考 BENCHMARK.md §7。</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 text-sm font-semibold">运行配置</CardHeader>
          <CardContent className="text-xs grid grid-cols-2 gap-y-2 gap-x-4 pt-0">
            <Field label="端点" value={run.baseUrl} />
            <Field label="API Key" value={run.apiKeyMasked} />
            <Field label="模型" value={run.model} />
            <Field label="思考强度" value={run.effort || "—"} />
            <Field label="规模 / seed" value={`n=${run.n} · seed=${run.seed}`} />
            <Field label="并发" value={String(run.concurrency)} />
            <Field
              label="Token (input / output)"
              value={`${(run.totalInputTokens ?? 0).toLocaleString()} / ${(run.totalOutputTokens ?? 0).toLocaleString()}`}
            />
            <Field label="开始 / 结束" value={`${fmtDate(run.startedAt)} → ${fmtDate(run.finishedAt)}`} />
            {run.errorSummary && (
              <div className="col-span-2 text-destructive">错误: {run.errorSummary}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="text-sm font-semibold">逐题分数</CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>task_id</TableHead>
                <TableHead>类别 / 语言</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">must_have</TableHead>
                <TableHead className="text-right">
                  {compareKey === COMPARE_OFFICIAL ? "官方" : "对比"}
                </TableHead>
                <TableHead className="text-right">延迟 (ans+judge)</TableHead>
                <TableHead className="text-right">tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.tasks.map((t) => {
                const cmp = compareData?.perTask[t.taskId];
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => t.status === "done" && setPickedTask(t.taskId)}
                  >
                    <TableCell className="font-mono text-[11px]">{t.taskId.slice(-8)}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col leading-tight">
                        <span className="truncate max-w-[220px]">{t.category}</span>
                        <span className="text-muted-foreground">{t.language}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <TaskStatusBadge status={t.status} resolved={t.resolved} errorText={t.errorText} />
                        {t.status === "error" && !isRunning && (
                          <Button
                            size="icon-sm"
                            variant="secondary"
                            className="h-6 w-6 text-destructive"
                            aria-label="retry"
                            title="重试这一题"
                            onClick={(e) => { e.stopPropagation(); retryTask(t.taskId); }}
                          >
                            <RefreshCw size={12} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.mustGot != null && t.mustTotal != null
                        ? `${t.mustGot}/${t.mustTotal}`
                        : t.status === "running"
                        ? "..."
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {cmp ? `${cmp.got}/${cmp.total}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.answerLatencyS != null
                        ? `${t.answerLatencyS.toFixed(1)}+${(t.judgeLatencyS ?? 0).toFixed(1)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {t.answerInputTokens != null
                        ? `${(t.answerInputTokens + (t.judgeInputTokens ?? 0)).toLocaleString()} / ${((t.answerOutputTokens ?? 0) + (t.judgeOutputTokens ?? 0)).toLocaleString()}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pickedTask && (
        <TaskDetailModal runId={Number(id)} taskId={pickedTask} onClose={() => setPickedTask(null)} />
      )}
    </Shell>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ProbePanel({ run }: { run: RunDetail }) {
  // Pending / running -- show a placeholder so the user sees something is happening.
  if (run.probeStatus === "pending" || run.probeStatus === "running") {
    return (
      <Card className="mb-4 border-primary/30 bg-primary/5">
        <CardContent className="flex flex-row items-center gap-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <div className="flex-1">
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Fingerprint size={14} /> 正在做协议指纹检测…
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              发送一道思考探针题，检查 thinking 是否加密、signature 是否存在、usage 是否完整。约 30 秒。
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (run.probeStatus === "error") {
    return (
      <Card className="mb-4 border-destructive/40 bg-destructive/5">
        <CardContent className="gap-1 py-4">
          <div className="font-semibold text-sm flex items-center gap-1.5 text-destructive">
            <XCircle size={14} /> 协议指纹检测失败
          </div>
          <div className="text-xs text-muted-foreground break-all">
            {run.probeError ?? "(no detail)"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            后续 QnA 评测会继续进行，但协议指纹这一栏数据缺失。
          </div>
        </CardContent>
      </Card>
    );
  }

  // probeStatus === "done"
  const verdict = run.probeVerdict ?? "real";
  const score = run.probeAuthenticityScore ?? 0;
  const verdictMeta: Record<
    string,
    { variant: "success" | "warning" | "destructive"; label: string; icon: React.ReactNode }
  > = {
    real: {
      variant: "success",
      label: "真直连",
      icon: <CheckCircle2 size={16} />,
    },
    suspicious: {
      variant: "warning",
      label: "疑似伪装",
      icon: <AlertTriangle size={16} />,
    },
    fake: {
      variant: "destructive",
      label: "明确伪装",
      icon: <ShieldAlert size={16} />,
    },
  };
  const v = verdictMeta[verdict] ?? verdictMeta.real;

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row justify-between items-center pb-2">
        <div className="flex items-center gap-2">
          <Fingerprint size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">协议指纹</span>
          <Badge variant={v.variant}>
            <span className="inline-flex items-center gap-1 px-0.5">
              {v.icon}
              {v.label}
            </span>
          </Badge>
          <span className="text-xs text-muted-foreground">
            真伪指数 <b className={score >= 0 ? "text-emerald-600 dark:text-emerald-400" : score < -100 ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>{score}</b>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          探针耗时 {run.probeLatencyS != null ? `${run.probeLatencyS.toFixed(1)}s` : "—"}
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-0 text-xs">
        <ProbeCell
          label="Thinking 加密"
          ok={(run.probeThinkingChars ?? 0) === 0}
          detail={
            (run.probeThinkingChars ?? 0) === 0
              ? "0 字符（加密）"
              : `${run.probeThinkingChars} 字符（明文）`
          }
        />
        <ProbeCell
          label="Signature"
          ok={run.probeHasSignature === true}
          detail={run.probeHasSignature ? "存在" : "缺失"}
        />
        <ProbeCell
          label="service_tier"
          ok={run.probeServiceTierPresent === true}
          detail={run.probeServiceTierPresent ? "存在" : "缺失"}
        />
        <ProbeCell
          label="cache_creation"
          ok={run.probeCacheCreationPresent === true}
          detail={run.probeCacheCreationPresent ? "存在" : "缺失"}
        />
        <ProbeCell
          label="input_tokens"
          ok={
            run.probeInputTokens != null &&
            Math.abs(run.probeInputTokens - 70) / 70 <= 0.5
          }
          detail={`${run.probeInputTokens ?? "?"}（基线 ≈70）`}
        />
      </CardContent>
    </Card>
  );
}

function ProbeCell({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex flex-col leading-tight gap-0.5">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className={cn("font-medium", ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {detail}
      </span>
    </div>
  );
}

function TruncationPanel({
  run,
  onRefresh,
}: {
  run: RunDetail;
  onRefresh: () => void;
}) {
  const [triggering, setTriggering] = useState(false);
  async function trigger() {
    if (triggering) return;
    setTriggering(true);
    try {
      const r = await fetch(`/api/bench/runs/${run.id}/trunc-probe`, {
        method: "POST",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("触发失败", {
          description: j.error ?? "",
        });
        return;
      }
      onRefresh();
    } finally {
      setTriggering(false);
    }
  }

  // 用户没勾选 / 没手动开启时的空闲态：展示一个 CTA。
  if (run.truncProbeStatus === "not_requested") {
    const noThinking = !run.effort;
    return (
      <Card className="mb-4">
        <CardContent className="flex flex-row items-center justify-between gap-3 flex-wrap py-4">
          <div className="text-xs text-muted-foreground flex-1 min-w-0">
            <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
              <AlertTriangle size={14} /> 长文本思考截断检测
            </div>
            <div className="mt-0.5">
              {noThinking
                ? "本次 run 未开启思考（effort 为空），无法测试截断。"
                : "发送一道高思考量大题（max_tokens=64K），检测上游是否压低思考预算或答案上限。约 1-3 分钟。"}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={noThinking || triggering}
            onClick={trigger}
          >
            {triggering && <Loader2 className="h-4 w-4 animate-spin" />}
            开始检测
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (run.truncProbeStatus === "pending" || run.truncProbeStatus === "running") {
    return (
      <Card className="mb-4 border-primary/30 bg-primary/5">
        <CardContent className="flex flex-row items-center gap-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <div className="flex-1">
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <AlertTriangle size={14} /> 正在做长文本思考截断检测…
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              发送一道长思考题（max_tokens=64K），检测上游是否偷偷压低 thinking 预算或 max_tokens。
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (run.truncProbeStatus === "skipped") {
    return (
      <Card className="mb-4">
        <CardContent className="text-xs text-muted-foreground py-4">
          长文本截断检测已跳过：当前 run 未开启思考（effort 为空）。
        </CardContent>
      </Card>
    );
  }

  if (run.truncProbeStatus === "error") {
    return (
      <Card className="mb-4 border-destructive/40 bg-destructive/5">
        <CardContent className="gap-1 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-semibold text-sm flex items-center gap-1.5 text-destructive">
              <XCircle size={14} /> 长文本截断检测请求失败
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={triggering}
              onClick={trigger}
            >
              {triggering && <Loader2 className="h-4 w-4 animate-spin" />}
              重试
            </Button>
          </div>
          <div className="text-xs text-muted-foreground break-all">
            {run.truncProbeError ?? "(no detail)"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            可能是上游在 thinking 中段断开连接（network_cut），也可能是临时故障。
          </div>
        </CardContent>
      </Card>
    );
  }

  // status === "done"
  const verdict = run.truncProbeVerdict ?? "ok";
  const meta: Record<
    string,
    { variant: "success" | "warning" | "destructive"; label: string; hint: string }
  > = {
    ok: {
      variant: "success",
      label: "未发现截断",
      hint: "stop_reason=end_turn，thinking 长度正常",
    },
    thinking_cut: {
      variant: "destructive",
      label: "思考被截断",
      hint: "stop_reason=max_tokens 且没有最终答案——上游在 thinking 阶段就被砍了",
    },
    answer_cut: {
      variant: "warning",
      label: "答案被截断",
      hint: "stop_reason=max_tokens 但有部分答案——max_tokens 上限触顶",
    },
    silent_throttle: {
      variant: "warning",
      label: "疑似静默压思考",
      hint: "stop_reason=end_turn 但 thinking_chars 远低于基线——上游可能压低了 max_thinking_tokens",
    },
    network_cut: {
      variant: "destructive",
      label: "网络中断",
      hint: "请求或响应在中途断开，可能是代理超时",
    },
  };
  const v = meta[verdict] ?? meta.ok;

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row justify-between items-center pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">长文本思考截断</span>
          <Badge variant={v.variant}>
            {v.label}
          </Badge>
          <span className="text-xs text-muted-foreground">{v.hint}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            探针耗时 {run.truncProbeLatencyS != null ? `${run.truncProbeLatencyS.toFixed(1)}s` : "—"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={triggering || !run.effort}
            onClick={trigger}
          >
            {triggering && <Loader2 className="h-4 w-4 animate-spin" />}
            重新检测
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-0 text-xs">
        <ProbeCell
          label="stop_reason"
          ok={
            run.truncProbeStopReason === "end_turn" ||
            run.truncProbeStopReason === "stop_sequence"
          }
          detail={run.truncProbeStopReason ?? "—"}
        />
        <ProbeCell
          label="思考字符数"
          ok={(run.truncProbeThinkingChars ?? 0) >= 3000}
          detail={`${run.truncProbeThinkingChars ?? "—"}（≥3000 健康）`}
        />
        <ProbeCell
          label="output_tokens"
          ok={(run.truncProbeOutputTokens ?? 0) > 0}
          detail={`${run.truncProbeOutputTokens ?? "—"} / ${run.truncProbeRequestedMaxTokens ?? "—"} 上限`}
        />
        <ProbeCell
          label="是否返回答案"
          ok={run.truncProbeHasText === true}
          detail={run.truncProbeHasText ? "是" : "否"}
        />
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono break-all">{value}</div>
    </div>
  );
}

function FingerprintLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? "success" : "destructive"}>
        {detail}
      </Badge>
    </div>
  );
}

function TaskStatusBadge({
  status,
  resolved,
  errorText,
}: {
  status: string;
  resolved: boolean | null;
  errorText: string | null;
}) {
  if (status === "done") {
    return (
      <Badge variant={resolved ? "success" : "secondary"}>
        {resolved ? "全过" : "完成"}
      </Badge>
    );
  }
  if (status === "running") return <Badge variant="default">运行中</Badge>;
  if (status === "error")
    return (
      <Badge variant="destructive" title={errorText ?? ""}>
        错误
      </Badge>
    );
  return <Badge variant="secondary">待</Badge>;
}

interface TaskFull {
  task: TaskRow & {
    answerText: string | null;
    judgeRawText: string | null;
    judgeParsedJson: string | null;
  };
  prompt: string | null;
  repository_url: string | null;
  repository_base_commit: string | null;
  rubric: { id: string; title: string; annotations?: { importance?: string } }[] | null;
}

function TaskDetailModal({
  runId,
  taskId,
  onClose,
}: {
  runId: number;
  taskId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<TaskFull | null>(null);

  useEffect(() => {
    fetch(`/api/bench/runs/${runId}/task/${taskId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error("加载失败"));
  }, [runId, taskId]);

  let parsedItems: { id: string; satisfied: boolean; reason?: string }[] = [];
  if (data?.task.judgeParsedJson) {
    try {
      const p = JSON.parse(data.task.judgeParsedJson);
      parsedItems = p.items ?? [];
    } catch {
      // ignore
    }
  }
  const byId = new Map(parsedItems.map((it) => [it.id, it]));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{taskId}</DialogTitle>
          <p className="text-xs text-muted-foreground font-normal">
            {data?.task.category} · {data?.task.language} · {data?.repository_url}
          </p>
        </DialogHeader>
        <div className="text-sm">
          {!data ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">题面</h3>
                <pre className="text-xs whitespace-pre-wrap bg-muted rounded-lg p-3 max-h-80 overflow-auto">
                  {data.prompt}
                </pre>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">候选答案</h3>
                <pre className="text-xs whitespace-pre-wrap bg-muted rounded-lg p-3 max-h-80 overflow-auto">
                  {data.task.answerText ?? "（无）"}
                </pre>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Rubric 评分（{data.task.mustGot}/{data.task.mustTotal} must-have）
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>importance</TableHead>
                      <TableHead>title</TableHead>
                      <TableHead className="text-center">satisfied</TableHead>
                      <TableHead>reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.rubric ?? []).map((r) => {
                      const j = byId.get(r.id);
                      const imp = r.annotations?.importance ?? "";
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Badge variant={imp === "must have" ? "default" : "secondary"}>
                              {imp}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.title}</TableCell>
                          <TableCell className="text-center">
                            {j ? (
                              <Badge variant={j.satisfied ? "success" : "destructive"}>
                                {j.satisfied ? "✓" : "✗"}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{j?.reason ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </section>

              {data.task.errorText && (
                <section>
                  <h3 className="text-xs font-semibold text-destructive mb-1">错误</h3>
                  <pre className="text-xs whitespace-pre-wrap bg-destructive/10 rounded-lg p-3">
                    {data.task.errorText}
                  </pre>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
