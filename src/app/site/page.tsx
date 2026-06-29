"use client";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Loader2,
  Pencil,
  StickyNote,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { fmtDate, fmtMoneyShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SiteAccount {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  email: string;
  apiKey: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  hidden: boolean;
  _count?: { accounts: number };
}

interface BoundAccount {
  id: number;
  remoteAccountId: number;
  name: string;
  rateMultiplier: number;
  rateMultiplierOverride: number | null;
  groupSummary: string | null;
  todayRequests: number;
  todayTokens: string;
  todayCost: number;
  todayStandardCost: number;
  todayUserCost: number;
  bindings?: { id: number; upstreamKey: { name: string } }[];
}

interface SiteUserRow {
  id: number;
  remoteUserId: number;
  email: string;
  username: string;
  role: string;
  status: string;
  balance: number;
  totalRecharged: number;
  todayCost: number;
  todayActualCost: number;
  todayStatsAt: string | null;
  rateMultiplierOverride: number | null;
  alias: string | null;
  notes: string | null;
  lastUsedAt: string | null;
  settledTotal: number;
  settlementCount: number;
}

interface Settlement {
  id: number;
  siteUserId: number;
  amount: number;
  paidAt: string;
  notes: string | null;
}

export default function SitePage() {
  const [accounts, setAccounts] = useState<SiteAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [busyRefresh, setBusyRefresh] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [bound, setBound] = useState<Record<number, BoundAccount[]>>({});
  const [users, setUsers] = useState<Record<number, SiteUserRow[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showZeroUsers, setShowZeroUsers] = useState(false);

  const [newDlgOpen, setNewDlgOpen] = useState(false);
  const [editDlgOpen, setEditDlgOpen] = useState(false);
  const [editing, setEditing] = useState<SiteAccount | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "sub2api",
    baseUrl: "",
    email: "",
    password: "",
    apiKey: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/site?hidden=${showHidden ? "1" : "0"}`, { cache: "no-store" });
      const j = await res.json();
      setAccounts(j.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadBound(id: number) {
    const res = await fetch(`/api/site/${id}/accounts`, { cache: "no-store" });
    const j = await res.json();
    setBound((prev) => ({ ...prev, [id]: j.items || [] }));
  }

  async function loadUsers(id: number) {
    const res = await fetch(`/api/site/${id}/users`, { cache: "no-store" });
    const j = await res.json();
    setUsers((prev) => ({ ...prev, [id]: j.items || [] }));
  }

  async function syncOne(id: number) {
    setBusy(id);
    try {
      const res = await fetch(`/api/site/${id}/sync`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error("同步失败", { description: j.error });
      } else {
        toast.success("用量已更新");
        await load();
        if (expanded === id) {
          await loadBound(id);
          await loadUsers(id);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function refreshOne(id: number) {
    setBusyRefresh(id);
    try {
      const res = await fetch(`/api/site/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error("刷新失败", { description: j.error });
      } else {
        toast.success("结构已刷新");
        await load();
        if (expanded === id) {
          await loadBound(id);
          await loadUsers(id);
        }
      }
    } finally {
      setBusyRefresh(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除该本站账号？相关的 accounts 和绑定也会删除。")) return;
    const res = await fetch(`/api/site/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error("删除失败", { description: j.error });
      return;
    }
    toast.success("已删除");
    await load();
  }

  async function toggleHidden(id: number, hidden: boolean) {
    await fetch(`/api/site/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    toast.success(hidden ? "已隐藏" : "已显示");
    await load();
  }

  function openNew() {
    setForm({
      name: "",
      type: "sub2api",
      baseUrl: "",
      email: "",
      password: "",
      apiKey: "",
    });
    setNewDlgOpen(true);
  }
  function openEdit(a: SiteAccount) {
    setEditing(a);
    setForm({
      name: a.name,
      type: a.type,
      baseUrl: a.baseUrl,
      email: a.email,
      password: "",
      apiKey: a.apiKey ?? "",
    });
    setEditDlgOpen(true);
  }

  async function submitNew() {
    if (!form.name || !form.baseUrl) {
      toast.warning("名称和 Base URL 必填");
      return;
    }
    if (!form.apiKey && (!form.email || !form.password)) {
      toast.warning("请填写 apiKey，或填写 email + password");
      return;
    }
    const res = await fetch("/api/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error("创建失败", { description: j.error });
      return;
    }
    setNewDlgOpen(false);
    toast.success("已创建");
    await load();
  }

  async function submitEdit() {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      name: form.name,
      baseUrl: form.baseUrl,
      email: form.email,
      apiKey: form.apiKey || null,
    };
    if (form.password) payload.password = form.password;
    const res = await fetch(`/api/site/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error("保存失败", { description: j.error });
      return;
    }
    setEditDlgOpen(false);
    toast.success("已保存");
    await load();
  }

  async function toggleExpand(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!bound[id]) await loadBound(id);
    if (!users[id]) await loadUsers(id);
  }

  useEffect(() => {
    load();
  }, [showHidden]);

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">本站账号（管理员）</h1>
          <p className="text-sm text-muted-foreground">
            收入侧：拉取 admin/accounts 和 today-stats
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "查看启用" : "查看已隐藏"}
          </Button>
          <Button onClick={openNew}>
            + 新建
          </Button>
        </div>
      </div>

      {loading && !accounts.length ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground">暂无本站账号</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-stop-toggle]"))
                    return;
                  toggleExpand(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpand(a.id);
                  }
                }}
                className="flex justify-between flex-wrap gap-2 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <ChevronRight
                    size={16}
                    className={`mt-1 text-muted-foreground transition-transform ${expanded === a.id ? "rotate-90" : ""}`}
                  />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{a.name}</h3>
                      <Badge variant="secondary">
                        {a.type}
                      </Badge>
                      <Badge variant="outline">
                        {a._count?.accounts ?? 0} accounts
                      </Badge>
                      {a.lastSyncError && (
                        <Badge variant="destructive">
                          同步失败
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.email} @ {a.baseUrl} · 最后同步:{" "}
                      {fmtDate(a.lastSyncAt)}
                    </p>
                    {a.lastSyncError && (
                      <p className="text-xs text-destructive mt-1 break-all">
                        {a.lastSyncError}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap" data-stop-toggle>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => syncOne(a.id)}
                    disabled={busy === a.id}
                  >
                    {busy === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    同步用量
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => refreshOne(a.id)}
                    disabled={busyRefresh === a.id}
                  >
                    {busyRefresh === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    结构刷新
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggleHidden(a.id, !a.hidden)}
                  >
                    {a.hidden ? "显示" : "隐藏"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => remove(a.id)}
                  >
                    删除
                  </Button>
                </div>
              </CardHeader>
              {expanded === a.id && (
                <CardContent>
                  <UsersSection
                    siteAccountId={a.id}
                    rows={users[a.id]}
                    showZero={showZeroUsers}
                    onToggleShowZero={setShowZeroUsers}
                    onChanged={() => loadUsers(a.id)}
                  />

                  <div className="mt-6 pt-4 border-t border-border/40">
                    <h4 className="font-semibold mb-1">上游账号 / 分组</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      本站这边对接到上游的 admin/account 列表（按今日消费降序）
                    </p>
                  </div>
                  {!bound[a.id] ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : bound[a.id].length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      暂无 accounts。点同步先拉一次。
                    </p>
                  ) : (() => {
                    const base = showZero
                      ? bound[a.id]
                      : bound[a.id].filter((acc) => acc.todayCost > 0);
                    const filtered = [...base].sort(
                      (x, y) => y.todayCost - x.todayCost,
                    );
                    const hiddenCount = bound[a.id].length - filtered.length;
                    return (
                      <>
                        <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={showZero}
                              onCheckedChange={(v) => setShowZero(!!v)}
                            />
                            <span className="text-xs">显示今日 0 消费的 account</span>
                          </label>
                          {!showZero && hiddenCount > 0 && (
                            <span>已隐藏 {hiddenCount} 个 0 消费 account</span>
                          )}
                        </div>
                        {filtered.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            没有今日有消费的 account。勾选上方可显示全部。
                          </p>
                        ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>名称</TableHead>
                          <TableHead>分组×倍率</TableHead>
                          <TableHead>请求</TableHead>
                          <TableHead>实际收入</TableHead>
                          <TableHead>倍率覆盖</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((acc) => {
                          const effectiveUC =
                            acc.rateMultiplierOverride != null
                              ? acc.todayCost * acc.rateMultiplierOverride
                              : acc.todayUserCost;
                          const syncedRate =
                            acc.todayCost > 0
                              ? acc.todayUserCost / acc.todayCost
                              : acc.rateMultiplier;
                          const bindNames = (acc.bindings || [])
                            .map((b) => b.upstreamKey.name)
                            .join(", ");
                          return (
                            <TableRow key={acc.id}>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="text-sm font-medium">
                                    {acc.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {bindNames
                                      ? `→ ${bindNames}`
                                      : "未绑定上游"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <GroupCell
                                  groups={parseGroupsList(acc.groupSummary)}
                                  syncedRate={syncedRate}
                                />
                              </TableCell>
                              <TableCell>{acc.todayRequests}</TableCell>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="font-medium">
                                    {fmtMoneyShort(effectiveUC)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    1× {fmtMoneyShort(acc.todayCost)}
                                    {acc.rateMultiplierOverride != null && (
                                      <span className="ml-1 line-through">
                                        {fmtMoneyShort(acc.todayUserCost)}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <RateOverrideEditor
                                  account={acc}
                                  onSaved={() => loadBound(a.id)}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={newDlgOpen} onOpenChange={setNewDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建本站账号</DialogTitle>
            <DialogDescription className="sr-only">创建新的本站账号</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input
                placeholder="名称"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sub2api">sub2api</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                placeholder="http://your-site:8080"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin API Key（推荐）</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">填写后请求走 x-api-key，免登录；email/password 仅作记录。也可只填 email/password 走登录流程。</p>
            </div>
            <div className="space-y-1.5">
              <Label>Email（记录或登录）</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>密码（记录或登录）</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewDlgOpen(false)}>
              取消
            </Button>
            <Button onClick={submitNew}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDlgOpen} onOpenChange={setEditDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑本站账号</DialogTitle>
            <DialogDescription className="sr-only">编辑本站账号信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin API Key</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">留空则使用 email + password 登录</p>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>新密码（留空则不修改）</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditDlgOpen(false)}>
              取消
            </Button>
            <Button onClick={submitEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

interface GroupItem {
  id?: number;
  name: string;
  rate_multiplier: number;
}

function parseGroupsList(json: string | null): GroupItem[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as GroupItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function GroupCell({
  groups,
  syncedRate,
}: {
  groups: GroupItem[];
  syncedRate: number;
}) {
  if (groups.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const main = groups[0];
  const rest = groups.slice(1);
  // tooltip text shows full list (newline-separated; browser will collapse to spaces in title)
  const fullList = groups
    .map((g) => `${g.name} ×${g.rate_multiplier}`)
    .join("  /  ");
  return (
    <div
      className="flex flex-col leading-tight"
      title={fullList}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{main.name}</span>
        <span className="text-muted-foreground">×{main.rate_multiplier}</span>
        {rest.length > 0 && (
          <Badge variant="secondary" className="h-4 text-[10px] px-1 py-0">
            +{rest.length}
          </Badge>
        )}
      </div>
      <span className="text-muted-foreground">
        实际 ×{syncedRate.toFixed(2)}
      </span>
    </div>
  );
}

function RateOverrideEditor({
  account,
  onSaved,
}: {
  account: BoundAccount;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(
    account.rateMultiplierOverride != null
      ? String(account.rateMultiplierOverride)
      : "",
  );
  const [saving, setSaving] = useState(false);

  async function save(clear = false) {
    setSaving(true);
    try {
      const body = clear
        ? { rateMultiplierOverride: null }
        : {
            rateMultiplierOverride: val === "" ? null : Number(val),
          };
      const r = await fetch(`/api/site-bound-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success(clear ? "已清除" : "已保存");
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        {account.rateMultiplierOverride != null ? (
          <Badge variant="default">
            ×{account.rateMultiplierOverride}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            setVal(
              account.rateMultiplierOverride != null
                ? String(account.rateMultiplierOverride)
                : "",
            );
            setEditing(true);
          }}
          aria-label="edit rate"
        >
          <Pencil size={13} />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="例 1.7"
        className="w-24 h-8 text-xs"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={saving}
        onClick={() => save(false)}
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        保存
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => save(true)}
        disabled={saving}
      >
        清除
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditing(false)}
        disabled={saving}
      >
        取消
      </Button>
    </div>
  );
}

