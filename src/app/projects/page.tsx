"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Briefcase,
  HandshakeIcon,
} from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type ProjectType = "customer" | "upstream";
type ProjectStatus = "discussing" | "pending_test" | "tested";

interface Project {
  id: number;
  type: ProjectType;
  partnerName: string;
  status: ProjectStatus;
  goal: string;
  siteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseGoals(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function GoalList({ goal }: { goal: string }) {
  const items = parseGoals(goal);
  if (items.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ol className="flex flex-col gap-1.5 max-w-[420px]">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold tabular-nums leading-none">
            {i + 1}
          </span>
          <span className="break-words leading-5">{t}</span>
        </li>
      ))}
    </ol>
  );
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  discussing: "商议中",
  pending_test: "已敲定待测试",
  tested: "已测试",
};

const STATUS_BADGE_VARIANT: Record<ProjectStatus, "secondary" | "warning" | "success"> = {
  discussing: "secondary",
  pending_test: "warning",
  tested: "success",
};

const STATUS_ORDER: ProjectStatus[] = ["discussing", "pending_test", "tested"];

const TYPE_LABEL: Record<ProjectType, string> = {
  customer: "企业合作",
  upstream: "渠道商合作",
};

function hostOf(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.host;
  } catch {
    return url;
  }
}

function normalizedHref(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export default function ProjectsPage() {
  const [tab, setTab] = useState<string>("customer");
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      const j = await r.json();
      setItems((j.items || []) as Project[]);
    } catch (e) {
      toast.error("加载失败", { description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => items.filter((it) => it.type === tab),
    [items, tab],
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(it: Project) {
    setEditing(it);
    setDialogOpen(true);
  }

  async function changeStatus(id: number, status: ProjectStatus) {
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      await load();
    } catch (e) {
      toast.error("更新失败", { description: String(e) });
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`删除「${name}」? 此操作不可恢复`)) return;
    try {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      toast.success("已删除");
      await load();
    } catch (e) {
      toast.error("删除失败", { description: String(e) });
    }
  }

  return (
    <Shell>
      <TopBar
        title="项目跟踪"
        subtitle="手工维护合作进度。企业 = 客户跑我们 API；渠道商 = 我们跑对方 API"
        actions={
          <Button
            className="rounded-full"
            onClick={openCreate}
          >
            <Plus size={14} />
            新增
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="customer">
            <span className="flex items-center gap-1.5">
              <Briefcase size={14} />
              企业合作
            </span>
          </TabsTrigger>
          <TabsTrigger value="upstream">
            <span className="flex items-center gap-1.5">
              <HandshakeIcon size={14} />
              渠道商合作
            </span>
          </TabsTrigger>
        </TabsList>

        <Card>
          <CardHeader className="flex flex-row justify-between items-center pb-2">
            <div>
              <h2 className="font-semibold">{TYPE_LABEL[tab as ProjectType]}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">共 {filtered.length} 个</p>
            </div>
          </CardHeader>
          <CardContent>
            {loading && items.length === 0 ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">
                暂无{TYPE_LABEL[tab as ProjectType]}记录。点右上角「新增」开始
              </p>
            ) : (
              <ProjectsTable
                tab={tab as ProjectType}
                rows={filtered}
                onEdit={openEdit}
                onDelete={remove}
                onChangeStatus={changeStatus}
              />
            )}
          </CardContent>
        </Card>
      </Tabs>

      <ProjectModal
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        defaultType={tab as ProjectType}
        initial={editing}
        onSaved={() => { load(); setDialogOpen(false); }}
      />
    </Shell>
  );
}

function StatusChip({
  status,
  onChange,
}: {
  status: ProjectStatus;
  onChange: (s: ProjectStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant={STATUS_BADGE_VARIANT[status]}
          className="cursor-pointer"
        >
          {STATUS_LABEL[status]}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onChange(s)}>
            {STATUS_LABEL[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="edit"
        onClick={onEdit}
      >
        <Pencil size={14} />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-destructive"
        aria-label="delete"
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

function ProjectsTable({
  tab,
  rows,
  onEdit,
  onDelete,
  onChangeStatus,
}: {
  tab: ProjectType;
  rows: Project[];
  onEdit: (it: Project) => void;
  onDelete: (id: number, name: string) => void;
  onChangeStatus: (id: number, s: ProjectStatus) => void;
}) {
  if (tab === "upstream") {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>合作方</TableHead>
            <TableHead>站点</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>本次商谈目标</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((it) => (
            <TableRow key={it.id} className="align-top">
              <TableCell>
                <span className="font-medium">{it.partnerName}</span>
              </TableCell>
              <TableCell>
                {it.siteUrl ? (
                  <a
                    href={normalizedHref(it.siteUrl)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                    title={it.siteUrl}
                  >
                    <span className="truncate max-w-[200px]">
                      {hostOf(it.siteUrl)}
                    </span>
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell>
                <StatusChip
                  status={it.status}
                  onChange={(s) => onChangeStatus(it.id, s)}
                />
              </TableCell>
              <TableCell>
                <GoalList goal={it.goal} />
              </TableCell>
              <TableCell className="text-right">
                <RowActions
                  onEdit={() => onEdit(it)}
                  onDelete={() => onDelete(it.id, it.partnerName)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>合作方</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>本次商谈目标</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((it) => (
          <TableRow key={it.id} className="align-top">
            <TableCell>
              <span className="font-medium">{it.partnerName}</span>
            </TableCell>
            <TableCell>
              <StatusChip
                status={it.status}
                onChange={(s) => onChangeStatus(it.id, s)}
              />
            </TableCell>
            <TableCell>
              <GoalList goal={it.goal} />
            </TableCell>
            <TableCell className="text-right">
              <RowActions
                onEdit={() => onEdit(it)}
                onDelete={() => onDelete(it.id, it.partnerName)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProjectModal({
  isOpen,
  onClose,
  defaultType,
  initial,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultType: ProjectType;
  initial: Project | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState<string>(defaultType);
  const [partnerName, setPartnerName] = useState("");
  const [status, setStatus] = useState<string>("discussing");
  const [goal, setGoal] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initial) {
      setType(initial.type);
      setPartnerName(initial.partnerName);
      setStatus(initial.status);
      setGoal(initial.goal);
      setSiteUrl(initial.siteUrl ?? "");
    } else {
      setType(defaultType);
      setPartnerName("");
      setStatus("discussing");
      setGoal("");
      setSiteUrl("");
    }
  }, [isOpen, initial, defaultType]);

  async function save() {
    if (!partnerName.trim()) {
      toast.warning("请填写合作方名称");
      return;
    }
    setSaving(true);
    try {
      const url = initial ? `/api/projects/${initial.id}` : "/api/projects";
      const method = initial ? "PATCH" : "POST";
      const payload = initial
        ? { partnerName, status, goal, siteUrl }
        : { type, partnerName, status, goal, siteUrl };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      toast.success(initial ? "已更新" : "已创建");
      onSaved();
    } catch (e) {
      toast.error("保存失败", { description: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? `编辑 · ${initial.partnerName}` : "新增项目"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!initial && (
            <Tabs value={type} onValueChange={setType}>
              <TabsList>
                <TabsTrigger value="customer">企业合作（客户跑我们 API）</TabsTrigger>
                <TabsTrigger value="upstream">渠道商合作（我们跑对方 API）</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="space-y-2">
            <Label>合作方名称 *</Label>
            <Input
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
            />
          </div>
          {type === "upstream" && (
            <div className="space-y-2">
              <Label>站点 URL</Label>
              <Input
                placeholder="https://example.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">表内会显示域名 + 跳转图标</p>
            </div>
          )}
          <div className="space-y-2">
            <Label>状态</Label>
            <Tabs value={status} onValueChange={setStatus}>
              <TabsList>
                {STATUS_ORDER.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            <Label>本次商谈目标</Label>
            <Textarea
              placeholder={"接入 Claude 代理\n月跑量 ≥ 1k\n联调对账接口"}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">每行一条，会自动渲染成 1 / 2 / 3 编号列表</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
