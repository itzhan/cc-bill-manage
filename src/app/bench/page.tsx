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
  Textarea,
  addToast,
  useDisclosure,
} from "@heroui/react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Gauge,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";

const MODEL_PRESETS = [
  { key: "claude-opus-4-7", label: "claude-opus-4-7" },
  { key: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
  { key: "claude-haiku-4-5", label: "claude-haiku-4-5" },
];

const OFFICIAL_PASS_RATE = 0.527; // n=30 baseline

const MODE_OPTIONS = [
  { key: "3", label: "🪶 烟测 (n=3, ~1 min)" },
  { key: "30", label: "🚀 快速 (n=30, ~12 min)" },
  { key: "60", label: "⚖️ 标准 (n=60, ~25 min)" },
  { key: "124", label: "🎯 完整 (n=124, ~50 min)" },
];

interface RunSummary {
  id: number;
  status: string;
  probeStatus: string;
  probeVerdict: string | null;
  probeAuthenticityScore: number | null;
  mustHavePassRate: number | null;
  taskResolveRate: number | null;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  n: number;
  model: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ChannelKey {
  id: number;
  name: string;
  apiKeyMasked: string;
  notes: string | null;
  latestRun: RunSummary | null;
}

interface Channel {
  id: number;
  name: string;
  baseUrl: string;
  notes: string | null;
  createdAt: string;
  keys: ChannelKey[];
}

export default function BenchPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const router = useRouter();

  const newChannelDlg = useDisclosure();
  const newKeyDlg = useDisclosure();
  const testDlg = useDisclosure();
  const editChannelDlg = useDisclosure();
  const editKeyDlg = useDisclosure();

  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<ChannelKey | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [editingKey, setEditingKey] = useState<{
    channelId: number;
    key: ChannelKey;
  } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/bench/channels", { cache: "no-store" });
      const j = await r.json();
      setChannels(j.items ?? []);
      // Auto-expand any channel with at least one key the first time we load
      // so the user immediately sees keys without a click.
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<number>();
        for (const c of j.items ?? []) if (c.keys.length > 0) next.add(c.id);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  function toggle(id: number) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteChannel(c: Channel) {
    if (!confirm(`删除「${c.name}」？该分组下的所有 key 和测试记录都会被删除。`))
      return;
    const r = await fetch(`/api/bench/channels/${c.id}`, { method: "DELETE" });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
    load();
  }

  async function deleteKey(channelId: number, k: ChannelKey) {
    if (!confirm(`删除 key「${k.name}」？该 key 下的测试记录也会被删除。`))
      return;
    const r = await fetch(`/api/bench/keys/${k.id}`, { method: "DELETE" });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    void channelId;
    addToast({ title: "已删除", color: "success" });
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
            按渠道分组管理 key · 多 key 可同时测试 · 官方基线{" "}
            {(OFFICIAL_PASS_RATE * 100).toFixed(2)}%（n=30, opus-4-7, effort=high）
          </p>
        </div>
        <Button
          color="primary"
          startContent={<Plus size={16} />}
          onPress={() => {
            setEditingChannel(null);
            newChannelDlg.onOpen();
          }}
        >
          新建渠道分组
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-default-500 text-sm">
            还没有渠道分组。点右上「新建渠道分组」开始。
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {channels.map((c) => {
            const open = expanded.has(c.id);
            return (
              <Card
                key={c.id}
                className="bg-content1 border border-divider/50 shadow-none"
              >
                <CardHeader
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-stop-toggle]"))
                      return;
                    toggle(c.id);
                  }}
                  className="flex justify-between items-start gap-3 flex-wrap cursor-pointer hover:bg-default-50 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {open ? (
                      <ChevronDown size={16} className="mt-1 text-default-400" />
                    ) : (
                      <ChevronRight size={16} className="mt-1 text-default-400" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{c.name}</h3>
                        <Chip size="sm" variant="flat">
                          {c.keys.length} keys
                        </Chip>
                      </div>
                      <p className="text-xs text-default-500 mt-1 break-all">
                        {c.baseUrl}
                      </p>
                      {c.notes && (
                        <p className="text-xs text-default-400 mt-0.5 break-all">
                          {c.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap" data-stop-toggle>
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<Plus size={14} />}
                      onPress={() => {
                        setActiveChannelId(c.id);
                        newKeyDlg.onOpen();
                      }}
                    >
                      添加 key
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      onPress={() => {
                        setEditingChannel(c);
                        newChannelDlg.onOpen();
                      }}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      color="danger"
                      onPress={() => deleteChannel(c)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardHeader>
                {open && (
                  <CardBody className="pt-0 gap-2">
                    {c.keys.length === 0 ? (
                      <p className="text-xs text-default-400 italic py-2">
                        还没有 key。点上方「添加 key」开始。
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-divider/40">
                        {c.keys.map((k) => (
                          <KeyRow
                            key={k.id}
                            channelId={c.id}
                            data={k}
                            onTest={() => {
                              setActiveChannelId(c.id);
                              setActiveKey(k);
                              testDlg.onOpen();
                            }}
                            onEdit={() => {
                              setEditingKey({ channelId: c.id, key: k });
                              editKeyDlg.onOpen();
                            }}
                            onDelete={() => deleteKey(c.id, k)}
                            onOpen={() => {
                              if (k.latestRun) {
                                router.push(`/bench/${k.latestRun.id}`);
                              }
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ChannelFormModal
        isOpen={newChannelDlg.isOpen}
        onClose={() => {
          newChannelDlg.onClose();
          setEditingChannel(null);
        }}
        editing={editingChannel}
        onSaved={() => {
          newChannelDlg.onClose();
          setEditingChannel(null);
          load();
        }}
      />
      <KeyFormModal
        isOpen={newKeyDlg.isOpen}
        onClose={newKeyDlg.onClose}
        channelId={activeChannelId}
        onSaved={() => {
          newKeyDlg.onClose();
          load();
        }}
      />
      <KeyEditModal
        isOpen={editKeyDlg.isOpen}
        onClose={() => {
          editKeyDlg.onClose();
          setEditingKey(null);
        }}
        editing={editingKey?.key ?? null}
        onSaved={() => {
          editKeyDlg.onClose();
          setEditingKey(null);
          load();
        }}
      />
      <TestRunModal
        isOpen={testDlg.isOpen}
        onClose={() => {
          testDlg.onClose();
          setActiveKey(null);
        }}
        channelKey={activeKey}
        onCreated={(runId) => {
          testDlg.onClose();
          setActiveKey(null);
          // Don't navigate — the user might want to kick another key in
          // parallel. We just refresh the list so the new run appears.
          load();
          addToast({
            title: "测试已开始",
            description: "后台运行中，可继续测试其它 key",
            color: "success",
          });
          void runId;
        }}
      />
    </Shell>
  );
}

function KeyRow({
  data,
  onTest,
  onEdit,
  onDelete,
  onOpen,
}: {
  channelId: number;
  data: ChannelKey;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const lr = data.latestRun;
  const running =
    lr != null && (lr.status === "running" || lr.status === "queued");
  const progressPct =
    lr && lr.totalCount > 0
      ? (lr.completedCount / lr.totalCount) * 100
      : 0;
  return (
    <div className="flex items-center gap-3 py-2 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{data.name}</span>
          <span className="font-mono text-[11px] text-default-400">
            {data.apiKeyMasked}
          </span>
        </div>
        {data.notes && (
          <div className="text-[11px] text-default-400 mt-0.5 break-all">
            {data.notes}
          </div>
        )}
        {lr ? (
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <RunStatusChip run={lr} />
            <VerdictChip run={lr} />
            <PassRatePill run={lr} />
            <span className="text-[11px] text-default-400">
              {fmtDate(lr.startedAt ?? lr.createdAt)} · n={lr.n} · {lr.model}
            </span>
            {running && (
              <Progress
                size="sm"
                aria-label="progress"
                value={progressPct}
                className="w-32"
                color={lr.failedCount > 0 ? "warning" : "primary"}
              />
            )}
          </div>
        ) : (
          <div className="text-[11px] text-default-400 mt-1">尚未测试</div>
        )}
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={<PlayCircle size={14} />}
          onPress={onTest}
          isDisabled={running}
        >
          {running ? "测试中" : lr ? "再测一次" : "测试"}
        </Button>
        {lr && (
          <Button
            as={Link}
            href={`/bench/${lr.id}`}
            size="sm"
            variant="flat"
            startContent={<Eye size={14} />}
            onPress={onOpen}
          >
            详情
          </Button>
        )}
        <Button size="sm" isIconOnly variant="light" onPress={onEdit} title="编辑">
          <Pencil size={14} />
        </Button>
        <Button
          size="sm"
          isIconOnly
          variant="light"
          color="danger"
          onPress={onDelete}
          title="删除"
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

function RunStatusChip({ run }: { run: RunSummary }) {
  const map: Record<
    string,
    { color: "default" | "primary" | "success" | "warning" | "danger"; label: string }
  > = {
    queued: { color: "default", label: "排队中" },
    running: { color: "primary", label: "运行中" },
    done: { color: "success", label: "完成" },
    error: { color: "danger", label: "错误" },
    canceled: { color: "warning", label: "取消" },
  };
  const m = map[run.status] ?? { color: "default" as const, label: run.status };
  return (
    <Chip size="sm" color={m.color} variant="flat">
      {m.label}
    </Chip>
  );
}

function VerdictChip({ run }: { run: RunSummary }) {
  if (run.probeStatus === "pending") {
    return (
      <Chip size="sm" variant="flat" color="default">
        探针待跑
      </Chip>
    );
  }
  if (run.probeStatus === "running") {
    return (
      <Chip size="sm" variant="flat" color="primary">
        探针中
      </Chip>
    );
  }
  if (run.probeStatus === "error") {
    return (
      <Chip size="sm" variant="flat" color="danger">
        探针失败
      </Chip>
    );
  }
  const v = run.probeVerdict;
  if (v === "real")
    return (
      <Chip size="sm" color="success" variant="flat">
        真直连
      </Chip>
    );
  if (v === "suspicious")
    return (
      <Chip size="sm" color="warning" variant="flat">
        疑似伪装
      </Chip>
    );
  if (v === "fake")
    return (
      <Chip size="sm" color="danger" variant="flat">
        明确伪装
      </Chip>
    );
  return null;
}

function PassRatePill({ run }: { run: RunSummary }) {
  if (run.mustHavePassRate == null) {
    return <span className="text-xs text-default-400">智商待测</span>;
  }
  const pct = run.mustHavePassRate * 100;
  const eligibleForBaseline = run.n === 30 && run.model === "claude-opus-4-7";
  const delta = pct - OFFICIAL_PASS_RATE * 100;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-semibold tabular-nums">{pct.toFixed(2)}%</span>
      {eligibleForBaseline && (
        <Chip
          size="sm"
          variant="flat"
          color={Math.abs(delta) <= 10 ? "default" : delta > 0 ? "success" : "warning"}
          classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}
        >
          {(delta >= 0 ? "+" : "") + delta.toFixed(1)} pp
        </Chip>
      )}
    </div>
  );
}

// ============================================================
// Modals
// ============================================================

function ChannelFormModal({
  isOpen,
  onClose,
  editing,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  editing: Channel | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://38.34.191.113:8080");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setName(editing.name);
      setBaseUrl(editing.baseUrl);
      setNotes(editing.notes ?? "");
    } else {
      setName("");
      setBaseUrl("http://38.34.191.113:8080");
      setNotes("");
    }
  }, [isOpen, editing]);

  async function submit() {
    if (!name.trim() || !baseUrl.trim()) {
      addToast({ title: "名称和 Base URL 必填", color: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const url = editing
        ? `/api/bench/channels/${editing.id}`
        : `/api/bench/channels`;
      const r = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({
          title: editing ? "保存失败" : "创建失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>{editing ? `编辑「${editing.name}」` : "新建渠道分组"}</ModalHeader>
        <ModalBody className="gap-3">
          <Input
            label="名称"
            placeholder="如 v6-relay"
            value={name}
            onValueChange={setName}
          />
          <Input
            label="Base URL"
            placeholder="http://host:port"
            description="Anthropic 原生协议入口；下面会自动拼 /v1/messages"
            value={baseUrl}
            onValueChange={setBaseUrl}
          />
          <Textarea
            label="备注"
            placeholder="可选：联系方式、续费时间、上游来源等"
            minRows={2}
            value={notes}
            onValueChange={setNotes}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={submit} isLoading={submitting}>
            {editing ? "保存" : "创建"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function KeyFormModal({
  isOpen,
  onClose,
  channelId,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  channelId: number | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setApiKey("");
    setNotes("");
  }, [isOpen]);

  async function submit() {
    if (!channelId) return;
    if (!name.trim() || !apiKey.trim()) {
      addToast({ title: "名称和 API Key 必填", color: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/bench/channels/${channelId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          apiKey: apiKey.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({ title: "创建失败", description: j.error, color: "danger" });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>添加 key</ModalHeader>
        <ModalBody className="gap-3">
          <Input
            label="key 名称"
            placeholder="如 v4-vip / 月卡 #2"
            value={name}
            onValueChange={setName}
          />
          <Input
            label="API Key"
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onValueChange={setApiKey}
          />
          <Textarea
            label="备注"
            placeholder="可选"
            minRows={2}
            value={notes}
            onValueChange={setNotes}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={submit} isLoading={submitting}>
            添加
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function KeyEditModal({
  isOpen,
  onClose,
  editing,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  editing: ChannelKey | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  // Empty input = "don't change". Non-empty = replace.
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !editing) return;
    setName(editing.name);
    setApiKey("");
    setNotes(editing.notes ?? "");
  }, [isOpen, editing]);

  async function submit() {
    if (!editing) return;
    if (!name.trim()) {
      addToast({ title: "名称必填", color: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        notes: notes.trim() || null,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await fetch(`/api/bench/keys/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>编辑 key{editing ? ` · ${editing.name}` : ""}</ModalHeader>
        <ModalBody className="gap-3">
          <Input label="key 名称" value={name} onValueChange={setName} />
          <Input
            label="新 API Key（留空则不修改）"
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onValueChange={setApiKey}
          />
          <Textarea
            label="备注"
            minRows={2}
            value={notes}
            onValueChange={setNotes}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={submit} isLoading={submitting}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function TestRunModal({
  isOpen,
  onClose,
  channelKey,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  channelKey: ChannelKey | null;
  onCreated: (runId: number) => void;
}) {
  const [model, setModel] = useState("claude-opus-4-7");
  const [mode, setMode] = useState<Set<string>>(new Set(["30"]));
  const [effort, setEffort] = useState<Set<string>>(new Set(["high"]));
  const [concurrency, setConcurrency] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModel("claude-opus-4-7");
    setMode(new Set(["30"]));
    setEffort(new Set(["high"]));
    setConcurrency(10);
  }, [isOpen]);

  async function submit() {
    if (!channelKey) return;
    if (!model.trim()) {
      addToast({ title: "请填写模型 ID", color: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/bench/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelKeyId: channelKey.id,
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
        addToast({
          title: "启动失败",
          description: d.error ?? "",
          color: "danger",
        });
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
        <ModalHeader>
          测试 key{channelKey ? ` · ${channelKey.name}` : ""}
        </ModalHeader>
        <ModalBody className="gap-3">
          <Autocomplete
            label="模型 ID"
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
            description="可下拉选也可自由输入"
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
              onValueChange={(v) =>
                setConcurrency(Math.max(1, Math.min(30, Number(v) || 1)))
              }
              description="推荐 10"
            />
          </div>
          {[...mode][0] !== "30" && (
            <p className="text-xs text-warning">
              官方基线只锁定了 n=30 模式。其它模式只能跨自有 key 横比。
            </p>
          )}
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
