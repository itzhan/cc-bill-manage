"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
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
import { Copy, ExternalLink, Pencil, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { fmtDate } from "@/lib/format";

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
  const newDlg = useDisclosure();
  const editDlg = useDisclosure();
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
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
    await load();
  }

  function shareUrl(shareId: string): string {
    if (typeof window === "undefined") return `/share/${shareId}`;
    return `${window.location.origin}/share/${shareId}`;
  }

  async function copyUrl(shareId: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(shareId));
      addToast({ title: "已复制链接", color: "success" });
    } catch {
      addToast({ title: "复制失败", color: "danger" });
    }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">对外展示链接</h1>
          <p className="text-sm text-default-500">
            生成免登录链接, 让客户实时看到指定站点的 RPM/TPM 与指定用户的并发/分组 RPM。
          </p>
        </div>
        <Button color="primary" onPress={newDlg.onOpen}>
          + 新建分享
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Spinner />
        </div>
      ) : shares.length === 0 ? (
        <Card>
          <CardBody className="text-default-500">
            还没有分享链接。点击右上角"新建分享"开始。
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">分享列表</h3>
          </CardHeader>
          <CardBody>
            <Table removeWrapper aria-label="shares">
              <TableHeader>
                <TableColumn>名称</TableColumn>
                <TableColumn>站点</TableColumn>
                <TableColumn>链接</TableColumn>
                <TableColumn>允许范围</TableColumn>
                <TableColumn>创建时间</TableColumn>
                <TableColumn>操作</TableColumn>
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
                          <code className="text-xs bg-default-100 px-1.5 py-0.5 rounded">
                            {s.shareId}
                          </code>
                          <Button
                            size="sm"
                            variant="light"
                            isIconOnly
                            onPress={() => copyUrl(s.shareId)}
                            aria-label="copy"
                          >
                            <Copy size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="light"
                            isIconOnly
                            as="a"
                            href={shareUrl(s.shareId)}
                            target="_blank"
                            aria-label="open"
                          >
                            <ExternalLink size={14} />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 flex-wrap">
                          <Chip
                            size="sm"
                            color={userCount === 0 ? "danger" : "primary"}
                            variant="flat"
                          >
                            {userCount} 用户
                          </Chip>
                          <Chip
                            size="sm"
                            color={groupCount === 0 ? "danger" : "primary"}
                            variant="flat"
                          >
                            {groupCount} 分组
                          </Chip>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-default-500">
                        {fmtDate(s.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="flat"
                            startContent={<Pencil size={13} />}
                            onPress={() => {
                              setEditing(s);
                              editDlg.onOpen();
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            startContent={<Trash2 size={13} />}
                            onPress={() => remove(s)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <ShareEditModal
        isOpen={newDlg.isOpen}
        onClose={newDlg.onClose}
        sites={sites}
        share={null}
        onSaved={async () => {
          newDlg.onClose();
          await load();
        }}
      />
      <ShareEditModal
        isOpen={editDlg.isOpen}
        onClose={editDlg.onClose}
        sites={sites}
        share={editing}
        onSaved={async () => {
          editDlg.onClose();
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

  // 打开时重置/回填 form。
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

  // siteId 一变, 拉对应站点的 users + groups。
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
      addToast({ title: "请选择站点", color: "warning" });
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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已保存", color: "success" });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{share ? "编辑分享" : "新建分享"}</ModalHeader>
        <ModalBody className="gap-3">
          <Input
            label="名称"
            placeholder="例 客户A 监控面板"
            value={name}
            onValueChange={setName}
          />
          <Select
            label="站点"
            isDisabled={share != null}
            selectedKeys={siteId != null ? new Set([String(siteId)]) : new Set()}
            onSelectionChange={(k) => {
              const v = Array.from(k)[0];
              if (v != null) setSiteId(Number(v));
            }}
            description={share ? "已存在的分享不能换站点 — 删了重建" : undefined}
          >
            {sites.map((s) => (
              <SelectItem key={String(s.id)}>{s.name}</SelectItem>
            ))}
          </Select>

          {loadingMeta ? (
            <div className="flex justify-center p-6">
              <Spinner size="sm" />
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
                        variant="light"
                        onPress={() =>
                          setSelectedUserIds(
                            new Set(users.map((u) => u.remoteUserId)),
                          )
                        }
                      >
                        全选
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        onPress={() => setSelectedUserIds(new Set())}
                      >
                        清空
                      </Button>
                    </div>
                  )}
                </div>
                <Input
                  size="sm"
                  placeholder="搜索 email / 别名 / username"
                  value={userQuery}
                  onValueChange={setUserQuery}
                  isClearable
                  onClear={() => setUserQuery("")}
                  className="mb-2"
                />
                <div className="border border-divider/40 rounded max-h-[260px] overflow-auto p-2">
                  {filteredUsers.length === 0 ? (
                    <p className="text-xs text-default-400 p-2">
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
                          size="sm"
                          isSelected={selectedUserIds.has(u.remoteUserId)}
                          onValueChange={() => toggleUser(u.remoteUserId)}
                        >
                          <span className="text-sm">
                            {u.alias || u.username || u.email}
                          </span>
                        </Checkbox>
                        {u.alias && (
                          <span className="text-xs text-default-400">
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
                        variant="light"
                        onPress={() =>
                          setSelectedGroupIds(new Set(groups.map((g) => g.id)))
                        }
                      >
                        全选
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        onPress={() => setSelectedGroupIds(new Set())}
                      >
                        清空
                      </Button>
                    </div>
                  )}
                </div>
                <Input
                  size="sm"
                  placeholder="搜索分组名"
                  value={groupQuery}
                  onValueChange={setGroupQuery}
                  isClearable
                  onClear={() => setGroupQuery("")}
                  className="mb-2"
                />
                <div className="border border-divider/40 rounded max-h-[260px] overflow-auto p-2">
                  {filteredGroups.length === 0 ? (
                    <p className="text-xs text-default-400 p-2">
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
                          size="sm"
                          isSelected={selectedGroupIds.has(g.id)}
                          onValueChange={() => toggleGroup(g.id)}
                        >
                          <span className="text-sm">
                            {g.name}
                            <span className="text-default-400 ml-1">
                              ×{g.rate_multiplier}
                            </span>
                          </span>
                        </Checkbox>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-default-500">
            留空 = 不展示任何用户/分组。客户页只能看到你勾选的项。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={save} isLoading={saving}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
