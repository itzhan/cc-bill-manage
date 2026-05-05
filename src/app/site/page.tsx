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
  Textarea,
  Tooltip,
  addToast,
  useDisclosure,
} from "@heroui/react";
import {
  ChevronRight,
  Pencil,
  StickyNote,
  Wallet,
} from "lucide-react";
import Shell from "@/components/Shell";
import { fmtDate, fmtMoneyShort } from "@/lib/format";

interface SiteAccount {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  email: string;
  apiKey: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
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
  const [showZero, setShowZero] = useState(false);
  const [bound, setBound] = useState<Record<number, BoundAccount[]>>({});
  const [users, setUsers] = useState<Record<number, SiteUserRow[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showZeroUsers, setShowZeroUsers] = useState(false);

  const newDlg = useDisclosure();
  const editDlg = useDisclosure();
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
      const res = await fetch("/api/site", { cache: "no-store" });
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
        addToast({ title: "同步失败", description: j.error, color: "danger" });
      } else {
        addToast({ title: "用量已更新", color: "success" });
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
        addToast({ title: "刷新失败", description: j.error, color: "danger" });
      } else {
        addToast({ title: "结构已刷新", color: "success" });
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
      addToast({ title: "删除失败", description: j.error, color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
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
    newDlg.onOpen();
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
    editDlg.onOpen();
  }

  async function submitNew() {
    if (!form.name || !form.baseUrl) {
      addToast({ title: "名称和 Base URL 必填", color: "warning" });
      return;
    }
    if (!form.apiKey && (!form.email || !form.password)) {
      addToast({
        title: "请填写 apiKey，或填写 email + password",
        color: "warning",
      });
      return;
    }
    const res = await fetch("/api/site", {
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
    if (!bound[id]) await loadBound(id);
    if (!users[id]) await loadUsers(id);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">本站账号（管理员）</h1>
          <p className="text-sm text-default-500">
            收入侧：拉取 admin/accounts 和 today-stats
          </p>
        </div>
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
          <CardBody className="text-default-500">暂无本站账号</CardBody>
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
                        {a._count?.accounts ?? 0} accounts
                      </Chip>
                      {a.lastSyncError && (
                        <Chip size="sm" color="danger" variant="flat">
                          同步失败
                        </Chip>
                      )}
                    </div>
                    <p className="text-xs text-default-500 mt-1">
                      {a.email} @ {a.baseUrl} · 最后同步:{" "}
                      {fmtDate(a.lastSyncAt)}
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
                  <UsersSection
                    siteAccountId={a.id}
                    rows={users[a.id]}
                    showZero={showZeroUsers}
                    onToggleShowZero={setShowZeroUsers}
                    onChanged={() => loadUsers(a.id)}
                  />

                  <div className="mt-6 pt-4 border-t border-divider/40">
                    <h4 className="font-semibold mb-1">上游账号 / 分组</h4>
                    <p className="text-xs text-default-500 mb-3">
                      本站这边对接到上游的 admin/account 列表（按今日消费降序）
                    </p>
                  </div>
                  {!bound[a.id] ? (
                    <Spinner size="sm" />
                  ) : bound[a.id].length === 0 ? (
                    <p className="text-default-500 text-sm">
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
                        <div className="flex items-center justify-between mb-2 text-xs text-default-500">
                          <Checkbox
                            size="sm"
                            isSelected={showZero}
                            onValueChange={setShowZero}
                          >
                            显示今日 0 消费的 account
                          </Checkbox>
                          {!showZero && hiddenCount > 0 && (
                            <span>已隐藏 {hiddenCount} 个 0 消费 account</span>
                          )}
                        </div>
                        {filtered.length === 0 ? (
                          <p className="text-default-500 text-sm">
                            没有今日有消费的 account。勾选上方可显示全部。
                          </p>
                        ) : (
                    <Table removeWrapper aria-label="bound accounts">
                      <TableHeader>
                        <TableColumn>名称</TableColumn>
                        <TableColumn>分组×倍率</TableColumn>
                        <TableColumn>请求</TableColumn>
                        <TableColumn>实际收入</TableColumn>
                        <TableColumn>倍率覆盖</TableColumn>
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
                                  <span className="text-xs text-default-400">
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
                                  <span className="text-xs text-default-400">
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
                </CardBody>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={newDlg.isOpen} onClose={newDlg.onClose}>
        <ModalContent>
          <ModalHeader>新建本站账号</ModalHeader>
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
              placeholder="http://your-site:8080"
              value={form.baseUrl}
              onValueChange={(v) => setForm({ ...form, baseUrl: v })}
            />
            <Input
              label="Admin API Key（推荐）"
              description="填写后请求走 x-api-key，免登录；email/password 仅作记录。也可只填 email/password 走登录流程。"
              type="password"
              value={form.apiKey}
              onValueChange={(v) => setForm({ ...form, apiKey: v })}
            />
            <Input
              label="Email（记录或登录）"
              value={form.email}
              onValueChange={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="密码（记录或登录）"
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
          <ModalHeader>编辑本站账号</ModalHeader>
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
              label="Admin API Key"
              description="留空则使用 email + password 登录"
              type="password"
              value={form.apiKey}
              onValueChange={(v) => setForm({ ...form, apiKey: v })}
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
    return <span className="text-default-400">—</span>;
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
        <span className="text-default-500">×{main.rate_multiplier}</span>
        {rest.length > 0 && (
          <Chip
            size="sm"
            variant="flat"
            classNames={{ base: "h-4", content: "text-[10px] px-1" }}
          >
            +{rest.length}
          </Chip>
        )}
      </div>
      <span className="text-default-400">
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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: clear ? "已清除" : "已保存", color: "success" });
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
          <Chip size="sm" color="primary" variant="flat">
            ×{account.rateMultiplierOverride}
          </Chip>
        ) : (
          <span className="text-xs text-default-400">—</span>
        )}
        <Button
          size="sm"
          variant="light"
          isIconOnly
          onPress={() => {
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
        size="sm"
        type="number"
        step="0.01"
        value={val}
        onValueChange={setVal}
        placeholder="例 1.7"
        className="w-24"
      />
      <Button
        size="sm"
        color="primary"
        variant="flat"
        isLoading={saving}
        onPress={() => save(false)}
      >
        保存
      </Button>
      <Button
        size="sm"
        variant="light"
        onPress={() => save(true)}
        isDisabled={saving}
      >
        清除
      </Button>
      <Button
        size="sm"
        variant="light"
        onPress={() => setEditing(false)}
        isDisabled={saving}
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
        <Spinner size="sm" />
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
        <div className="rounded-lg bg-content2 p-3">
          <p className="text-xs text-default-500">总实际计费</p>
          <p className="text-lg font-bold mt-1">
            {fmtMoneyShort(totalEffective)}
          </p>
          <p className="text-xs text-default-400 mt-0.5">
            {afterShowZero.length} 个用户
          </p>
        </div>
        <div className="rounded-lg bg-content2 p-3">
          <p className="text-xs text-default-500">总已结款</p>
          <p className="text-lg font-bold text-success mt-1">
            {fmtMoneyShort(totalSettled)}
          </p>
          <p className="text-xs text-default-400 mt-0.5">
            占比{" "}
            {totalEffective > 0
              ? ((totalSettled / totalEffective) * 100).toFixed(1)
              : "0"}
            %
          </p>
        </div>
        <div className="rounded-lg bg-danger/10 p-3 border border-danger/20">
          <p className="text-xs text-danger/80">总欠款</p>
          <p className="text-lg font-bold text-danger mt-1">
            {fmtMoneyShort(totalOwed)}
          </p>
          <p className="text-xs text-danger/60 mt-0.5">
            {debtors.length} 个客户欠款
          </p>
        </div>
        <div className="rounded-lg bg-content2 p-3">
          <p className="text-xs text-default-500">多付/预存</p>
          <p
            className={`text-lg font-bold mt-1 ${overpayers.length > 0 ? "text-warning" : "text-default-400"}`}
          >
            {fmtMoneyShort(totalOverpaid)}
          </p>
          <p className="text-xs text-default-400 mt-0.5">
            {overpayers.length} 个用户
          </p>
        </div>
      </div>

      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h4 className="font-semibold">用户</h4>
          <p className="text-xs text-default-500">
            总消费 = 总充值 − 当前余额（× 你设定的倍率）
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-default-500">
          <Input
            size="sm"
            placeholder="按邮箱 / 别名 / username 搜索"
            value={search}
            onValueChange={setSearch}
            isClearable
            onClear={() => setSearch("")}
            className="w-64"
          />
          {!showZero && hiddenZero > 0 && (
            <span>已隐藏 {hiddenZero} 个 0 消费用户</span>
          )}
          <Checkbox
            size="sm"
            isSelected={showZero}
            onValueChange={onToggleShowZero}
          >
            显示无充值的用户
          </Checkbox>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-default-500 text-sm">
          {q
            ? `没有匹配 "${search}" 的用户`
            : "没有有充值的用户。勾选上方可显示全部。"}
        </p>
      ) : (
        <Table removeWrapper aria-label="users">
          <TableHeader>
            <TableColumn>用户</TableColumn>
            <TableColumn>备注</TableColumn>
            <TableColumn>今日消费</TableColumn>
            <TableColumn>累计实际计费</TableColumn>
            <TableColumn>已结款</TableColumn>
            <TableColumn>欠款</TableColumn>
            <TableColumn>操作</TableColumn>
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
                          <Chip
                            size="sm"
                            color="secondary"
                            variant="flat"
                            classNames={{
                              base: "h-4",
                              content: "text-[10px] px-1",
                            }}
                          >
                            别名
                          </Chip>
                        )}
                        {inactive && (
                          <Chip
                            size="sm"
                            variant="flat"
                            color="default"
                            classNames={{
                              base: "h-4",
                              content: "text-[10px]",
                            }}
                          >
                            {u.status}
                          </Chip>
                        )}
                      </div>
                      <span className="text-xs text-default-400">
                        {u.email} · 余额 {fmtMoneyShort(u.balance)} · 总充{" "}
                        {fmtMoneyShort(u.totalRecharged)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.notes ? (
                      <Tooltip
                        content={
                          <div className="max-w-md whitespace-pre-wrap break-words p-1 text-xs">
                            {u.notes}
                          </div>
                        }
                        placement="top"
                        delay={150}
                      >
                        <span className="flex items-center gap-1 max-w-[180px] text-xs text-default-600 cursor-help">
                          <StickyNote
                            size={12}
                            className="shrink-0 text-default-400"
                          />
                          <span className="truncate">{u.notes}</span>
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-default-300">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span
                        className={
                          u.todayActualCost > 0
                            ? "font-medium"
                            : "text-default-400"
                        }
                      >
                        {fmtMoneyShort(u.todayActualCost)}
                      </span>
                      {u.todayCost > 0 && (
                        <span className="text-xs text-default-400">
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
                      <span className="text-xs text-default-400">
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
                      <span className="text-success font-medium">
                        {fmtMoneyShort(u.settledTotal)}
                      </span>
                      {u.settlementCount > 0 && (
                        <span className="text-xs text-default-400">
                          {u.settlementCount} 笔
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        u.owed > 0.01
                          ? "text-danger font-semibold text-lg"
                          : u.owed < -0.01
                            ? "text-warning font-semibold"
                            : "text-default-400"
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
  const dlg = useDisclosure();
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
    dlg.onOpen();
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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已保存", color: "success" });
      dlg.onClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="flat"
        startContent={<Pencil size={13} />}
        onPress={open}
      >
        编辑
      </Button>
      <Modal isOpen={dlg.isOpen} onClose={dlg.onClose} size="lg">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>编辑用户</span>
            <span className="text-xs text-default-500 font-normal">
              {user.email}
            </span>
          </ModalHeader>
          <ModalBody className="gap-3">
            <Input
              label="别名"
              description="留空则显示同步过来的 username / email"
              placeholder="例 大客户A"
              value={alias}
              onValueChange={setAlias}
            />
            <Input
              type="number"
              step="0.01"
              label="结算倍率覆盖"
              description="留空 = ×1.00（按原价）"
              placeholder="例 0.8"
              value={rate}
              onValueChange={setRate}
            />
            <Textarea
              label="备注"
              placeholder="任何想记的：联系方式、对接情况、合同号…"
              minRows={2}
              value={notes}
              onValueChange={setNotes}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={dlg.onClose}>
              取消
            </Button>
            <Button color="primary" onPress={save} isLoading={saving}>
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
  const dlg = useDisclosure();
  const [list, setList] = useState<Settlement[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
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

  async function open() {
    dlg.onOpen();
    await load();
  }

  async function add() {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      addToast({ title: "金额必须大于 0", color: "warning" });
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
        addToast({ title: "添加失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已添加", color: "success" });
      setAmount("");
      setNotes("");
      await load();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除该笔结款？")) return;
    const r = await fetch(`/api/settlements/${id}`, { method: "DELETE" });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    await load();
    onChanged();
  }

  async function settleAll() {
    const owed = user.owed;
    if (owed <= 0.01) {
      addToast({ title: "当前没有欠款", color: "default" });
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
        addToast({ title: "结清失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已结清", color: "success" });
      await load();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="flat"
        startContent={<Wallet size={13} />}
        onPress={open}
      >
        结款
      </Button>
      <Modal isOpen={dlg.isOpen} onClose={dlg.onClose} size="2xl">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{user.username || user.email} · 结款记录</span>
            <span className="text-xs text-default-500 font-normal">
              {user.email}
            </span>
          </ModalHeader>
          <ModalBody className="gap-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-content2">
              <div className="flex-1 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-default-500">实际计费</p>
                  <p className="font-semibold">
                    {fmtMoneyShort(user.effectiveConsumed)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-default-500">已结款</p>
                  <p className="font-semibold text-success">
                    {fmtMoneyShort(user.settledTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-default-500">欠款</p>
                  <p
                    className={
                      user.owed > 0.01
                        ? "font-semibold text-danger"
                        : user.owed < -0.01
                          ? "font-semibold text-warning"
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
                  color="success"
                  variant="flat"
                  onPress={settleAll}
                  isLoading={saving}
                >
                  一键结清 {fmtMoneyShort(user.owed)}
                </Button>
              )}
            </div>

            <div className="border border-divider/40 rounded-lg p-3">
              <p className="text-sm font-medium mb-2">登记一笔结款</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  size="sm"
                  type="number"
                  step="0.01"
                  label="金额"
                  placeholder="例 1000"
                  value={amount}
                  onValueChange={setAmount}
                />
                <Input
                  size="sm"
                  type="date"
                  label="结款日期"
                  value={paidAt}
                  onValueChange={setPaidAt}
                />
                <Input
                  size="sm"
                  label="备注（可空）"
                  value={notes}
                  onValueChange={setNotes}
                />
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  color="primary"
                  onPress={add}
                  isLoading={saving}
                >
                  添加结款
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">历史记录</p>
              {loading ? (
                <Spinner size="sm" />
              ) : !list || list.length === 0 ? (
                <p className="text-sm text-default-500">暂无结款记录</p>
              ) : (
                <Table removeWrapper aria-label="settlements">
                  <TableHeader>
                    <TableColumn>日期</TableColumn>
                    <TableColumn>金额</TableColumn>
                    <TableColumn>备注</TableColumn>
                    <TableColumn>操作</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {list.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">
                          {fmtDate(s.paidAt)}
                        </TableCell>
                        <TableCell className="text-success font-medium">
                          {fmtMoneyShort(s.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-default-500">
                          {s.notes || "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="light"
                            color="danger"
                            onPress={() => remove(s.id)}
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
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={dlg.onClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
