"use client";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tab,
  Tabs,
  addToast,
} from "@heroui/react";

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

  // 模态关闭/key 切换 → 重置
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
      // ignore — listing failure not critical
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
        addToast({
          title: "启动失败",
          description: String(j.error || r.status),
          color: "danger",
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
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              <div className="flex flex-col">
                <span>veridrop · 真伪 / 协议合规检测</span>
                <span className="text-xs text-default-500 font-normal mt-0.5">
                  {channelKey
                    ? `${channelKey.name} · ${channelKey.apiKeyMasked}`
                    : ""}
                </span>
              </div>
            </ModalHeader>
            <ModalBody className="gap-3">
              <Tabs
                selectedKey={view}
                onSelectionChange={(k) => setView(String(k) as "new" | "current")}
                size="sm"
              >
                <Tab key="new" title="新检测" />
                <Tab key="current" title={runId ? `当前/历史 #${runId}` : "历史"} />
              </Tabs>

              {view === "new" && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      label="协议"
                      size="sm"
                      selectedKeys={[form.protocol]}
                      onSelectionChange={(k) => {
                        const v = String(Array.from(k)[0] ?? "anthropic");
                        setForm((f) => ({ ...f, protocol: v }));
                      }}
                    >
                      <SelectItem key="anthropic">anthropic</SelectItem>
                      <SelectItem key="openai">openai</SelectItem>
                      <SelectItem key="gemini">gemini</SelectItem>
                    </Select>
                    <Select
                      label="模式"
                      size="sm"
                      selectedKeys={[form.mode]}
                      onSelectionChange={(k) => {
                        const v = String(Array.from(k)[0] ?? "full");
                        setForm((f) => ({ ...f, mode: v }));
                      }}
                    >
                      <SelectItem key="quick">quick (~15s)</SelectItem>
                      <SelectItem key="standard">standard (~40s)</SelectItem>
                      <SelectItem key="full">full (~70s)</SelectItem>
                    </Select>
                    <Input
                      size="sm"
                      label="模型"
                      value={form.model}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, model: v }))
                      }
                      placeholder="claude-opus-4-7"
                    />
                  </div>
                  {priorRuns.length > 0 && (
                    <div>
                      <div className="text-xs text-default-500 mb-1">
                        历史检测
                      </div>
                      <div className="border border-divider/50 rounded-lg overflow-hidden">
                        <Table removeWrapper aria-label="prior runs">
                          <TableHeader>
                            <TableColumn>时间</TableColumn>
                            <TableColumn>协议/模式</TableColumn>
                            <TableColumn>模型</TableColumn>
                            <TableColumn>状态</TableColumn>
                            <TableColumn>得分</TableColumn>
                            <TableColumn>verdict</TableColumn>
                            <TableColumn>{" "}</TableColumn>
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
                                  <StatusChip status={r.status} />
                                </TableCell>
                                <TableCell className="text-xs tabular-nums">
                                  {r.totalScore != null
                                    ? r.totalScore.toFixed(1)
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  {r.verdict ? (
                                    <VerdictChip verdict={r.verdict} />
                                  ) : (
                                    <span className="text-default-400 text-xs">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="light"
                                    className="h-7 px-2 text-[11px]"
                                    onPress={() => openPriorRun(r.id)}
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
                      <Spinner />
                    </div>
                  ) : (
                    <RunDetail run={run} />
                  )}
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close}>
                关闭
              </Button>
              {view === "new" && (
                <Button
                  color="primary"
                  isLoading={submitting}
                  onPress={submit}
                  isDisabled={!channelKey}
                >
                  开始检测
                </Button>
              )}
              {view === "current" && !inProgress && run && (
                <Button
                  color="primary"
                  variant="flat"
                  onPress={() => {
                    setView("new");
                    setRunId(null);
                    setRun(null);
                  }}
                >
                  新一次检测
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<
    string,
    { color: "default" | "primary" | "success" | "warning" | "danger"; label: string }
  > = {
    queued: { color: "default", label: "排队" },
    running: { color: "primary", label: "运行中" },
    done: { color: "success", label: "完成" },
    error: { color: "danger", label: "失败" },
  };
  const m = map[status] ?? { color: "default" as const, label: status };
  return (
    <Chip size="sm" color={m.color} variant="flat">
      {m.label}
    </Chip>
  );
}

function VerdictChip({ verdict }: { verdict: string }) {
  const map: Record<
    string,
    { color: "success" | "warning" | "danger" | "default"; label: string }
  > = {
    passed: { color: "success", label: "passed" },
    marginal: { color: "warning", label: "marginal" },
    failed: { color: "danger", label: "failed" },
  };
  const m = map[verdict] ?? { color: "default" as const, label: verdict };
  return (
    <Chip size="sm" color={m.color} variant="flat">
      {m.label}
    </Chip>
  );
}

function DetectorStatusChip({ status }: { status: string }) {
  const map: Record<
    string,
    { color: "success" | "warning" | "danger" | "default"; label: string }
  > = {
    pass: { color: "success", label: "pass" },
    fail: { color: "danger", label: "fail" },
    skip: { color: "default", label: "skip" },
    error: { color: "danger", label: "error" },
  };
  const m = map[status] ?? { color: "default" as const, label: status };
  return (
    <Chip size="sm" color={m.color} variant="flat">
      {m.label}
    </Chip>
  );
}

function RunDetail({ run }: { run: RunState }) {
  const progress = run.status === "running" || run.status === "queued";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusChip status={run.status} />
        {run.verdict && <VerdictChip verdict={run.verdict} />}
        <span className="text-xs text-default-500">
          {run.protocol} / {run.mode}
        </span>
        <span className="text-xs font-mono text-default-500">{run.model}</span>
        {run.totalScore != null && (
          <span className="text-sm font-bold">
            得分 <span className="tabular-nums">{run.totalScore.toFixed(1)}</span>
          </span>
        )}
        {run.summary && (
          <span className="text-sm text-default-700">{run.summary}</span>
        )}
      </div>

      {progress && (
        <Progress
          size="sm"
          isIndeterminate
          aria-label="running"
          color="primary"
        />
      )}

      {run.status === "error" && run.errorText && (
        <div className="text-xs text-danger whitespace-pre-wrap break-all border border-danger/30 bg-danger-50/30 rounded p-2">
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
          <div className="border border-warning/40 bg-warning-50/30 rounded p-2 text-xs">
            <span className="text-warning font-medium">
              检测到非 Anthropic 品牌词
            </span>
            <span className="ml-2 text-default-700">
              {report.detected_non_anthropic_brands.join("、")}
            </span>
          </div>
        )}

      {report.run_error && (
        <div className="border border-danger/40 bg-danger-50/30 rounded p-2 text-xs text-danger">
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
      <div className="text-xs text-default-500 mb-1">性能 & 用量</div>
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
      <div className="text-xs text-default-500 mb-1">
        检测项 ({results.length})
      </div>
      <Table removeWrapper aria-label="detectors">
        <TableHeader>
          <TableColumn>名称</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>得分</TableColumn>
          <TableColumn>权重</TableColumn>
          <TableColumn>耗时 ms</TableColumn>
          <TableColumn>错误</TableColumn>
          <TableColumn>{" "}</TableColumn>
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
                      <span className="text-[10px] text-default-400 font-mono">
                        {r.name}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <DetectorStatusChip status={r.status ?? "—"} />
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
                <TableCell className="text-xs text-danger break-all max-w-[200px]">
                  {r.error ?? ""}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="light"
                    className="h-7 px-2 text-[11px]"
                    onPress={() =>
                      setOpenIdx(openIdx === i ? null : i)
                    }
                    isDisabled={!r.details}
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
                <TableCell colSpan={7} className="bg-content2/30">
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
    <div className="border border-divider/50 rounded p-2">
      <div className="text-[10px] text-default-500">{label}</div>
      <div
        className={`${mono ? "font-mono" : ""} ${
          truncate ? "truncate" : ""
        } text-sm`}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}
