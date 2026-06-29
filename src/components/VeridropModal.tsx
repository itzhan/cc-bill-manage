"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DetectorResult {
  name?: string;
  display_name?: string;
  status?: string;
  score?: number;
  weight?: number;
  duration_ms?: number | null;
  details?: unknown;
  error?: string | null;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface Performance {
  total_latency_ms?: number;
  ttft_ms?: number | null;
  tokens_per_second?: number | null;
  usage?: Usage;
  request_count?: number;
  backoff_events?: number;
}

interface Report {
  protocol?: string;
  tier?: string;
  base_url?: string;
  api_key_masked?: string;
  target_model?: string;
  mode?: string;
  timestamp?: string;
  total_score?: number;
  verdict?: string;
  summary?: string;
  run_error?: string | null;
  self_reported_identity?: string | null;
  detected_non_anthropic_brands?: string[];
  results?: DetectorResult[];
  performance?: Performance;
}

interface RunState {
  id: number;
  status: string;
  protocol: string;
  mode: string;
  model: string;
  totalScore: number | null;
  verdict: string | null;
  summary: string | null;
  errorText: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  report: Report | null;
}

interface PriorRun {
  id: number;
  protocol: string;
  mode: string;
  model: string;
  status: string;
  totalScore: number | null;
  verdict: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export default function VeridropModal({
  isOpen,
  onClose,
  channelKey,
}: {
  isOpen: boolean;
  onClose: () => void;
  channelKey: { id: number; name: string; apiKeyMasked: string } | null;
}) {
  const [form, setForm] = useState({
    protocol: "anthropic",
    mode: "full",
    model: "claude-opus-4-7",
  });
  const [submitting, setSubmitting] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [priorRuns, setPriorRuns] = useState<PriorRun[]>([]);
  const [view, setView] = useState<"new" | "current">("new");
  const pollTimer = useRef<NodeJS.Timeout | null>(null);

  // 模态关闭/key 切换 -> 重置
  useEffect(() => {
    if (!isOpen) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      setRunId(null);
      setRun(null);
      setSubmitting(false);
      setView("new");
      return;
    }
    if (channelKey) {
      void loadPriorRuns(channelKey.id);
    }
  }, [isOpen, channelKey?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPriorRuns(keyId: number) {
    try {
      const r = await fetch(`/api/bench/keys/${keyId}/veridrop`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as { items: PriorRun[] };
      setPriorRuns(j.items ?? []);
    } catch {
      // ignore -- listing failure not critical
    }
  }

  async function loadRun(id: number): Promise<RunState | null> {
    try {
      const r = await fetch(`/api/veridrop/runs/${id}`, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as RunState;
    } catch {
      return null;
    }
  }

  function startPoll(id: number) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      const fresh = await loadRun(id);
      if (!fresh) return;
      setRun(fresh);
      if (fresh.status === "done" || fresh.status === "error") {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        if (channelKey) loadPriorRuns(channelKey.id);
      }
    }, 2000);
  }

  async function submit() {
    if (!channelKey) return;
    setSubmitting(true);
    try {
      const r = await fetch(
        `/api/bench/keys/${channelKey.id}/veridrop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("启动失败", {
          description: String(j.error || r.status),
        });
        return;
      }
      const id = j.runId as number;
      setRunId(id);
      setView("current");
      const first = await loadRun(id);
      setRun(first);
      startPoll(id);
    } finally {
      setSubmitting(false);
    }
  }

  async function openPriorRun(id: number) {
    setRunId(id);
    setView("current");
    const fresh = await loadRun(id);
    setRun(fresh);
    if (fresh && (fresh.status === "queued" || fresh.status === "running")) {
      startPoll(id);
    }
  }

  const inProgress =
    run && (run.status === "queued" || run.status === "running");

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>veridrop · 真伪 / 协议合规检测</DialogTitle>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">
            {channelKey
              ? `${channelKey.name} · ${channelKey.apiKeyMasked}`
              : ""}
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as "new" | "current")}>
            <TabsList>
              <TabsTrigger value="new">新检测</TabsTrigger>
              <TabsTrigger value="current">{runId ? `当前/历史 #${runId}` : "历史"}</TabsTrigger>
            </TabsList>
          </Tabs>

          {view === "new" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label>协议</Label>
                  <Select
                    value={form.protocol}
                    onValueChange={(v) => setForm((f) => ({ ...f, protocol: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">anthropic</SelectItem>
                      <SelectItem value="openai">openai</SelectItem>
                      <SelectItem value="gemini">gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>模式</Label>
                  <Select
                    value={form.mode}
                    onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quick">quick (~15s)</SelectItem>
                      <SelectItem value="standard">standard (~40s)</SelectItem>
                      <SelectItem value="full">full (~70s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>模型</Label>
                  <Input
                    className="h-8 text-xs"
                    value={form.model}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, model: e.target.value }))
                    }
                    placeholder="claude-opus-4-7"
                  />
                </div>
              </div>
              {priorRuns.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    历史检测
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>时间</TableHead>
                          <TableHead>协议/模式</TableHead>
                          <TableHead>模型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>得分</TableHead>
                          <TableHead>verdict</TableHead>
                          <TableHead>{" "}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {priorRuns.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">
                              {new Date(r.createdAt).toLocaleString(
                                "zh-CN",
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.protocol} / {r.mode}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {r.model}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {r.totalScore != null
                                ? r.totalScore.toFixed(1)
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {r.verdict ? (
                                <VerdictBadge verdict={r.verdict} />
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  —
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => openPriorRun(r.id)}
                              >
                                查看
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}

          {view === "current" && (
            <>
              {!run ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <RunDetailView run={run} />
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {view === "new" && (
            <Button
              disabled={submitting || !channelKey}
              onClick={submit}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              开始检测
            </Button>
          )}
          {view === "current" && !inProgress && run && (
            <Button
              variant="secondary"
              onClick={() => {
                setView("new");
                setRunId(null);
                setRun(null);
              }}
            >
              新一次检测
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { variant: "secondary" | "default" | "success" | "warning" | "destructive"; label: string }
  > = {
    queued: { variant: "secondary", label: "排队" },
    running: { variant: "default", label: "运行中" },
    done: { variant: "success", label: "完成" },
    error: { variant: "destructive", label: "失败" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<
    string,
    { variant: "success" | "warning" | "destructive" | "secondary"; label: string }
  > = {
    passed: { variant: "success", label: "passed" },
    marginal: { variant: "warning", label: "marginal" },
    failed: { variant: "destructive", label: "failed" },
  };
  const m = map[verdict] ?? { variant: "secondary" as const, label: verdict };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function DetectorStatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { variant: "success" | "warning" | "destructive" | "secondary"; label: string }
  > = {
    pass: { variant: "success", label: "pass" },
    fail: { variant: "destructive", label: "fail" },
    skip: { variant: "secondary", label: "skip" },
    error: { variant: "destructive", label: "error" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function RunDetailView({ run }: { run: RunState }) {
  const progress = run.status === "running" || run.status === "queued";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={run.status} />
        {run.verdict && <VerdictBadge verdict={run.verdict} />}
        <span className="text-xs text-muted-foreground">
          {run.protocol} / {run.mode}
        </span>
        <span className="text-xs font-mono text-muted-foreground">{run.model}</span>
        {run.totalScore != null && (
          <span className="text-sm font-bold">
            得分 <span className="tabular-nums">{run.totalScore.toFixed(1)}</span>
          </span>
        )}
        {run.summary && (
          <span className="text-sm text-foreground">{run.summary}</span>
        )}
      </div>

      {progress && (
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary animate-pulse w-full" />
        </div>
      )}

      {run.status === "error" && run.errorText && (
        <div className="text-xs text-destructive whitespace-pre-wrap break-all border border-destructive/30 bg-destructive/5 rounded p-2">
          {run.errorText}
        </div>
      )}

      {run.report && <ReportView report={run.report} />}
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Tile label="协议" value={report.protocol ?? "—"} />
        <Tile label="模式" value={report.mode ?? "—"} />
        <Tile
          label="目标模型"
          value={report.target_model ?? "—"}
          mono
        />
        <Tile
          label="base_url"
          value={report.base_url ?? "—"}
          mono
          truncate
          title={report.base_url}
        />
        {report.self_reported_identity != null && (
          <Tile
            label="自报身份"
            value={report.self_reported_identity || "—"}
            mono
            truncate
            title={report.self_reported_identity}
          />
        )}
        {report.tier && <Tile label="tier" value={report.tier} />}
      </div>

      {report.detected_non_anthropic_brands &&
        report.detected_non_anthropic_brands.length > 0 && (
          <div className="border border-amber-500/40 bg-amber-500/5 rounded p-2 text-xs">
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              检测到非 Anthropic 品牌词
            </span>
            <span className="ml-2 text-foreground">
              {report.detected_non_anthropic_brands.join("、")}
            </span>
          </div>
        )}

      {report.run_error && (
        <div className="border border-destructive/40 bg-destructive/5 rounded p-2 text-xs text-destructive">
          {report.run_error}
        </div>
      )}

      {report.performance && <PerformanceView perf={report.performance} />}

      {report.results && report.results.length > 0 && (
        <DetectorsTable results={report.results} />
      )}
    </div>
  );
}

function PerformanceView({ perf }: { perf: Performance }) {
  const u = perf.usage ?? {};
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">性能 & 用量</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Tile
          label="总耗时 ms"
          value={
            perf.total_latency_ms != null
              ? perf.total_latency_ms.toLocaleString()
              : "—"
          }
        />
        <Tile
          label="TTFT ms"
          value={perf.ttft_ms != null ? perf.ttft_ms.toLocaleString() : "—"}
        />
        <Tile
          label="tokens/s"
          value={
            perf.tokens_per_second != null
              ? perf.tokens_per_second.toFixed(2)
              : "—"
          }
        />
        <Tile
          label="请求数"
          value={
            perf.request_count != null
              ? perf.request_count.toLocaleString()
              : "—"
          }
        />
        <Tile
          label="输入 token"
          value={
            u.input_tokens != null ? u.input_tokens.toLocaleString() : "—"
          }
        />
        <Tile
          label="输出 token"
          value={
            u.output_tokens != null ? u.output_tokens.toLocaleString() : "—"
          }
        />
        <Tile
          label="cache read"
          value={
            u.cache_read_input_tokens != null
              ? u.cache_read_input_tokens.toLocaleString()
              : "—"
          }
        />
        <Tile
          label="cache create"
          value={
            u.cache_creation_input_tokens != null
              ? u.cache_creation_input_tokens.toLocaleString()
              : "—"
          }
        />
      </div>
    </div>
  );
}

function DetectorsTable({ results }: { results: DetectorResult[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">
        检测项 ({results.length})
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>得分</TableHead>
            <TableHead>权重</TableHead>
            <TableHead>耗时 ms</TableHead>
            <TableHead>错误</TableHead>
            <TableHead>{" "}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.flatMap((r, i) => {
            const row = (
              <TableRow key={`r${i}`}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {r.display_name || r.name}
                    </span>
                    {r.display_name && r.name && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {r.name}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <DetectorStatusBadge status={r.status ?? "—"} />
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {r.score != null ? r.score.toFixed(1) : "—"}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {r.weight != null ? r.weight.toFixed(2) : "—"}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {r.duration_ms != null
                    ? r.duration_ms.toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell className="text-xs text-destructive break-all max-w-[200px]">
                  {r.error ?? ""}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() =>
                      setOpenIdx(openIdx === i ? null : i)
                    }
                    disabled={!r.details}
                  >
                    {openIdx === i ? "收起" : "details"}
                  </Button>
                </TableCell>
              </TableRow>
            );
            if (openIdx !== i || !r.details) return [row];
            return [
              row,
              <TableRow key={`d${i}`}>
                <TableCell colSpan={7} className="bg-muted/30">
                  <pre className="text-[11px] whitespace-pre-wrap break-all p-2 max-h-[300px] overflow-auto">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                </TableCell>
              </TableRow>,
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Tile({
  label,
  value,
  mono,
  truncate,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  title?: string;
}) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm",
          mono && "font-mono",
          truncate && "truncate",
        )}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}
