"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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

interface SiteAccount {
  id: number;
  name: string;
}

interface ShareItem {
  id: number;
  shareId: string;
  siteAccountId: number;
  name: string;
  userIdsJson: string;
  groupIdsJson: string;
  createdAt: string;
  updatedAt: string;
  siteAccount: { id: number; name: string; baseUrl: string };
}

interface SiteUser {
  id: number;
  remoteUserId: number;
  email: string;
  username: string;
  alias: string | null;
}

interface GroupItem {
  id: number;
  name: string;
  rate_multiplier: number;
  platform: string;
}

export default function SiteSharesPage() {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [sites, setSites] = useState<SiteAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ShareItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/site-shares", { cache: "no-store" }),
        fetch("/api/site", { cache: "no-store" }),
      ]);
      const j1 = await r1.json();
      const j2 = await r2.json();
      setShares(j1.items || []);
      setSites((j2.items || []).map((s: SiteAccount) => ({ id: s.id, name: s.name })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(s: ShareItem) {
    if (!confirm(`删除分享 "${s.name || s.shareId}"？现有链接将立即失效。`)) return;
    const r = await fetch(`/api/site-shares/${s.id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("删除失败");
      return;
    }
    toast.success("已删除");
    await load();
  }

  function shareUrl(shareId: string): string {
    if (typeof window === "undefined") return `/share/${shareId}`;
    return `${window.location.origin}/share/${shareId}`;
  }

  async function copyUrl(shareId: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(shareId));
      toast.success("已复制链接");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">对外展示链接</h1>
          <p className="text-sm text-muted-foreground">
            生成免登录链接, 让客户实时看到指定站点的 RPM/TPM 与指定用户的并发/分组 RPM。
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          + 新建分享
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : shares.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6">
            还没有分享链接。点击右上角"新建分享"开始。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">分享列表</h3>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>站点</TableHead>
                  <TableHead>链接</TableHead>
                  <TableHead>允许范围</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((s) => {
                  const userCount = safeArr(s.userIdsJson).length;
                  const groupCount = safeArr(s.groupIdsJson).length;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>{s.name || "—"}</TableCell>
                      <TableCell>{s.siteAccount.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {s.shareId}
                          </code>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => copyUrl(s.shareId)}
                            aria-label="copy"
                          >
                            <Copy size={14} />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            asChild
                          >
                            <a
                              href={shareUrl(s.shareId)}
                              target="_blank"
                              aria-label="open"
                            >
                              <ExternalLink size={14} />
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 flex-wrap">
                          <Badge
                            variant={userCount === 0 ? "destructive" : "default"}
                          >
                            {userCount} 用户
                          </Badge>
                          <Badge
                            variant={groupCount === 0 ? "destructive" : "default"}
                          >
                            {groupCount} 分组
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(s.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(s);
                              setEditOpen(true);
                            }}
                          >
                            <Pencil size={13} />
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => remove(s)}
                          >
                            <Trash2 size={13} />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ShareEditModal
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        sites={sites}
        share={null}
        onSaved={async () => {
          setNewOpen(false);
          await load();
        }}
      />
      <ShareEditModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        sites={sites}
        share={editing}
        onSaved={async () => {
          setEditOpen(false);
          await load();
        }}
      />
    </Shell>
  );
}

function safeArr(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function ShareEditModal({
  isOpen,
  onClose,
  sites,
  share,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  sites: SiteAccount[];
  share: ShareItem | null;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());

  const [users, setUsers] = useState<SiteUser[] | null>(null);
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  const [userQuery, setUserQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setUserQuery("");
    setGroupQuery("");
    if (share) {
      setName(share.name || "");
      setSiteId(share.siteAccountId);
      setSelectedUserIds(new Set(safeArr(share.userIdsJson)));
      setSelectedGroupIds(new Set(safeArr(share.groupIdsJson)));
    } else {
      setName("");
      setSiteId(sites[0]?.id ?? null);
      setSelectedUserIds(new Set());
      setSelectedGroupIds(new Set());
    }
  }, [isOpen, share, sites]);

  useEffect(() => {
    if (!isOpen || siteId == null) {
      setUsers(null);
      setGroups(null);
      return;
    }
    let canceled = false;
    setLoadingMeta(true);
    Promise.all([
      fetch(`/api/site/${siteId}/users`, { cache: "no-store" }).then((r) =>
        r.json(),
      ),
      fetch(`/api/site/${siteId}/groups`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ items: [] })),
    ])
      .then(([uj, gj]) => {
        if (canceled) return;
        setUsers(uj.items || []);
        setGroups(gj.items || []);
      })
      .finally(() => {
        if (!canceled) setLoadingMeta(false);
      });
    return () => {
      canceled = true;
    };
  }, [isOpen, siteId]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.username || "").toLowerCase().includes(q) ||
        (u.alias || "").toLowerCase().includes(q),
    );
  }, [users, userQuery]);

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    const q = groupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, groupQuery]);

  function toggleUser(id: number) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleGroup(id: number) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (siteId == null) {
      toast.warning("请选择站点");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        siteAccountId: siteId,
        userIds: Array.from(selectedUserIds),
        groupIds: Array.from(selectedGroupIds),
      };
      const url = share ? `/api/site-shares/${share.id}` : `/api/site-shares`;
      const method = share ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success("已保存");
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{share ? "编辑分享" : "新建分享"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              placeholder="例 客户A 监控面板"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>站点</Label>
            <Select
              value={siteId != null ? String(siteId) : undefined}
              onValueChange={(v) => setSiteId(Number(v))}
              disabled={share != null}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择站点" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {share && (
              <p className="text-xs text-muted-foreground">已存在的分享不能换站点 — 删了重建</p>
            )}
          </div>

          {loadingMeta ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    允许的用户 ({selectedUserIds.size})
                  </span>
                  {users && users.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSelectedUserIds(
                            new Set(users.map((u) => u.remoteUserId)),
                          )
                        }
                      >
                        全选
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedUserIds(new Set())}
                      >
                        清空
                      </Button>
                    </div>
                  )}
                </div>
                <Input
                  className="h-8 mb-2"
                  placeholder="搜索 email / 别名 / username"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
                <div className="border border-border rounded max-h-[260px] overflow-auto p-2">
                  {filteredUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                      {users && users.length === 0
                        ? "该站点没有用户"
                        : "没有匹配的用户"}
                    </p>
                  ) : (
                    filteredUsers.map((u) => (
                      <div
                        key={u.remoteUserId}
                        className="flex items-center gap-2 py-1"
                      >
                        <Checkbox
                          checked={selectedUserIds.has(u.remoteUserId)}
                          onCheckedChange={() => toggleUser(u.remoteUserId)}
                        />
                        <span className="text-sm">
                          {u.alias || u.username || u.email}
                        </span>
                        {u.alias && (
                          <span className="text-xs text-muted-foreground">
                            ({u.email})
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    允许的分组 ({selectedGroupIds.size})
                  </span>
                  {groups && groups.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSelectedGroupIds(new Set(groups.map((g) => g.id)))
                        }
                      >
                        全选
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedGroupIds(new Set())}
                      >
                        清空
                      </Button>
                    </div>
                  )}
                </div>
                <Input
                  className="h-8 mb-2"
                  placeholder="搜索分组名"
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                />
                <div className="border border-border rounded max-h-[260px] overflow-auto p-2">
                  {filteredGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                      {groups && groups.length === 0
                        ? "该站点没有分组 (或未同步)"
                        : "没有匹配的分组"}
                    </p>
                  ) : (
                    filteredGroups.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center gap-2 py-1"
                      >
                        <Checkbox
                          checked={selectedGroupIds.has(g.id)}
                          onCheckedChange={() => toggleGroup(g.id)}
                        />
                        <span className="text-sm">
                          {g.name}
                          <span className="text-muted-foreground ml-1">
                            x{g.rate_multiplier}
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            留空 = 不展示任何用户/分组。客户页只能看到你勾选的项。
          </p>
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
