"use client";
import { useEffect, useState, use } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Progress,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { ArrowLeft, RefreshCw, StopCircle } from "lucide-react";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import Link from "next/link";

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
  tasks: TaskRow[];
}

interface Baseline {
  summary: { must_have_pass_rate: number; task_resolve_rate: number };
  tasks: Record<string, { must_have: [number, number]; resolved: boolean; category: string; answer_latency_s: number }>;
}

const OFFICIAL_PASS = 0.527;

export default function BenchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [pickedTask, setPickedTask] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/bench/runs/${id}`);
    const d = await r.json();
    setRun(d.run);
  }

  useEffect(() => {
    load();
    fetch("/api/bench/baseline").then((r) => r.json()).then(setBaseline).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!run || run.status === "done" || run.status === "error" || run.status === "canceled") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  async function cancel() {
    if (!confirm("取消该测试？已在跑的题会跑完")) return;
    await fetch(`/api/bench/runs/${id}/cancel`, { method: "POST" });
    load();
  }

  async function restart() {
    await fetch(`/api/bench/runs/${id}`, { method: "POST" });
    load();
  }

  if (!run) {
    return (
      <Shell>
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </Shell>
    );
  }

  const isRunning = run.status === "running" || run.status === "queued";
  const showRestart = run.status === "canceled" || (run.status === "error" && run.failedCount < run.totalCount);

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4">
        <Button as={Link} href="/bench" size="sm" variant="light" startContent={<ArrowLeft size={14} />}>
          返回
        </Button>
        <h1 className="text-xl font-semibold flex-1 truncate">{run.name}</h1>
        {isRunning && (
          <Button size="sm" color="warning" variant="flat" startContent={<StopCircle size={14} />} onPress={cancel}>
            取消
          </Button>
        )}
        {showRestart && (
          <Button size="sm" color="primary" variant="flat" startContent={<RefreshCw size={14} />} onPress={restart}>
            续跑
          </Button>
        )}
      </div>

      {/* Top status row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile
          label="智商分（must_have）"
          value={run.mustHavePassRate != null ? `${(run.mustHavePassRate * 100).toFixed(2)}%` : "—"}
          sub={
            run.n === 30 && run.model === "claude-opus-4-7" && run.mustHavePassRate != null
              ? `vs 官方 52.70% · Δ ${((run.mustHavePassRate - OFFICIAL_PASS) * 100 >= 0 ? "+" : "")}${((run.mustHavePassRate - OFFICIAL_PASS) * 100).toFixed(2)} pp`
              : null
          }
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
        <Progress
          aria-label="overall"
          className="mb-4"
          value={(run.completedCount / Math.max(1, run.totalCount)) * 100}
          color={run.failedCount > 0 ? "warning" : "primary"}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2 text-sm font-semibold">协议指纹</CardHeader>
          <CardBody className="text-xs flex flex-col gap-2 pt-0">
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
            <p className="text-default-400 mt-2">指纹规则参考 BENCHMARK.md §7。</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 text-sm font-semibold">运行配置</CardHeader>
          <CardBody className="text-xs grid grid-cols-2 gap-y-2 gap-x-4 pt-0">
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
              <div className="col-span-2 text-danger">错误: {run.errorSummary}</div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="text-sm font-semibold">逐题分数</CardHeader>
        <CardBody className="p-0">
          <Table removeWrapper aria-label="tasks">
            <TableHeader>
              <TableColumn>task_id</TableColumn>
              <TableColumn>类别 / 语言</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn className="text-right">must_have</TableColumn>
              <TableColumn className="text-right">官方</TableColumn>
              <TableColumn className="text-right">延迟 (ans+judge)</TableColumn>
              <TableColumn className="text-right">tokens</TableColumn>
            </TableHeader>
            <TableBody>
              {run.tasks.map((t) => {
                const base = baseline?.tasks[t.taskId];
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-default-100"
                    onClick={() => t.status === "done" && setPickedTask(t.taskId)}
                  >
                    <TableCell className="font-mono text-[11px]">{t.taskId.slice(-8)}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col leading-tight">
                        <span className="truncate max-w-[220px]">{t.category}</span>
                        <span className="text-default-400">{t.language}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TaskStatusChip status={t.status} resolved={t.resolved} errorText={t.errorText} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.mustGot != null && t.mustTotal != null
                        ? `${t.mustGot}/${t.mustTotal}`
                        : t.status === "running"
                        ? "..."
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-default-500">
                      {run.n === 30 && run.model === "claude-opus-4-7" && base ? `${base.must_have[0]}/${base.must_have[1]}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.answerLatencyS != null
                        ? `${t.answerLatencyS.toFixed(1)}+${(t.judgeLatencyS ?? 0).toFixed(1)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-default-500">
                      {t.answerInputTokens != null
                        ? `${(t.answerInputTokens + (t.judgeInputTokens ?? 0)).toLocaleString()} / ${((t.answerOutputTokens ?? 0) + (t.judgeOutputTokens ?? 0)).toLocaleString()}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardBody>
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
      <CardBody className="py-3">
        <div className="text-xs text-default-500">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-default-400 mt-1">{sub}</div>}
      </CardBody>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-default-400">{label}</div>
      <div className="font-mono break-all">{value}</div>
    </div>
  );
}

function FingerprintLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-default-500">{label}</span>
      <Chip size="sm" color={ok ? "success" : "danger"} variant="flat">
        {detail}
      </Chip>
    </div>
  );
}

function TaskStatusChip({
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
      <Chip size="sm" variant="flat" color={resolved ? "success" : "default"}>
        {resolved ? "全过" : "完成"}
      </Chip>
    );
  }
  if (status === "running") return <Chip size="sm" variant="flat" color="primary">运行中</Chip>;
  if (status === "error")
    return (
      <Chip size="sm" variant="flat" color="danger" title={errorText ?? ""}>
        错误
      </Chip>
    );
  return <Chip size="sm" variant="flat" color="default">待</Chip>;
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
      .catch(() => addToast({ title: "加载失败", color: "danger" }));
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
    <Modal isOpen onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="font-mono text-sm">{taskId}</span>
          <span className="text-xs text-default-500 font-normal">
            {data?.task.category} · {data?.task.language} · {data?.repository_url}
          </span>
        </ModalHeader>
        <ModalBody className="text-sm">
          {!data ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-4">
              <section>
                <h3 className="text-xs font-semibold text-default-500 uppercase tracking-wide mb-1">题面</h3>
                <pre className="text-xs whitespace-pre-wrap bg-default-100 rounded-lg p-3 max-h-80 overflow-auto">
                  {data.prompt}
                </pre>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-default-500 uppercase tracking-wide mb-1">候选答案</h3>
                <pre className="text-xs whitespace-pre-wrap bg-default-100 rounded-lg p-3 max-h-80 overflow-auto">
                  {data.task.answerText ?? "（无）"}
                </pre>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-default-500 uppercase tracking-wide mb-1">
                  Rubric 评分（{data.task.mustGot}/{data.task.mustTotal} must-have）
                </h3>
                <Table removeWrapper aria-label="rubric">
                  <TableHeader>
                    <TableColumn>importance</TableColumn>
                    <TableColumn>title</TableColumn>
                    <TableColumn className="text-center">satisfied</TableColumn>
                    <TableColumn>reason</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {(data.rubric ?? []).map((r) => {
                      const j = byId.get(r.id);
                      const imp = r.annotations?.importance ?? "";
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Chip size="sm" variant="flat" color={imp === "must have" ? "primary" : "default"}>
                              {imp}
                            </Chip>
                          </TableCell>
                          <TableCell className="text-xs">{r.title}</TableCell>
                          <TableCell className="text-center">
                            {j ? (
                              <Chip size="sm" variant="flat" color={j.satisfied ? "success" : "danger"}>
                                {j.satisfied ? "✓" : "✗"}
                              </Chip>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-default-500">{j?.reason ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </section>

              {data.task.errorText && (
                <section>
                  <h3 className="text-xs font-semibold text-danger mb-1">错误</h3>
                  <pre className="text-xs whitespace-pre-wrap bg-danger-50 rounded-lg p-3">
                    {data.task.errorText}
                  </pre>
                </section>
              )}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
