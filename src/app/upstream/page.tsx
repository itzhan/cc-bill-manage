"use client";
import { useEffect, useState } from "react";
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
import { ChevronRight } from "lucide-react";
import Shell from "@/components/Shell";
import { fmtDate, fmtMoneyShort } from "@/lib/format";

interface UpstreamAccount {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  email: string;
  remoteUserId: number | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  balance: number | null;
  balanceUpdatedAt: string | null;
  _count?: { keys: number };
}

interface UpstreamKey {
  id: number;
  remoteKeyId: number;
  name: string;
  keyMasked: string;
  groupName: string;
  groupRateMultiplier: number;
  effectiveRateMultiplier: number;
  hasExclusiveRate: boolean;
  todayActualCost: number;
  totalActualCost: number;
  lastUpdatedAt: string | null;
}

export default function UpstreamPage() {
  const [accounts, setAccounts] = useState<UpstreamAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [busyRefresh, setBusyRefresh] = useState<number | null>(null);
  const [keys, setKeys] = useState<Record<number, UpstreamKey[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showZero, setShowZero] = useState(false);

  const newDlg = useDisclosure();
  const editDlg = useDisclosure();
  const [editing, setEditing] = useState<UpstreamAccount | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "sub2api",
    baseUrl: "",
    email: "",
    password: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/upstream", { cache: "no-store" });
      const j = await res.json();
      setAccounts(j.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadKeys(id: number) {
    const res = await fetch(`/api/upstream/${id}/keys`, { cache: "no-store" });
    const j = await res.json();
    setKeys((prev) => ({ ...prev, [id]: j.items || [] }));
  }

  async function syncOne(id: number) {
    setBusy(id);
    try {
      const res = await fetch(`/api/upstream/${id}/sync`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast({ title: "同步失败", description: j.error, color: "danger" });
      } else {
        addToast({ title: "用量已更新", color: "success" });
        await load();
        if (expanded === id) await loadKeys(id);
      }
    } finally {
      setBusy(null);
    }
  }

  async function refreshOne(id: number) {
    setBusyRefresh(id);
    try {
      const res = await fetch(`/api/upstream/${id}/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast({ title: "刷新失败", description: j.error, color: "danger" });
      } else {
        addToast({ title: "结构已刷新", color: "success" });
        await load();
        if (expanded === id) await loadKeys(id);
      }
    } finally {
      setBusyRefresh(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除该上游账号？相关的 keys 和绑定也会删除。")) return;
    const res = await fetch(`/api/upstream/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "删除失败", description: j.error, color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
    await load();
  }

  function openNew() {
    setForm({ name: "", type: "sub2api", baseUrl: "", email: "", password: "" });
    newDlg.onOpen();
  }
  function openEdit(a: UpstreamAccount) {
    setEditing(a);
    setForm({
      name: a.name,
      type: a.type,
      baseUrl: a.baseUrl,
      email: a.email,
      password: "",
    });
    editDlg.onOpen();
  }

  async function submitNew() {
    if (!form.name || !form.baseUrl || !form.email || !form.password) {
      addToast({ title: "请填写完整", color: "warning" });
      return;
    }
    const res = await fetch("/api/upstream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "创建失败", description: j.error, color: "danger" });
      return;
    }
    newDlg.onClose();
    addToast({ title: "已创建", color: "success" });
    await load();
  }

  async function submitEdit() {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      name: form.name,
      baseUrl: form.baseUrl,
      email: form.email,
    };
    if (form.password) payload.password = form.password;
    const res = await fetch(`/api/upstream/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "保存失败", description: j.error, color: "danger" });
      return;
    }
    editDlg.onClose();
    addToast({ title: "已保存", color: "success" });
    await load();
  }

  async function toggleExpand(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!keys[id]) await loadKeys(id);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">上游账号</h1>
        <Button color="primary" onPress={openNew}>
          + 新建
        </Button>
      </div>

      {loading && !accounts.length ? (
        <div className="flex justify-center p-12">
          <Spinner />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardBody className="text-default-500">暂无上游账号</CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  // ignore clicks that come from action buttons
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
                className="flex justify-between flex-wrap gap-2 cursor-pointer hover:bg-default-50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <ChevronRight
                    size={16}
                    className={`mt-1 text-default-400 transition-transform ${expanded === a.id ? "rotate-90" : ""}`}
                  />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{a.name}</h3>
                      <Chip size="sm" variant="flat">
                        {a.type}
                      </Chip>
                      <Chip size="sm" variant="flat" color="default">
                        {a._count?.keys ?? 0} keys
                      </Chip>
                      {a.balance != null && (
                        <Chip
                          size="sm"
                          variant="flat"
                          color={a.balance > 0 ? "success" : "warning"}
                        >
                          余额 {fmtMoneyShort(a.balance)}
                        </Chip>
                      )}
                      {a.lastSyncError && (
                        <Chip size="sm" color="danger" variant="flat">
                          同步失败
                        </Chip>
                      )}
                    </div>
                    <p className="text-xs text-default-500 mt-1">
                      {a.email} @ {a.baseUrl} · 最后同步:{" "}
                      {fmtDate(a.lastSyncAt)}
                      {a.balanceUpdatedAt && (
                        <>
                          {" "}· 余额更新: {fmtDate(a.balanceUpdatedAt)}
                        </>
                      )}
                    </p>
                    {a.lastSyncError && (
                      <p className="text-xs text-danger mt-1 break-all">
                        {a.lastSyncError}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2" data-stop-toggle>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => syncOne(a.id)}
                    isLoading={busy === a.id}
                  >
                    同步用量
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => refreshOne(a.id)}
                    isLoading={busyRefresh === a.id}
                  >
                    结构刷新
                  </Button>
                  <Button size="sm" variant="flat" onPress={() => openEdit(a)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => remove(a.id)}
                  >
                    删除
                  </Button>
                </div>
              </CardHeader>
              {expanded === a.id && (
                <CardBody>
                  {!keys[a.id] ? (
                    <Spinner size="sm" />
                  ) : keys[a.id].length === 0 ? (
                    <p className="text-default-500 text-sm">
                      暂无 keys。点同步先拉一次。
                    </p>
                  ) : (() => {
                    const base = showZero
                      ? keys[a.id]
                      : keys[a.id].filter((k) => k.todayActualCost > 0);
                    const filtered = [...base].sort(
                      (x, y) => y.todayActualCost - x.todayActualCost,
                    );
                    const hiddenCount = keys[a.id].length - filtered.length;
                    return (
                      <>
                        <div className="flex items-center justify-between mb-2 text-xs text-default-500">
                          <Checkbox
                            size="sm"
                            isSelected={showZero}
                            onValueChange={setShowZero}
                          >
                            显示今日 0 消费的 key
                          </Checkbox>
                          {!showZero && hiddenCount > 0 && (
                            <span>
                              已隐藏 {hiddenCount} 个 0 消费 key
                            </span>
                          )}
                        </div>
                        {filtered.length === 0 ? (
                          <p className="text-default-500 text-sm">
                            没有今日有消费的 key。勾选上方可显示全部。
                          </p>
                        ) : (
                          <Table removeWrapper aria-label="keys">
                            <TableHeader>
                              <TableColumn>名称</TableColumn>
                              <TableColumn>分组×倍率</TableColumn>
                              <TableColumn>今日</TableColumn>
                              <TableColumn>累计</TableColumn>
                            </TableHeader>
                            <TableBody>
                              {filtered.map((k) => (
                                <TableRow key={k.id}>
                                  <TableCell>
                                    <div className="flex flex-col leading-tight">
                                      <span className="text-sm">{k.name}</span>
                                      <span className="font-mono text-xs text-default-400">
                                        {k.keyMasked}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col leading-tight">
                                      <span className="text-sm">
                                        {k.groupName}
                                      </span>
                                      <span className="text-xs text-default-400">
                                        {k.hasExclusiveRate ? (
                                          <span className="text-primary">
                                            专属 ×{k.effectiveRateMultiplier}
                                          </span>
                                        ) : (
                                          <>×{k.groupRateMultiplier}</>
                                        )}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {fmtMoneyShort(k.todayActualCost)}
                                  </TableCell>
                                  <TableCell className="text-default-500">
                                    {fmtMoneyShort(k.totalActualCost)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </>
                    );
                  })()}
                </CardBody>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={newDlg.isOpen} onClose={newDlg.onClose}>
        <ModalContent>
          <ModalHeader>新建上游账号</ModalHeader>
          <ModalBody className="gap-3">
            <Input
              label="名称"
              value={form.name}
              onValueChange={(v) => setForm({ ...form, name: v })}
            />
            <Select
              label="类型"
              selectedKeys={new Set([form.type])}
              onSelectionChange={(k) =>
                setForm({ ...form, type: Array.from(k)[0] as string })
              }
            >
              <SelectItem key="sub2api">sub2api</SelectItem>
            </Select>
            <Input
              label="Base URL"
              placeholder="http://1.2.3.4:8080"
              value={form.baseUrl}
              onValueChange={(v) => setForm({ ...form, baseUrl: v })}
            />
            <Input
              label="Email"
              value={form.email}
              onValueChange={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="密码"
              type="password"
              value={form.password}
              onValueChange={(v) => setForm({ ...form, password: v })}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={newDlg.onClose}>
              取消
            </Button>
            <Button color="primary" onPress={submitNew}>
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={editDlg.isOpen} onClose={editDlg.onClose}>
        <ModalContent>
          <ModalHeader>编辑上游账号</ModalHeader>
          <ModalBody className="gap-3">
            <Input
              label="名称"
              value={form.name}
              onValueChange={(v) => setForm({ ...form, name: v })}
            />
            <Input
              label="Base URL"
              value={form.baseUrl}
              onValueChange={(v) => setForm({ ...form, baseUrl: v })}
            />
            <Input
              label="Email"
              value={form.email}
              onValueChange={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="新密码（留空则不修改）"
              type="password"
              value={form.password}
              onValueChange={(v) => setForm({ ...form, password: v })}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={editDlg.onClose}>
              取消
            </Button>
            <Button color="primary" onPress={submitEdit}>
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Shell>
  );
}
