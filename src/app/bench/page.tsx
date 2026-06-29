"use client";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import VeridropModal from "@/components/VeridropModal";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";

const MODEL_PRESETS = [
  { key: "claude-opus-4-7", label: "claude-opus-4-7" },
  { key: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
  { key: "claude-haiku-4-5", label: "claude-haiku-4-5" },
];

const OFFICIAL_PASS_RATE = 0.527; // n=30 baseline

const MODE_OPTIONS = [
  { key: "3", label: "\u{1FAB6} 烟测 (n=3, ~1 min)" },
  { key: "30", label: "\u{1F680} 快速 (n=30, ~12 min)" },
  { key: "60", label: "⚖️ 标准 (n=60, ~25 min)" },
  { key: "124", label: "\u{1F3AF} 完整 (n=124, ~50 min)" },
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

  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoKeyId, setInfoKeyId] = useState<number | null>(null);

  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<ChannelKey | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [editingKey, setEditingKey] = useState<{
    channelId: number;
    key: ChannelKey;
  } | null>(null);
  const [veridropKey, setVeridropKey] = useState<ChannelKey | null>(null);
  const [veridropDlgOpen, setVeridropDlgOpen] = useState(false);

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
      toast.error("删除失败");
      return;
    }
    toast.success("已删除");
    load();
  }

  async function deleteKey(channelId: number, k: ChannelKey) {
    if (!confirm(`删除 key「${k.name}」？该 key 下的测试记录也会被删除。`))
      return;
    const r = await fetch(`/api/bench/keys/${k.id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("删除失败");
      return;
    }
    void channelId;
    toast.success("已删除");
    load();
  }

  // 强行终止该 key 当前运行中的 BenchRun。后端会立刻把 status 翻成
  // "canceled" + 设 cancelRequested=true, 引擎下一轮 between-task 检查会
  // 停手, in-flight 的 LLM 调用自然走完不再启新任务。UI 状态会立刻更新,
  // 然后用户就能点"再测一次"开新 run。
  async function cancelRun(k: ChannelKey) {
    const lr = k.latestRun;
    if (!lr) return;
    if (!confirm(`终止当前测试「${k.name}」?in-flight 任务自然结束。`)) return;
    const r = await fetch(`/api/bench/runs/${lr.id}/cancel`, {
      method: "POST",
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error("终止失败", {
        description: String(j.error || r.status),
      });
      return;
    }
    toast.success("已终止");
    load();
  }

  return (
    <Shell>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Gauge size={20} /> 基准测试
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            按渠道分组管理 key · 多 key 可同时测试 · 官方基线{" "}
            {(OFFICIAL_PASS_RATE * 100).toFixed(2)}%（n=30, opus-4-7, effort=high）
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingChannel(null);
            setNewChannelOpen(true);
          }}
        >
          <Plus size={16} />
          新建渠道分组
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            还没有渠道分组。点右上「新建渠道分组」开始。
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {channels.map((c) => {
            const open = expanded.has(c.id);
            return (
              <Card key={c.id}>
                <CardHeader
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-stop-toggle]"))
                      return;
                    toggle(c.id);
                  }}
                  className="flex flex-row justify-between items-start gap-3 flex-wrap cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {open ? (
                      <ChevronDown size={16} className="mt-1 text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="mt-1 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{c.name}</h3>
                        <Badge variant="secondary">
                          {c.keys.length} keys
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 break-all">
                        {c.baseUrl}
                      </p>
                      {c.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 break-all">
                          {c.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap" data-stop-toggle>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setActiveChannelId(c.id);
                        setNewKeyOpen(true);
                      }}
                    >
                      <Plus size={14} />
                      添加 key
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingChannel(c);
                        setNewChannelOpen(true);
                      }}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteChannel(c)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardHeader>
                {open && (
                  <CardContent className="pt-0 gap-2">
                    {c.keys.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2">
                        还没有 key。点上方「添加 key」开始。
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {c.keys.map((k) => (
                          <KeyRow
                            key={k.id}
                            channelId={c.id}
                            data={k}
                            onTest={() => {
                              setActiveChannelId(c.id);
                              setActiveKey(k);
                              setTestOpen(true);
                            }}
                            onEdit={() => {
                              setEditingKey({ channelId: c.id, key: k });
                              setEditKeyOpen(true);
                            }}
                            onDelete={() => deleteKey(c.id, k)}
                            onOpen={() => {
                              if (k.latestRun) {
                                router.push(`/bench/${k.latestRun.id}`);
                              }
                            }}
                            onInfo={() => {
                              setInfoKeyId(k.id);
                              setInfoOpen(true);
                            }}
                            onCancel={() => cancelRun(k)}
                            onVeridrop={() => {
                              setVeridropKey(k);
                              setVeridropDlgOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ChannelFormModal
        isOpen={newChannelOpen}
        onClose={() => {
          setNewChannelOpen(false);
          setEditingChannel(null);
        }}
        editing={editingChannel}
        onSaved={() => {
          setNewChannelOpen(false);
          setEditingChannel(null);
          load();
        }}
      />
      <KeyFormModal
        isOpen={newKeyOpen}
        onClose={() => setNewKeyOpen(false)}
        channelId={activeChannelId}
        onSaved={() => {
          setNewKeyOpen(false);
          load();
        }}
      />
      <KeyEditModal
        isOpen={editKeyOpen}
        onClose={() => {
          setEditKeyOpen(false);
          setEditingKey(null);
        }}
        editing={editingKey?.key ?? null}
        onSaved={() => {
          setEditKeyOpen(false);
          setEditingKey(null);
          load();
        }}
      />
      <TestRunModal
        isOpen={testOpen}
        onClose={() => {
          setTestOpen(false);
          setActiveKey(null);
        }}
        channelKey={activeKey}
        onCreated={(runId) => {
          setTestOpen(false);
          setActiveKey(null);
          // Don't navigate -- the user might want to kick another key in
          // parallel. We just refresh the list so the new run appears.
          load();
          toast.success("测试已开始", {
            description: "后台运行中，可继续测试其它 key",
          });
          void runId;
        }}
      />
      <KeyInfoModal
        isOpen={infoOpen}
        onClose={() => {
          setInfoOpen(false);
          setInfoKeyId(null);
        }}
        keyId={infoKeyId}
      />
      <VeridropModal
        isOpen={veridropDlgOpen}
        onClose={() => setVeridropDlgOpen(false)}
        channelKey={veridropKey}
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
  onInfo,
  onCancel,
  onVeridrop,
}: {
  channelId: number;
  data: ChannelKey;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onInfo: () => void;
  onCancel: () => void;
  onVeridrop: () => void;
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
      <div
        className="min-w-0 flex-1 cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={onInfo}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onInfo();
          }
        }}
        title="点击查看 URL / Key 并复制"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm hover:text-primary transition-colors">
            {data.name}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {data.apiKeyMasked}
          </span>
        </div>
        {data.notes && (
          <div className="text-[11px] text-muted-foreground mt-0.5 break-all">
            {data.notes}
          </div>
        )}
        {lr ? (
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <RunStatusBadge run={lr} />
            <VerdictBadge run={lr} />
            <PassRatePill run={lr} />
            <span className="text-[11px] text-muted-foreground">
              {fmtDate(lr.startedAt ?? lr.createdAt)} · n={lr.n} · {lr.model}
            </span>
            {running && (
              <div className="w-32 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    lr.failedCount > 0 ? "bg-amber-500" : "bg-primary",
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground mt-1">尚未测试</div>
        )}
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <Button
          size="sm"
          variant="secondary"
          onClick={onTest}
          disabled={running}
        >
          <PlayCircle size={14} />
          {running ? "测试中" : lr ? "再测一次" : "测试"}
        </Button>
        {running && (
          <Button
            size="sm"
            variant="secondary"
            className="text-amber-600 dark:text-amber-400"
            onClick={onCancel}
            title="强行终止: 立即把状态改成「取消」, in-flight 的任务自然结束不再 queue 新任务"
          >
            终止
          </Button>
        )}
        {lr && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/bench/${lr.id}`}>
              <Eye size={14} />
              详情
            </Link>
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={onVeridrop}
          title="veridrop 真伪 / 协议合规检测 (~70s)"
        >
          veridrop
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onInfo}
          title="查看 URL / Key"
        >
          <KeyRound size={14} />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onEdit} title="编辑">
          <Pencil size={14} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          title="删除"
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