function UsersSection({
  rows,
  showZero,
  onToggleShowZero,
  onChanged,
}: {
  siteAccountId: number;
  rows: SiteUserRow[] | undefined;
  showZero: boolean;
  onToggleShowZero: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  if (!rows) {
    return (
      <div>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  const enriched = rows.map((u) => {
    const consumed = Math.max(0, u.totalRecharged - u.balance);
    const eff = u.rateMultiplierOverride ?? 1;
    const effectiveConsumed = consumed * eff;
    const owed = effectiveConsumed - u.settledTotal;
    return {
      ...u,
      consumed,
      effectiveConsumed,
      effectiveRate: eff,
      owed,
    };
  });
  const q = search.trim().toLowerCase();
  const afterShowZero = showZero
    ? enriched
    : enriched.filter((u) => u.totalRecharged > 0 || u.balance > 0);
  const base = q
    ? afterShowZero.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.alias ?? "").toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q),
      )
    : afterShowZero;
  // Sort: users with outstanding debt at the top (they need attention),
  // settled users (owed ≈ 0 or overpaid) at the bottom. Within each
  // group, sort by total spend desc so the biggest customer is first.
  const filtered = [...base].sort((a, b) => {
    const aDebt = a.owed > 0.01;
    const bDebt = b.owed > 0.01;
    if (aDebt !== bDebt) return aDebt ? -1 : 1;
    if (aDebt && bDebt) return b.owed - a.owed;
    return b.effectiveConsumed - a.effectiveConsumed;
  });
  const hiddenZero = afterShowZero.length < enriched.length
    ? enriched.length - afterShowZero.length
    : 0;

  // Aggregate metrics across the post-showZero list (summary should reflect
  // visible-or-could-be-visible users, not the further search-filtered subset).
  const totalEffective = afterShowZero.reduce(
    (s, u) => s + u.effectiveConsumed,
    0,
  );
  const totalSettled = afterShowZero.reduce(
    (s, u) => s + u.settledTotal,
    0,
  );
  const debtors = afterShowZero.filter((u) => u.owed > 0.01);
  const totalOwed = debtors.reduce((s, u) => s + u.owed, 0);
  const overpayers = afterShowZero.filter((u) => u.owed < -0.01);
  const totalOverpaid = overpayers.reduce((s, u) => s + Math.abs(u.owed), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-card border border-border p-3">
          <p className="text-xs text-muted-foreground">总实际计费</p>
          <p className="text-lg font-bold mt-1">
            {fmtMoneyShort(totalEffective)}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {afterShowZero.length} 个用户
          </p>
        </div>
        <div className="rounded-lg bg-card border border-border p-3">
          <p className="text-xs text-muted-foreground">总已结款</p>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {fmtMoneyShort(totalSettled)}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            占比{" "}
            {totalEffective > 0
              ? ((totalSettled / totalEffective) * 100).toFixed(1)
              : "0"}
            %
          </p>
        </div>
        <div className="rounded-lg bg-destructive/10 p-3 border border-destructive/20">
          <p className="text-xs text-destructive/80">总欠款</p>
          <p className="text-lg font-bold text-destructive mt-1">
            {fmtMoneyShort(totalOwed)}
          </p>
          <p className="text-xs text-destructive/60 mt-0.5">
            {debtors.length} 个客户欠款
          </p>
        </div>
        <div className="rounded-lg bg-card border border-border p-3">
          <p className="text-xs text-muted-foreground">多付/预存</p>
          <p
            className={`text-lg font-bold mt-1 ${overpayers.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            {fmtMoneyShort(totalOverpaid)}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {overpayers.length} 个用户
          </p>
        </div>
      </div>

      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h4 className="font-semibold">用户</h4>
          <p className="text-xs text-muted-foreground">
            总消费 = 总充值 − 当前余额（× 你设定的倍率）
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Input
            placeholder="按邮箱 / 别名 / username 搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 h-8 text-xs"
          />
          {!showZero && hiddenZero > 0 && (
            <span>已隐藏 {hiddenZero} 个 0 消费用户</span>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={showZero}
              onCheckedChange={(v) => onToggleShowZero(!!v)}
            />
            <span className="text-xs">显示无充值的用户</span>
          </label>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {q
            ? `没有匹配 "${search}" 的用户`
            : "没有有充值的用户。勾选上方可显示全部。"}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>备注</TableHead>
              <TableHead>今日消费</TableHead>
              <TableHead>累计实际计费</TableHead>
              <TableHead>已结款</TableHead>
              <TableHead>欠款</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => {
              const inactive = u.status !== "active";
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">
                          {u.alias || u.username || u.email}
                        </span>
                        {u.alias && (
                          <Badge
                            variant="secondary"
                            className="h-4 text-[10px] px-1 py-0"
                          >
                            别名
                          </Badge>
                        )}
                        {inactive && (
                          <Badge
                            variant="outline"
                            className="h-4 text-[10px] px-1 py-0"
                          >
                            {u.status}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {u.email} · 余额 {fmtMoneyShort(u.balance)} · 总充{" "}
                        {fmtMoneyShort(u.totalRecharged)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.notes ? (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 max-w-[180px] text-xs text-muted-foreground cursor-help">
                              <StickyNote
                                size={12}
                                className="shrink-0 text-muted-foreground"
                              />
                              <span className="truncate">{u.notes}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <div className="max-w-md whitespace-pre-wrap break-words p-1 text-xs">
                              {u.notes}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span
                        className={
                          u.todayActualCost > 0
                            ? "font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {fmtMoneyShort(u.todayActualCost)}
                      </span>
                      {u.todayCost > 0 && (
                        <span className="text-xs text-muted-foreground">
                          1× {fmtMoneyShort(u.todayCost)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium">
                        {fmtMoneyShort(u.effectiveConsumed)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {u.rateMultiplierOverride != null &&
                        u.rateMultiplierOverride !== 1 ? (
                          <>
                            <span className="text-primary">
                              ×{u.rateMultiplierOverride}
                            </span>{" "}
                            <span className="line-through">
                              {fmtMoneyShort(u.consumed)}
                            </span>
                          </>
                        ) : (
                          <>×1.00</>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {fmtMoneyShort(u.settledTotal)}
                      </span>
                      {u.settlementCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {u.settlementCount} 笔
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        u.owed > 0.01
                          ? "text-destructive font-semibold text-lg"
                          : u.owed < -0.01
                            ? "text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-muted-foreground"
                      }
                    >
                      {fmtMoneyShort(u.owed)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <UserRateEditor user={u} onSaved={onChanged} />
                      <SettlementButton user={u} onChanged={onChanged} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function UserRateEditor({
  user,
  onSaved,
}: {
  user: SiteUserRow;
  onSaved: () => void;
}) {
  const [dlgOpen, setDlgOpen] = useState(false);
  const [alias, setAlias] = useState(user.alias ?? "");
  const [rate, setRate] = useState(
    user.rateMultiplierOverride != null
      ? String(user.rateMultiplierOverride)
      : "",
  );
  const [notes, setNotes] = useState(user.notes ?? "");
  const [saving, setSaving] = useState(false);

  function open() {
    setAlias(user.alias ?? "");
    setRate(
      user.rateMultiplierOverride != null
        ? String(user.rateMultiplierOverride)
        : "",
    );
    setNotes(user.notes ?? "");
    setDlgOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/site-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: alias.trim() || null,
          rateMultiplierOverride:
            rate.trim() === "" ? null : Number(rate),
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success("已保存");
      setDlgOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={open}
      >
        <Pencil size={13} />
        编辑
      </Button>
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>
              {user.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>别名</Label>
              <Input
                placeholder="例 大客户A"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">留空则显示同步过来的 username / email</p>
            </div>
            <div className="space-y-1.5">
              <Label>结算倍率覆盖</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="例 0.8"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">留空 = ×1.00（按原价）</p>
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea
                placeholder="任何想记的：联系方式、对接情况、合同号…"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDlgOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettlementButton({
  user,
  onChanged,
}: {
  user: SiteUserRow & {
    consumed: number;
    effectiveConsumed: number;
    owed: number;
  };
  onChanged: () => void;
}) {
  const [dlgOpen, setDlgOpen] = useState(false);
  const [list, setList] = useState<Settlement[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadSettlements() {
    setLoading(true);
    try {
      const r = await fetch(`/api/site-users/${user.id}/settlements`, {
        cache: "no-store",
      });
      const j = await r.json();
      setList(j.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function openDlg() {
    setDlgOpen(true);
    await loadSettlements();
  }

  async function add() {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      toast.warning("金额必须大于 0");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/site-users/${user.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: a,
          paidAt: new Date(paidAt).toISOString(),
          notes: notes || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("添加失败", { description: j.error });
        return;
      }
      toast.success("已添加");
      setAmount("");
      setNotes("");
      await loadSettlements();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除该笔结款？")) return;
    const r = await fetch(`/api/settlements/${id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("删除失败");
      return;
    }
    await loadSettlements();
    onChanged();
  }

  async function settleAll() {
    const owed = user.owed;
    if (owed <= 0.01) {
      toast("当前没有欠款");
      return;
    }
    if (!confirm(`确认一次性结清 ${fmtMoneyShort(owed)}？`)) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/site-users/${user.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: owed,
          paidAt: new Date().toISOString(),
          notes: "一键结清",
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("结清失败", { description: j.error });
        return;
      }
      toast.success("已结清");
      await loadSettlements();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={openDlg}
      >
        <Wallet size={13} />
        结款
      </Button>
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{user.username || user.email} · 结款记录</DialogTitle>
            <DialogDescription>
              {user.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <div className="flex-1 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">实际计费</p>
                  <p className="font-semibold">
                    {fmtMoneyShort(user.effectiveConsumed)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">已结款</p>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {fmtMoneyShort(user.settledTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">欠款</p>
                  <p
                    className={
                      user.owed > 0.01
                        ? "font-semibold text-destructive"
                        : user.owed < -0.01
                          ? "font-semibold text-amber-600 dark:text-amber-400"
                          : "font-semibold"
                    }
                  >
                    {fmtMoneyShort(user.owed)}
                  </p>
                </div>
              </div>
              {user.owed > 0.01 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={settleAll}
                  disabled={saving}
                  className="text-emerald-600 dark:text-emerald-400"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  一键结清 {fmtMoneyShort(user.owed)}
                </Button>
              )}
            </div>

            <div className="border border-border/40 rounded-lg p-3">
              <p className="text-sm font-medium mb-2">登记一笔结款</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">金额</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="例 1000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">结款日期</Label>
                  <Input
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">备注（可空）</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={add}
                  disabled={saving}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  添加结款
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">历史记录</p>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : !list || list.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无结款记录</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">
                          {fmtDate(s.paidAt)}
                        </TableCell>
                        <TableCell className="text-emerald-600 dark:text-emerald-400 font-medium">
                          {fmtMoneyShort(s.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.notes || "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => remove(s.id)}
                          >
                            删除
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDlgOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
