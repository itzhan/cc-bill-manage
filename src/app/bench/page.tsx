"use client";
import { useEffect, useState } from "react";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  CardHeader,
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
  addToast,
  useDisclosure,
} from "@heroui/react";

const MODEL_PRESETS = [
  { key: "claude-opus-4-7", label: "claude-opus-4-7（默认）" },
  { key: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
  { key: "claude-haiku-4-5", label: "claude-haiku-4-5" },
];
import { Plus, Trash2, Gauge } from "lucide-react";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { useRouter } from "next/navigation";

interface Run {
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
  avgAnswerLatencyS: number | null;
  hasSignature: boolean | null;
  serviceTierPresent: boolean | null;
  cacheCreationPresent: boolean | null;
  totalThinkingChars: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const OFFICIAL_PASS_RATE = 0.527; // n=30 baseline
const MODE_OPTIONS = [
  { key: "30", label: "🚀 快速 (n=30, ~12 min)" },
  { key: "60", label: "⚖️ 标准 (n=60, ~25 min)" },
  { key: "124", label: "🎯 完整 (n=124, ~50 min)" },
];

export default function BenchPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const newRunModal = useDisclosure();

  async function load() {
    const r = await fetch("/api/bench/runs");
    const d = await r.json();
    setRuns(d.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  async function del(id: number) {
    if (!confirm("删除该测试记录？")) return;
    const r = await fetch(`/api/bench/runs/${id}`, { method: "DELETE" });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    load();
  }

  return (
    <Shell>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Gauge size={20} /> 基准测试
          </h1>
          <p className="text-xs text-default-500 mt-1">
            SWE-Atlas-QnA · 衡量中转站 智商 / 协议指纹 / 延迟 · 官方基线
            {(OFFICIAL_PASS_RATE * 100).toFixed(2)}%（n=30, opus-4-7, effort=high）
          </p>
        </div>
        <Button color="primary" startContent={<Plus size={16} />} onPress={newRunModal.onOpen}>
          新建测试
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-default-500 text-sm">
            还没有测试记录。点 右上角 新建测试 跑第一次。
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table removeWrapper aria-label="bench runs">
              <TableHeader>
                <TableColumn>名称</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn>进度</TableColumn>
                <TableColumn className="text-right">智商分</TableColumn>
                <TableColumn className="text-right">vs 官方</TableColumn>
                <TableColumn className="text-center">指纹</TableColumn>
                <TableColumn>开始时间</TableColumn>
                <TableColumn className="text-right">操作</TableColumn>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-default-100" onClick={() => router.push(`/bench/${r.id}`)}>
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-[11px] text-default-400">
                          {r.model} · n={r.n} · effort={r.effort} · {r.baseUrl}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={r.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 min-w-[140px]">
                        <Progress
                          size="sm"
                          aria-label="progress"
                          value={(r.completedCount / Math.max(1, r.totalCount)) * 100}
                          color={r.failedCount > 0 ? "warning" : "primary"}
                        />
                        <span className="text-[11px] text-default-500">
                          {r.completedCount}/{r.totalCount}
                          {r.failedCount > 0 ? ` · ${r.failedCount} 失败` : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.mustHavePassRate != null ? `${(r.mustHavePassRate * 100).toFixed(2)}%` : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <DeltaPill rate={r.mustHavePassRate} n={r.n} model={r.model} />
                    </TableCell>
                    <TableCell className="text-center">
                      <FingerprintBadge run={r} />
                    </TableCell>
                    <TableCell className="text-xs text-default-500">{fmtDate(r.startedAt ?? r.createdAt)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => del(r.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <NewRunModal
        isOpen={newRunModal.isOpen}
        onClose={newRunModal.onClose}
        onCreated={(id) => {
          newRunModal.onClose();
          router.push(`/bench/${id}`);
        }}
      />
    </Shell>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { color: "default" | "primary" | "success" | "warning" | "danger"; label: string }> = {
    queued: { color: "default", label: "排队中" },
    running: { color: "primary", label: "运行中" },
    done: { color: "success", label: "完成" },
    error: { color: "danger", label: "错误" },
    canceled: { color: "warning", label: "已取消" },
  };
  const v = map[status] ?? { color: "default" as const, label: status };
  return (
    <Chip size="sm" variant="flat" color={v.color}>
      {v.label}
    </Chip>
  );
}

function DeltaPill({ rate, n, model }: { rate: number | null; n: number; model: string }) {
  if (rate == null) return <span className="text-default-400">-</span>;
  if (n !== 30 || model !== "claude-opus-4-7") {
    return <span className="text-default-400 text-xs">无基线</span>;
  }
  const delta = (rate - OFFICIAL_PASS_RATE) * 100;
  const color = Math.abs(delta) <= 10 ? "default" : delta > 0 ? "success" : "warning";
  const sign = delta >= 0 ? "+" : "";
  return (
    <Chip size="sm" variant="flat" color={color}>
      {sign}
      {delta.toFixed(2)} pp
    </Chip>
  );
}

function FingerprintBadge({ run }: { run: Run }) {
  if (run.totalThinkingChars == null && run.hasSignature == null) {
    return <span className="text-default-400 text-xs">-</span>;
  }
  // Heuristic per BENCHMARK.md §7: encrypted thinking + signature + complete
  // usage = real; missing any = suspect.
  let score = 0;
  if ((run.totalThinkingChars ?? 0) > 1000) score -= 50;
  if (run.hasSignature === false) score -= 50;
  if (run.serviceTierPresent === false) score -= 20;
  if (run.cacheCreationPresent === false) score -= 20;

  if (score >= 0) return <Chip size="sm" color="success" variant="flat">真</Chip>;
  if (score > -100) return <Chip size="sm" color="warning" variant="flat">疑似</Chip>;
  return <Chip size="sm" color="danger" variant="flat">伪装</Chip>;
}

function NewRunModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://38.34.191.113:8080");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-opus-4-7");
  const [mode, setMode] = useState<Set<string>>(new Set(["30"]));
  const [effort, setEffort] = useState<Set<string>>(new Set(["high"]));
  const [concurrency, setConcurrency] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setApiKey("");
    setModel("claude-opus-4-7");
    setMode(new Set(["30"]));
    setEffort(new Set(["high"]));
    setConcurrency(10);
  }, [isOpen]);

  async function submit() {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      addToast({ title: "请填写名称 / 端点 / api key / 模型", color: "danger" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/bench/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
          judgeModel: model.trim(),
          n: Number([...mode][0] ?? "30"),
          seed: 42,
          effort: [...effort][0] ?? "high",
          judgeEffort: [...effort][0] ?? "high",
          concurrency,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        addToast({ title: "启动失败", description: d.error ?? "", color: "danger" });
        return;
      }
      onCreated(d.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>新建基准测试</ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input
              label="测试名称"
              placeholder="例如 v5-new-key"
              value={name}
              onValueChange={setName}
              description="用于后续对比，建议带渠道/版本标识"
            />
            <Input
              label="API 端点"
              placeholder="http://host:port"
              value={baseUrl}
              onValueChange={setBaseUrl}
              description="Anthropic 原生协议 base，会自动拼接 /v1/messages"
            />
            <Input
              label="API Key"
              placeholder="sk-..."
              value={apiKey}
              onValueChange={setApiKey}
              type="password"
            />
            <Autocomplete
              label="模型 ID"
              placeholder="claude-opus-4-7"
              defaultItems={MODEL_PRESETS}
              selectedKey={
                MODEL_PRESETS.some((p) => p.key === model) ? model : null
              }
              inputValue={model}
              onInputChange={setModel}
              onSelectionChange={(k) => {
                if (k != null) setModel(String(k));
              }}
              allowsCustomValue
              description="常用：claude-opus-4-7 · claude-sonnet-4-6 · claude-haiku-4-5。可下拉选也可自由输入。官方 n=30 基线仅适用于 opus-4-7"
            >
              {(item) => (
                <AutocompleteItem key={item.key}>{item.label}</AutocompleteItem>
              )}
            </Autocomplete>
            <Select
              label="测试规模"
              selectedKeys={mode}
              onSelectionChange={(k) => setMode(new Set(k as Set<string>))}
            >
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.key}>{o.label}</SelectItem>
              ))}
            </Select>
            <div className="flex gap-3">
              <Select
                label="思考强度"
                className="flex-1"
                selectedKeys={effort}
                onSelectionChange={(k) => setEffort(new Set(k as Set<string>))}
              >
                <SelectItem key="high">high（推荐）</SelectItem>
                <SelectItem key="medium">medium</SelectItem>
                <SelectItem key="low">low</SelectItem>
                <SelectItem key="">不开思考</SelectItem>
              </Select>
              <Input
                type="number"
                label="并发"
                className="w-32"
                value={String(concurrency)}
                onValueChange={(v) => setConcurrency(Math.max(1, Math.min(30, Number(v) || 1)))}
                description="推荐 10"
              />
            </div>
            {[...mode][0] !== "30" && (
              <p className="text-xs text-warning">
                官方基线只锁定了 n=30 模式。其它模式只能跨自有渠道横比。
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" isLoading={submitting} onPress={submit}>
            开始测试
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