function RunStatusBadge({ run }: { run: RunSummary }) {
  const map: Record<
    string,
    { variant: "default" | "secondary" | "success" | "warning" | "destructive"; label: string }
  > = {
    queued: { variant: "secondary", label: "排队中" },
    running: { variant: "default", label: "运行中" },
    done: { variant: "success", label: "完成" },
    error: { variant: "destructive", label: "错误" },
    canceled: { variant: "warning", label: "取消" },
  };
  const m = map[run.status] ?? { variant: "secondary" as const, label: run.status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function VerdictBadge({ run }: { run: RunSummary }) {
  if (run.probeStatus === "pending") {
    return <Badge variant="secondary">探针待跑</Badge>;
  }
  if (run.probeStatus === "running") {
    return <Badge variant="default">探针中</Badge>;
  }
  if (run.probeStatus === "error") {
    return <Badge variant="destructive">探针失败</Badge>;
  }
  const v = run.probeVerdict;
  if (v === "real") return <Badge variant="success">真直连</Badge>;
  if (v === "suspicious") return <Badge variant="warning">疑似伪装</Badge>;
  if (v === "fake") return <Badge variant="destructive">明确伪装</Badge>;
  return null;
}

function PassRatePill({ run }: { run: RunSummary }) {
  if (run.mustHavePassRate == null) {
    return <span className="text-xs text-muted-foreground">智商待测</span>;
  }
  const pct = run.mustHavePassRate * 100;
  const eligibleForBaseline = run.n === 30 && run.model === "claude-opus-4-7";
  const delta = pct - OFFICIAL_PASS_RATE * 100;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-semibold tabular-nums">{pct.toFixed(2)}%</span>
      {eligibleForBaseline && (
        <Badge
          variant={Math.abs(delta) <= 10 ? "secondary" : delta > 0 ? "success" : "warning"}
          className="h-5 text-[10px] px-1.5"
        >
          {(delta >= 0 ? "+" : "") + delta.toFixed(1)} pp
        </Badge>
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
      toast.warning("名称和 Base URL 必填");
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
        toast.error(editing ? "保存失败" : "创建失败", {
          description: j.error,
        });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑「${editing.name}」` : "新建渠道分组"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>名称</Label>
            <Input
              placeholder="如 v6-relay"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Base URL</Label>
            <Input
              placeholder="http://host:port"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Anthropic 原生协议入口；下面会自动拼 /v1/messages</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>备注</Label>
            <Textarea
              placeholder="可选：联系方式、续费时间、上游来源等"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      toast.warning("名称和 API Key 必填");
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
        toast.error("创建失败", { description: j.error });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加 key</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>key 名称</Label>
            <Input
              placeholder="如 v4-vip / 月卡 #2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>备注</Label>
            <Textarea
              placeholder="可选"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      toast.warning("名称必填");
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
        toast.error("保存失败", { description: j.error });
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑 key{editing ? ` · ${editing.name}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>key 名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>新 API Key（留空则不修改）</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>备注</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [mode, setMode] = useState("30");
  const [effort, setEffort] = useState("high");
  const [concurrency, setConcurrency] = useState(10);
  const [runTruncProbe, setRunTruncProbe] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModel("claude-opus-4-7");
    setMode("30");
    setEffort("high");
    setConcurrency(10);
    setRunTruncProbe(false);
  }, [isOpen]);

  async function submit() {
    if (!channelKey) return;
    if (!model.trim()) {
      toast.warning("请填写模型 ID");
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
          n: Number(mode),
          seed: 42,
          effort: effort,
          judgeEffort: effort,
          concurrency,
          runTruncProbe,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error("启动失败", {
          description: d.error ?? "",
        });
        return;
      }
      onCreated(d.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            测试 key{channelKey ? ` · ${channelKey.name}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>模型 ID</Label>
            <Input
              list="model-presets"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-7"
            />
            <datalist id="model-presets">
              {MODEL_PRESETS.map((p) => (
                <option key={p.key} value={p.key} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">可下拉选也可自由输入</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>测试规模</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label>思考强度</Label>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="max">max</SelectItem>
                  <SelectItem value="xhigh">xhigh</SelectItem>
                  <SelectItem value="high">high（推荐）</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="none">不开思考</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 w-32">
              <Label>并发</Label>
              <Input
                type="number"
                value={String(concurrency)}
                onChange={(e) =>
                  setConcurrency(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                }
              />
              <p className="text-xs text-muted-foreground">推荐 10</p>
            </div>
          </div>
          {mode !== "30" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              官方基线只锁定了 n=30 模式。其它模式只能跨自有 key 横比。
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="trunc-probe"
              checked={runTruncProbe}
              onCheckedChange={(v) => setRunTruncProbe(v === true)}
              disabled={effort === "none"}
            />
            <div className="grid gap-0.5 leading-none">
              <label htmlFor="trunc-probe" className="text-sm cursor-pointer">
                同时测长文本思考截断
              </label>
              <p className="text-[11px] text-muted-foreground">
                额外发送一道高思考量大题（max_tokens=64K），约 1-3 分钟。需要开启思考。
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={submitting} onClick={submit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            开始测试
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// Key info modal -- full URL + apiKey with one-click copy. Used by
// the per-key click target on the channel list. Reads the unmasked
// key from /api/bench/keys/[id] (auth-protected by middleware).
// =================================================================
interface FullKeyInfo {
  id: number;
  name: string;
  apiKey: string;
  notes: string | null;
  channel: { id: number; name: string; baseUrl: string };
}

function KeyInfoModal({
  isOpen,
  onClose,
  keyId,
}: {
  isOpen: boolean;
  onClose: () => void;
  keyId: number | null;
}) {
  const [data, setData] = useState<FullKeyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealKey, setRevealKey] = useState(false);

  useEffect(() => {
    if (!isOpen || keyId == null) return;
    setData(null);
    setRevealKey(false);
    setLoading(true);
    fetch(`/api/bench/keys/${keyId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.item) setData(j.item as FullKeyInfo);
      })
      .finally(() => setLoading(false));
  }, [isOpen, keyId]);

  async function copy(text: string, label: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      toast.success(`${label} 已复制`);
    } else {
      toast.error(`${label} 复制失败`);
    }
  }

  const masked = data
    ? data.apiKey.length > 8
      ? `${data.apiKey.slice(0, 4)}…${data.apiKey.slice(-4)}`
      : "*".repeat(data.apiKey.length)
    : "";

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} />
            <span>渠道信息</span>
            {data && (
              <Badge variant="secondary">
                {data.channel.name} / {data.name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {loading || !data ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 size={12} />
                  <span>站点 URL</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-sm flex-1 break-all">
                    {data.channel.baseUrl}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    onClick={() =>
                      copy(data.channel.baseUrl, "URL")
                    }
                    title="复制"
                  >
                    <Copy size={14} />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <KeyRound size={12} />
                    <span>API Key</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRevealKey((v) => !v)}
                    className="h-6 min-w-0 px-2"
                  >
                    {revealKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    {revealKey ? "隐藏" : "显示"}
                  </Button>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-sm flex-1 break-all">
                    {revealKey ? data.apiKey : masked}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    onClick={() => copy(data.apiKey, "API Key")}
                    title="复制完整 key"
                  >
                    <Copy size={14} />
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    copy(
                      `${data.channel.baseUrl}\n${data.apiKey}`,
                      "URL + Key",
                    )
                  }
                >
                  <Copy size={14} />
                  一起复制（两行）
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    copy(
                      `RELAY_BASE=${data.channel.baseUrl}\nRELAY_KEY=${data.apiKey}`,
                      "环境变量",
                    )
                  }
                >
                  复制为环境变量
                </Button>
              </div>

              {data.notes && (
                <div className="text-xs text-muted-foreground break-all border-l-2 border-border pl-2">
                  备注：{data.notes}
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
