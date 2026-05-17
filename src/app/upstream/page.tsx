"use client";
import { useEffect, useState } from "react";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  CardFooter,
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
  addToast,
  useDisclosure,
} from "@heroui/react";
import {
  Building2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import Shell from "@/components/Shell";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtDate, fmtMoneyShort } from "@/lib/format";

interface UpstreamCategory {
  id: number;
  name: string;
  sortOrder: number;
}

interface InventoryItem {
  name: string;
  price?: string;
  concurrency?: string;
  note?: string;
  // 该货源所属分类。空 / 缺失 → 继承所在渠道的 categories (即跟随渠道
  // 出现在所有它所属的 Tab 里)。
  categories?: string[];
}

// 从 price 字符串里抓第一个数字, 给跨渠道比价用 — price 是自由文本
// ("$5/M", "10/M", "5"...) 普通字符串比较没法用, 抓出数字才能排序。
// 抓不到返回 Infinity, 自然排到最后。
function priceNumeric(price: string | undefined): number {
  if (!price) return Number.POSITIVE_INFINITY;
  const m = /[0-9]+(?:\.[0-9]+)?/.exec(price);
  if (!m) return Number.POSITIVE_INFINITY;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

interface UpstreamAccount {
  id: number;
  name: string;
  type: string;
  category: string; // legacy 主分类, 兼容老代码
  categories: string[]; // 新多分类列表
  supplier: string | null;
  baseUrl: string;
  email: string;
  password?: string;
  remoteUserId: number | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  balance: number | null;
  balanceUpdatedAt: string | null;
  notes: string | null;
  inventory: string | null;
  todayCost?: number;
  _count?: { keys: number };
}

// Tab 全部用 "__all" 作为合成 key, 真实分类来自 API
const TAB_ALL = "__all";

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
  rechargeMultiplier: number;
  lastUpdatedAt: string | null;
  isStale?: boolean;
}

function parseInventory(raw: string | null): InventoryItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function UpstreamPage() {
  const [accounts, setAccounts] = useState<UpstreamAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [busyRefresh, setBusyRefresh] = useState<number | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [keys, setKeys] = useState<Record<number, UpstreamKey[]>>({});
  const [keysModalAccount, setKeysModalAccount] =
    useState<UpstreamAccount | null>(null);
  const [showZero, setShowZero] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [copyingKeyId, setCopyingKeyId] = useState<number | null>(null);

  const newDlg = useDisclosure();
  const editDlg = useDisclosure();
  const keysDlg = useDisclosure();
  const [editing, setEditing] = useState<UpstreamAccount | null>(null);
  const [editTab, setEditTab] = useState<string>("creds");
  const [form, setForm] = useState({
    name: "",
    type: "sub2api",
    categories: ["claude"] as string[], // 多分类
    supplier: "",
    baseUrl: "",
    email: "",
    password: "",
    accessToken: "",
    notes: "",
    inventory: [] as InventoryItem[],
  });
  // 折叠状态: 默认所有 supplier 展开;用户可点 header 收起。
  const [collapsedSuppliers, setCollapsedSuppliers] = useState<Set<string>>(
    new Set(),
  );
  // 当前 Tab; 历史渠道 db push 时自动落到 claude, 默认显示 claude。
  const [categoryFilter, setCategoryFilter] = useState<string>("claude");
  // 用户自定义的分类列表 — 决定 Tab 显示
  const [categoryList, setCategoryList] = useState<UpstreamCategory[]>([]);
  // 新增分类对话框
  const [newCategoryName, setNewCategoryName] = useState("");
  const newCategoryDlg = useDisclosure();
  const [invDraft, setInvDraft] = useState<InventoryItem>({
    name: "",
    price: "",
    concurrency: "",
    note: "",
  });

  async function load() {
    setLoading(true);
    try {
      const [acctRes, catRes] = await Promise.all([
        fetch("/api/upstream", { cache: "no-store" }),
        fetch("/api/upstream/categories", { cache: "no-store" }),
      ]);
      const acctJ = await acctRes.json();
      const catJ = await catRes.json();
      setAccounts(acctJ.items || []);
      setCategoryList((catJ.items || []) as UpstreamCategory[]);
    } finally {
      setLoading(false);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      addToast({ title: "分类名必填", color: "warning" });
      return;
    }
    const res = await fetch("/api/upstream/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      addToast({ title: "新增失败", description: j.error, color: "danger" });
      return;
    }
    setNewCategoryName("");
    newCategoryDlg.onClose();
    await load();
  }

  async function deleteCategory(id: number, name: string) {
    if (!confirm(`删除分类 "${name}"?\n各渠道里 categories 引用此名称的项会变成"未知分类",不影响展示但建议先编辑各渠道清理引用。`)) {
      return;
    }
    const res = await fetch(`/api/upstream/categories/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "删除失败", description: j.error, color: "danger" });
      return;
    }
    await load();
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
        if (keysModalAccount?.id === id) await loadKeys(id);
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
        if (keysModalAccount?.id === id) await loadKeys(id);
      }
    } finally {
      setBusyRefresh(null);
    }
  }

  // Refresh (structure) + sync (today's usage) every upstream account in
  // one shot — the 一键刷新同步 button on the page header.
  async function refreshAndSyncAll() {
    setBusyAll(true);
    try {
      const res = await fetch("/api/upstream/refresh-sync", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast({
          title: "批量刷新失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      const j = (await res.json()) as {
        refresh: { name: string; ok: boolean; error?: string }[];
        sync: { name: string; ok: boolean; error?: string }[];
      };
      const failedRefresh = j.refresh.filter((x) => !x.ok);
      const failedSync = j.sync.filter((x) => !x.ok);
      const total = j.refresh.length;
      const failedCount = failedRefresh.length + failedSync.length;
      if (failedCount === 0) {
        addToast({
          title: `已完成 ${total} 个渠道的刷新 + 同步`,
          color: "success",
        });
      } else {
        const desc = [
          ...failedRefresh.map((x) => `刷新 ${x.name}: ${x.error}`),
          ...failedSync.map((x) => `同步 ${x.name}: ${x.error}`),
        ]
          .slice(0, 4)
          .join(" · ");
        addToast({
          title: `${total} 个中 ${failedCount} 项失败`,
          description: desc,
          color: "warning",
        });
      }
      await load();
      if (keysModalAccount) await loadKeys(keysModalAccount.id);
    } catch (e) {
      addToast({
        title: "批量刷新失败",
        description: e instanceof Error ? e.message : String(e),
        color: "danger",
      });
    } finally {
      setBusyAll(false);
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
    // 新建时默认勾上当前 Tab 的分类
    const defaultCats =
      categoryFilter === TAB_ALL
        ? categoryList.length > 0
          ? [categoryList[0].name]
          : ["claude"]
        : [categoryFilter];
    setForm({
      name: "",
      type: "sub2api",
      categories: defaultCats,
      supplier: "",
      baseUrl: "",
      email: "",
      password: "",
      accessToken: "",
      notes: "",
      inventory: [],
    });
    setInvDraft({ name: "", price: "", concurrency: "", note: "" });
    setEditTab("creds");
    newDlg.onOpen();
  }
  function openEdit(a: UpstreamAccount) {
    setEditing(a);
    const cats =
      a.categories && a.categories.length > 0
        ? a.categories
        : [a.category ?? "claude"];
    setForm({
      name: a.name,
      type: a.type,
      categories: cats,
      supplier: a.supplier ?? "",
      baseUrl: a.baseUrl,
      email: a.email,
      password: "",
      accessToken: "",
      notes: a.notes ?? "",
      inventory: parseInventory(a.inventory),
    });
    setInvDraft({ name: "", price: "", concurrency: "", note: "" });
    setEditTab("inventory");
    editDlg.onOpen();
  }

  function openKeys(a: UpstreamAccount) {
    setKeysModalAccount(a);
    keysDlg.onOpen();
    if (!keys[a.id]) loadKeys(a.id);
  }

  function addInventoryDraft() {
    if (!invDraft.name.trim()) return;
    setForm((f) => ({ ...f, inventory: [...f.inventory, { ...invDraft }] }));
    setInvDraft({ name: "", price: "", concurrency: "", note: "" });
  }
  function removeInventory(i: number) {
    setForm((f) => ({
      ...f,
      inventory: f.inventory.filter((_, idx) => idx !== i),
    }));
  }

  // Pull pending invDraft (user typed but didn't click +) into the list at
  // submit time so saves don't silently drop the row they just typed.
  function flushedInventory(): InventoryItem[] {
    if (invDraft.name.trim()) {
      return [...form.inventory, { ...invDraft }];
    }
    return form.inventory;
  }

  async function submitNew() {
    if (!form.name || !form.baseUrl) {
      addToast({ title: "请填写名称和 Base URL", color: "warning" });
      return;
    }
    if (!form.accessToken && (!form.email || !form.password)) {
      addToast({
        title: "请填写 Access Token，或同时填写 Email + 密码",
        color: "warning",
      });
      return;
    }
    const inv = flushedInventory();
    const payload = {
      name: form.name,
      type: form.type,
      categories: form.categories,
      supplier: form.supplier?.trim() || null,
      baseUrl: form.baseUrl,
      email: form.email,
      password: form.password,
      accessToken: form.accessToken || undefined,
    };
    const res = await fetch("/api/upstream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "创建失败", description: j.error, color: "danger" });
      return;
    }
    const created = await res.json();
    if (form.notes || inv.length) {
      await fetch(`/api/upstream/${created.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: form.notes || null,
          inventory: inv.length ? JSON.stringify(inv) : null,
        }),
      });
    }
    newDlg.onClose();
    addToast({ title: "已创建", color: "success" });
    await load();
  }

  async function submitEdit() {
    if (!editing) return;
    const inv = flushedInventory();
    const payload: Record<string, unknown> = {
      name: form.name,
      categories: form.categories,
      supplier: form.supplier?.trim() || null,
      baseUrl: form.baseUrl,
      email: form.email,
      notes: form.notes || null,
      inventory: inv.length ? JSON.stringify(inv) : null,
    };
    if (form.password) payload.password = form.password;
    if (form.accessToken) payload.accessToken = form.accessToken;
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

  function toggleReveal(id: number) {
    setRevealed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copy(text: string) {
    void copyToClipboard(text).then((ok) => {
      addToast({
        title: ok ? "已复制" : "复制失败",
        color: ok ? "success" : "danger",
      });
    });
  }

  // Reveal-then-copy: GET /api/upstream/key/[id] re-fetches the full key
  // from the upstream live, then we drop it on the clipboard. We never
  // hold the plaintext in component state to keep the surface area small.
  async function copyFullKey(keyId: number, name: string) {
    setCopyingKeyId(keyId);
    try {
      const res = await fetch(`/api/upstream/key/${keyId}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok) {
        addToast({
          title: "获取 key 失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      const fullKey: string | null = j.item?.apiKey ?? null;
      if (!fullKey) {
        addToast({
          title: "未拿到完整 key",
          description: j.item?.revealError || "上游可能也只返回了 mask",
          color: "warning",
        });
        return;
      }
      const ok = await copyToClipboard(fullKey);
      addToast({
        title: ok ? `${name} 的 key 已复制` : "复制失败",
        color: ok ? "success" : "danger",
      });
    } catch (e) {
      addToast({
        title: "复制失败",
        description: e instanceof Error ? e.message : String(e),
        color: "danger",
      });
    } finally {
      setCopyingKeyId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 当前 category 过滤后的渠道集 — supplier 分组和散卡都用它(避免在两处
  // 重复写 categoryFilter 判断)。
  function channelCategories(a: UpstreamAccount): string[] {
    return a.categories && a.categories.length > 0
      ? a.categories
      : [a.category ?? "claude"];
  }
  const filteredAccounts = accounts.filter((a) =>
    categoryFilter === TAB_ALL
      ? true
      : channelCategories(a).includes(categoryFilter),
  );
  // 当前 Tab 下"同名货源最低价"映射: name(lowercase) → {accountId, price}
  // 同 Tab 下显示的所有渠道里, 对每个 inventory 名字找最低价 (按 priceNumeric)。
  // 该 (name, accountId) 在渲染时拿到 🏆 最低价 标识。"全部" Tab 时也算, 这样
  // 全局横向比价。
  const bestPriceByName = (() => {
    type Best = { accountId: number; numeric: number };
    const m = new Map<string, Best>();
    for (const a of filteredAccounts) {
      const inv = parseInventory(a.inventory);
      const cats = channelCategories(a);
      for (const it of inv) {
        // 货源条目过滤: 当前 Tab 是 "全部" 则全收;否则需要 (它自己的 categories
        // 包含当前 Tab) 或 (它没填 categories 且渠道所属 categories 包含)
        const itemCats = it.categories ?? [];
        const itemEffective = itemCats.length > 0 ? itemCats : cats;
        if (
          categoryFilter !== TAB_ALL &&
          !itemEffective.includes(categoryFilter)
        ) {
          continue;
        }
        const key = it.name.trim().toLowerCase();
        if (!key) continue;
        const num = priceNumeric(it.price);
        if (!Number.isFinite(num)) continue;
        const cur = m.get(key);
        if (!cur || num < cur.numeric) {
          m.set(key, { accountId: a.id, numeric: num });
        }
      }
    }
    return m;
  })();

  // 给单个渠道算它当前 Tab 下应展示的货源(已 filter + sort by price asc)
  function visibleInventory(a: UpstreamAccount): InventoryItem[] {
    const inv = parseInventory(a.inventory);
    const cats = channelCategories(a);
    const filtered = inv.filter((it) => {
      if (categoryFilter === TAB_ALL) return true;
      const itemCats = it.categories ?? [];
      const itemEffective = itemCats.length > 0 ? itemCats : cats;
      return itemEffective.includes(categoryFilter);
    });
    filtered.sort((x, y) => priceNumeric(x.price) - priceNumeric(y.price));
    return filtered;
  }
  function isBestPrice(a: UpstreamAccount, it: InventoryItem): boolean {
    const key = it.name.trim().toLowerCase();
    const best = bestPriceByName.get(key);
    return !!best && best.accountId === a.id;
  }
  // 按 supplier 分组(null = 散户), 顺序按字母 + 散户最后。
  const grouped = (() => {
    const bySupplier = new Map<string, UpstreamAccount[]>();
    const ungrouped: UpstreamAccount[] = [];
    for (const a of filteredAccounts) {
      if (a.supplier) {
        const list = bySupplier.get(a.supplier) ?? [];
        list.push(a);
        bySupplier.set(a.supplier, list);
      } else {
        ungrouped.push(a);
      }
    }
    const suppliers = [...bySupplier.entries()].sort((x, y) =>
      x[0].localeCompare(y[0]),
    );
    return { suppliers, ungrouped };
  })();
  // 全局 supplier 候选(不受 category 过滤,新建渠道时所有 supplier 都该可选)
  const supplierOptions = [
    ...new Set(
      accounts.map((a) => a.supplier).filter((s): s is string => !!s),
    ),
  ].sort();

  function toggleSupplier(name: string) {
    setCollapsedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">渠道管理</h1>
          <p className="text-xs text-default-500 mt-0.5">
            凭据 · 余额 · 货源情况 · 点卡片底部按钮查看消费明细
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="flat"
            startContent={<RefreshCw size={14} />}
            onPress={refreshAndSyncAll}
            isLoading={busyAll}
          >
            一键刷新同步
          </Button>
          <Button color="primary" startContent={<Plus size={14} />} onPress={openNew}>
            新建
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Tabs
          aria-label="category filter"
          radius="full"
          size="sm"
          variant="solid"
          selectedKey={categoryFilter}
          onSelectionChange={(k) => setCategoryFilter(String(k))}
          classNames={{
            tabList: "bg-content2 p-1",
            cursor: "bg-content1 shadow-sm",
          }}
        >
          {[
            ...categoryList.map((c) => ({
              key: c.name,
              label: c.name,
              count: accounts.filter((a) =>
                (a.categories ?? [a.category ?? "claude"]).includes(c.name),
              ).length,
              deletable: true,
              id: c.id,
            })),
            {
              key: TAB_ALL,
              label: "全部",
              count: accounts.length,
              deletable: false,
              id: -1,
            },
          ].map((t) => (
            <Tab
              key={t.key}
              title={
                <span className="flex items-center gap-1.5">
                  {t.label}
                  <span className="text-[10px] text-default-400">{t.count}</span>
                </span>
              }
            />
          ))}
        </Tabs>
        <Button
          size="sm"
          variant="flat"
          startContent={<Plus size={12} />}
          onPress={() => newCategoryDlg.onOpen()}
        >
          新建分类
        </Button>
        {categoryFilter !== TAB_ALL && (
          <Button
            size="sm"
            variant="light"
            color="danger"
            isIconOnly
            title="删除当前分类"
            onPress={() => {
              const cat = categoryList.find((c) => c.name === categoryFilter);
              if (cat) deleteCategory(cat.id, cat.name);
            }}
          >
            <Trash2 size={13} />
          </Button>
        )}
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
        <div className="space-y-6">
          {/* 上游分组卡 — 同 supplier 的渠道聚成一张父卡, 每个渠道一行紧凑视图。
              桌面端 2 列网格, 小屏退回 1 列, 避免单卡占满整行浪费空间。 */}
          {grouped.suppliers.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {grouped.suppliers.map(([sName, channels]) => {
                const collapsed = collapsedSuppliers.has(sName);
                const totalBalance = channels.reduce(
                  (s, c) => s + (c.balance ?? 0),
                  0,
                );
                const totalToday = channels.reduce(
                  (s, c) => s + (c.todayCost ?? 0),
                  0,
                );
                const hasBalance = channels.some((c) => c.balance != null);
                const anyError = channels.some((c) => c.lastSyncError);
                return (
                  <Card
                    key={`sup:${sName}`}
                    className="bg-content1 border border-divider/50 shadow-none"
                  >
                    <CardHeader
                      className="flex justify-between items-center gap-2 pb-2 cursor-pointer"
                      onClick={() => toggleSupplier(sName)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2
                          size={16}
                          className="text-default-500 shrink-0"
                        />
                        <h3 className="font-semibold text-base truncate">
                          {sName}
                        </h3>
                        <Chip size="sm" variant="flat">
                          {channels.length} 渠道
                        </Chip>
                        {anyError && (
                          <Chip size="sm" color="danger" variant="flat">
                            部分同步失败
                          </Chip>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-xs">
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-default-500">今日合计</span>
                          <span
                            className={`font-bold ${
                              totalToday > 0
                                ? "text-foreground"
                                : "text-default-400"
                            }`}
                          >
                            ${fmtMoneyShort(totalToday)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end leading-tight">
                          <span className="flex items-center gap-1 text-default-500">
                            <Wallet size={11} /> 余额合计
                          </span>
                          <span
                            className={`font-bold ${
                              !hasBalance
                                ? "text-default-400"
                                : totalBalance > 0
                                  ? "text-success"
                                  : "text-warning"
                            }`}
                          >
                            {hasBalance
                              ? `$${fmtMoneyShort(totalBalance)}`
                              : "—"}
                          </span>
                        </div>
                        <ChevronDown
                          size={16}
                          className={`text-default-400 transition-transform ${
                            collapsed ? "" : "rotate-180"
                          }`}
                        />
                      </div>
                    </CardHeader>
                    {!collapsed && (
                      <CardBody className="pt-0 gap-1.5">
                        {channels.map((a) => (
                          <ChannelRow
                            key={a.id}
                            a={a}
                            busy={busy === a.id || busyRefresh === a.id}
                            inv={visibleInventory(a)}
                            isBest={(it) => isBestPrice(a, it)}
                            categoryFilter={categoryFilter}
                            onClickKeys={() => openKeys(a)}
                            onRefresh={() => refreshOne(a.id)}
                            onEdit={() => openEdit(a)}
                            onRemove={() => remove(a.id)}
                          />
                        ))}
                      </CardBody>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* 未分组渠道 — 按现状大卡片展示, 跟现在一模一样 */}
          {grouped.ungrouped.length > 0 && (
            <div>
              {grouped.suppliers.length > 0 && (
                <h2 className="text-sm font-semibold text-default-600 mb-3">
                  未分组渠道 ({grouped.ungrouped.length})
                </h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {grouped.ungrouped.map((a) => {
                  const inv = visibleInventory(a);
                  const isRevealed = revealed.has(a.id);
                  const accCats = channelCategories(a);
                  return (
                    <Card
                      key={a.id}
                      className="bg-content1 border border-divider/50 shadow-none"
                    >
                <CardHeader className="flex justify-between items-start gap-2 pb-2">
                  <div className="flex flex-col leading-tight min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base truncate">
                        {a.name}
                      </h3>
                      <Chip size="sm" variant="flat">
                        {a.type}
                      </Chip>
                      {accCats.map((c) => (
                        <Chip
                          key={c}
                          size="sm"
                          variant="flat"
                          color={
                            c === "claude"
                              ? "warning"
                              : c === "openai"
                                ? "success"
                                : "default"
                          }
                        >
                          {c}
                        </Chip>
                      ))}
                      {a.lastSyncError && (
                        <Chip size="sm" color="danger" variant="flat">
                          同步失败
                        </Chip>
                      )}
                    </div>
                    <span className="text-xs text-default-400 mt-0.5">
                      最后同步 {fmtDate(a.lastSyncAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-end leading-tight">
                      <div className="text-default-500 text-xs">今日消费</div>
                      <span
                        className={`font-bold ${
                          (a.todayCost ?? 0) > 0
                            ? "text-foreground"
                            : "text-default-400"
                        }`}
                      >
                        ${fmtMoneyShort(a.todayCost ?? 0)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end leading-tight">
                      <div className="flex items-center gap-1 text-default-500 text-xs">
                        <Wallet size={12} /> 余额
                      </div>
                      <span
                        className={`font-bold ${
                          a.balance == null
                            ? "text-default-400"
                            : a.balance > 0
                              ? "text-success"
                              : "text-warning"
                        }`}
                      >
                        {a.balance == null
                          ? "—"
                          : `$${fmtMoneyShort(a.balance)}`}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="flat"
                      isIconOnly
                      onPress={() => refreshOne(a.id)}
                      isLoading={busyRefresh === a.id || busy === a.id}
                      title="刷新（结构 + 用量）"
                    >
                      <RefreshCw size={14} />
                    </Button>
                  </div>
                </CardHeader>

                <CardBody className="pt-0 gap-3">
                  {/* 凭据 */}
                  <section className="rounded-lg bg-content2/50 p-2.5 space-y-1.5">
                    <CredRow
                      icon={<KeyRound size={12} />}
                      label="URL"
                      value={a.baseUrl}
                      onCopy={() => copy(a.baseUrl)}
                    />
                    <CredRow
                      icon={<Mail size={12} />}
                      label="Email"
                      value={a.email}
                      onCopy={() => copy(a.email)}
                    />
                    <CredRow
                      icon={<KeyRound size={12} />}
                      label="密码"
                      value={
                        a.password
                          ? isRevealed
                            ? a.password
                            : "•".repeat(Math.min(a.password.length, 12))
                          : "—"
                      }
                      mono
                      after={
                        a.password ? (
                          <button
                            className="text-default-400 hover:text-default-700"
                            onClick={() => toggleReveal(a.id)}
                            title={isRevealed ? "隐藏" : "显示"}
                          >
                            {isRevealed ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                        ) : null
                      }
                      onCopy={a.password ? () => copy(a.password!) : undefined}
                    />
                  </section>

                  {/* 货源 */}
                  <section>
                    <div className="flex items-center gap-1.5 text-xs text-default-500 mb-1.5">
                      <Package size={12} />
                      <span>货源</span>
                      <span className="text-default-400">{inv.length}</span>
                      {categoryFilter !== TAB_ALL && (
                        <span className="text-[10px] text-default-400">
                          · 已按 {categoryFilter} 过滤, 按价升序
                        </span>
                      )}
                    </div>
                    {inv.length === 0 ? (
                      <p className="text-xs text-default-400 italic">
                        {categoryFilter === TAB_ALL
                          ? "未填写。点编辑添加。"
                          : `当前分类 (${categoryFilter}) 下无货源`}
                      </p>
                    ) : (
                      <div className="rounded-lg overflow-hidden border border-divider/40">
                        <div className="grid grid-cols-3 gap-1 px-2.5 py-1 text-[10px] uppercase tracking-wide text-default-400 bg-content2/40">
                          <span>名称</span>
                          <span>倍率 / 价格</span>
                          <span>并发</span>
                        </div>
                        {inv.map((it, i) => {
                          const best = isBestPrice(a, it);
                          return (
                            <div
                              key={i}
                              className={
                                "grid grid-cols-3 gap-1 px-2.5 py-1.5 text-xs border-t border-divider/40 items-center " +
                                (best
                                  ? "bg-success-50/40 dark:bg-success-950/20"
                                  : "")
                              }
                              title={it.note || undefined}
                            >
                              <span className="font-medium truncate flex items-center gap-1">
                                {best && (
                                  <span
                                    className="text-[10px]"
                                    title="跨渠道同名最低价"
                                  >
                                    🏆
                                  </span>
                                )}
                                {it.name}
                              </span>
                              <span
                                className={
                                  best
                                    ? "font-semibold text-success truncate"
                                    : "font-medium truncate"
                                }
                              >
                                {it.price || (
                                  <span className="text-default-400">—</span>
                                )}
                              </span>
                              <span className="font-medium truncate">
                                {it.concurrency || (
                                  <span className="text-default-400">—</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* 备注 */}
                  {a.notes && (
                    <section className="text-xs text-default-500 whitespace-pre-wrap break-words border-l-2 border-default-200 pl-2">
                      {a.notes}
                    </section>
                  )}

                  {a.lastSyncError && (
                    <p className="text-xs text-danger break-all">
                      ⚠ {a.lastSyncError}
                    </p>
                  )}
                </CardBody>

                <CardFooter className="flex justify-between items-center gap-2 pt-0 flex-wrap">
                  <Chip
                    size="sm"
                    variant="flat"
                    className="cursor-pointer"
                    onClick={() => openKeys(a)}
                  >
                    {a._count?.keys ?? 0} keys →
                  </Chip>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      onPress={() => openEdit(a)}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      color="danger"
                      onPress={() => remove(a.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardFooter>
              </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 新建 / 编辑 对话框 (共用同一套 Tabs UI) */}
      <Modal
        isOpen={newDlg.isOpen}
        onClose={newDlg.onClose}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>新建上游账号</ModalHeader>
          <ModalBody>
            <AccountFormTabs
              tab={editTab}
              setTab={setEditTab}
              form={form}
              setForm={setForm}
              invDraft={invDraft}
              setInvDraft={setInvDraft}
              addInventoryDraft={addInventoryDraft}
              removeInventory={removeInventory}
              isNew
              supplierOptions={supplierOptions}
              categoryList={categoryList}
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

      <Modal
        isOpen={editDlg.isOpen}
        onClose={editDlg.onClose}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>编辑 · {editing?.name}</ModalHeader>
          <ModalBody>
            <AccountFormTabs
              tab={editTab}
              setTab={setEditTab}
              form={form}
              setForm={setForm}
              invDraft={invDraft}
              setInvDraft={setInvDraft}
              addInventoryDraft={addInventoryDraft}
              removeInventory={removeInventory}
              isNew={false}
              supplierOptions={supplierOptions}
              categoryList={categoryList}
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

      {/* 新建分类 */}
      <Modal
        isOpen={newCategoryDlg.isOpen}
        onClose={newCategoryDlg.onClose}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>新建渠道分类</ModalHeader>
          <ModalBody>
            <Input
              label="分类名"
              placeholder="例如 claude / windsurf"
              value={newCategoryName}
              onValueChange={setNewCategoryName}
              autoFocus
            />
            <p className="text-xs text-default-500">
              创建后 Tab 列表会立刻出现这个分类。编辑渠道/货源时即可勾选。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={newCategoryDlg.onClose}>
              取消
            </Button>
            <Button color="primary" onPress={addCategory}>
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* keys 详情 modal */}
      <Modal
        isOpen={keysDlg.isOpen}
        onClose={keysDlg.onClose}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {keysModalAccount?.name} · keys 消费
          </ModalHeader>
          <ModalBody>
            {!keysModalAccount ? null : !keys[keysModalAccount.id] ? (
              <Spinner size="sm" />
            ) : keys[keysModalAccount.id].length === 0 ? (
              <p className="text-default-500 text-sm">
                暂无 keys。先点同步或结构刷新。
              </p>
            ) : (
              (() => {
                const all = keys[keysModalAccount.id];
                // stale 的 key 它的 todayActualCost 是上次成功的旧值,
                // 不能再认为是今天的消费 → 当 0 处理。
                function effToday(k: UpstreamKey): number {
                  return k.isStale ? 0 : k.todayActualCost;
                }
                const base = showZero
                  ? all
                  : all.filter((k) => effToday(k) > 0);
                const filtered = [...base].sort(
                  (x, y) => effToday(y) - effToday(x),
                );
                const hidden = all.length - filtered.length;
                return (
                  <>
                    <div className="rounded-lg border border-divider/50 p-2.5 mb-3 flex items-center gap-2 bg-content2/30">
                      <KeyRound size={12} className="text-default-400 shrink-0" />
                      <span className="text-xs text-default-500 shrink-0">站点 URL</span>
                      <code className="font-mono text-xs flex-1 truncate" title={keysModalAccount.baseUrl}>
                        {keysModalAccount.baseUrl}
                      </code>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="flat"
                        className="h-7 min-w-7"
                        onPress={() => copy(keysModalAccount.baseUrl)}
                        title="复制 URL"
                      >
                        <Copy size={13} />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mb-2 text-xs text-default-500">
                      <Checkbox
                        size="sm"
                        isSelected={showZero}
                        onValueChange={setShowZero}
                      >
                        显示今日 0 消费的 key
                      </Checkbox>
                      {!showZero && hidden > 0 && (
                        <span>已隐藏 {hidden} 个 0 消费 key</span>
                      )}
                    </div>
                    {filtered.length === 0 ? (
                      <p className="text-default-500 text-sm">
                        没有今日有消费的 key。
                      </p>
                    ) : (
                      <Table removeWrapper aria-label="keys">
                        <TableHeader>
                          <TableColumn>名称</TableColumn>
                          <TableColumn>分组×倍率</TableColumn>
                          <TableColumn>今日</TableColumn>
                          <TableColumn>累计</TableColumn>
                          <TableColumn>充值倍率</TableColumn>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((k) => {
                            const rm = k.rechargeMultiplier ?? 1;
                            return (
                            <TableRow key={k.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-col leading-tight min-w-0">
                                    <span className="text-sm">{k.name}</span>
                                    <span className="font-mono text-xs text-default-400 truncate">
                                      {k.keyMasked}
                                    </span>
                                  </div>
                                  <Button
                                    size="sm"
                                    isIconOnly
                                    variant="light"
                                    className="h-6 min-w-6"
                                    onPress={() => copyFullKey(k.id, k.name)}
                                    title="复制完整 key"
                                    isLoading={copyingKeyId === k.id}
                                  >
                                    <Copy size={12} />
                                  </Button>
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
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span
                                    className={`font-medium ${k.isStale ? "text-default-400" : ""}`}
                                  >
                                    {fmtMoneyShort(effToday(k) * rm)}
                                  </span>
                                  {k.isStale ? (
                                    <span
                                      className="text-[10px] text-warning"
                                      title={`上次同步 ${k.lastUpdatedAt ? new Date(k.lastUpdatedAt).toLocaleString("zh-CN") : "—"} 时为 ${fmtMoneyShort(k.todayActualCost * rm)}`}
                                    >
                                      ⚠ 数据过期(同步失败)
                                    </span>
                                  ) : rm !== 1 ? (
                                    <span className="text-[10px] text-default-400">
                                      面值 {fmtMoneyShort(k.todayActualCost)}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="text-default-700">
                                    {fmtMoneyShort(k.totalActualCost * rm)}
                                  </span>
                                  {rm !== 1 && (
                                    <span className="text-[10px] text-default-400">
                                      面值 {fmtMoneyShort(k.totalActualCost)}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <RechargeMultiplierEditor
                                  keyId={k.id}
                                  initial={rm}
                                  onSaved={(v) => {
                                    setKeys((prev) => ({
                                      ...prev,
                                      [keysModalAccount!.id]: (
                                        prev[keysModalAccount!.id] ?? []
                                      ).map((row) =>
                                        row.id === k.id
                                          ? { ...row, rechargeMultiplier: v }
                                          : row,
                                      ),
                                    }));
                                  }}
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
              })()
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              size="sm"
              variant="flat"
              onPress={() =>
                keysModalAccount && syncOne(keysModalAccount.id)
              }
              isLoading={busy === keysModalAccount?.id}
            >
              同步用量
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={() =>
                keysModalAccount && refreshOne(keysModalAccount.id)
              }
              isLoading={busyRefresh === keysModalAccount?.id}
            >
              结构刷新
            </Button>
            <Button variant="flat" onPress={keysDlg.onClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Shell>
  );
}

// 上游分组卡里的一行紧凑渠道. 点行打开 keys 弹窗(最常见操作);
// 右侧 icon 按钮 stopPropagation 不冒泡到行 onClick。
function ChannelRow({
  a,
  busy,
  inv,
  isBest,
  categoryFilter,
  onClickKeys,
  onRefresh,
  onEdit,
  onRemove,
}: {
  a: UpstreamAccount;
  busy: boolean;
  inv: InventoryItem[]; // 已过滤 + 按价升序
  isBest: (it: InventoryItem) => boolean;
  categoryFilter: string;
  onClickKeys: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const cats =
    a.categories && a.categories.length > 0
      ? a.categories
      : [a.category ?? "claude"];
  return (
    <div
      className="flex flex-col gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-content2/60 cursor-pointer border border-divider/30"
      onClick={onClickKeys}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          <span className="font-medium text-sm truncate">{a.name}</span>
          <Chip size="sm" variant="flat" classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}>
            {a.type}
          </Chip>
          {cats.map((c) => (
            <Chip
              key={c}
              size="sm"
              variant="flat"
              color={c === "claude" ? "warning" : c === "openai" ? "success" : "default"}
              classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}
            >
              {c}
            </Chip>
          ))}
          {a.lastSyncError && (
            <Chip
              size="sm"
              color="danger"
              variant="flat"
              classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}
              title={a.lastSyncError}
            >
              ⚠ 同步失败
            </Chip>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 text-xs">
          <div className="flex flex-col items-end leading-tight w-16">
            <span className="text-default-400">今日</span>
            <span
              className={
                (a.todayCost ?? 0) > 0 ? "font-semibold tabular-nums" : "text-default-400 tabular-nums"
              }
            >
              ${fmtMoneyShort(a.todayCost ?? 0)}
            </span>
          </div>
          <div className="flex flex-col items-end leading-tight w-20">
            <span className="text-default-400">余额</span>
            <span
              className={`font-semibold tabular-nums ${
                a.balance == null
                  ? "text-default-400"
                  : a.balance > 0
                    ? "text-success"
                    : "text-warning"
              }`}
            >
              {a.balance == null ? "—" : `$${fmtMoneyShort(a.balance)}`}
            </span>
          </div>
          <span className="text-default-400 hidden md:inline">
            {a._count?.keys ?? 0} keys
          </span>
          <div
            className="flex gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant="light"
              isIconOnly
              className="h-7 min-w-7"
              onPress={onRefresh}
              isLoading={busy}
              title="刷新+同步"
            >
              <RefreshCw size={13} />
            </Button>
            <Button
              size="sm"
              variant="light"
              isIconOnly
              className="h-7 min-w-7"
              onPress={onEdit}
              title="编辑"
            >
              <Pencil size={13} />
            </Button>
            <Button
              size="sm"
              variant="light"
              isIconOnly
              color="danger"
              className="h-7 min-w-7"
              onPress={onRemove}
              title="删除"
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      </div>
      {/* 货源 — 已按当前 Tab 过滤 + 价升序 + 跨渠道最低价 🏆 标记 */}
      {inv.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1">
          {inv.map((it, i) => {
            const best = isBest(it);
            return (
              <span
                key={i}
                className={
                  "text-[10px] px-1.5 py-0.5 rounded border " +
                  (best
                    ? "bg-success-50 border-success-300 dark:bg-success-950/30"
                    : "bg-content2/60 border-divider/60")
                }
                title={it.note || undefined}
                onClick={(e) => e.stopPropagation()}
              >
                {best && "🏆 "}
                <b>{it.name}</b>{" "}
                <span className={best ? "text-success font-semibold" : "text-default-500"}>
                  {it.price || "—"}
                </span>
                {it.concurrency && (
                  <span className="text-default-400"> · {it.concurrency}并发</span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {inv.length === 0 && categoryFilter !== TAB_ALL && (
        <div className="text-[10px] text-default-400 pl-1">
          当前分类 ({categoryFilter}) 下无货源
        </div>
      )}
    </div>
  );
}

function RechargeMultiplierEditor({
  keyId,
  initial,
  onSaved,
}: {
  keyId: number;
  initial: number;
  onSaved: (v: number) => void;
}) {
  const [val, setVal] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const dirty = Number(val) !== initial && !isNaN(Number(val));
  return (
    <div className="flex items-center gap-1">
      <Input
        size="sm"
        type="number"
        value={val}
        onValueChange={setVal}
        classNames={{ inputWrapper: "h-7 min-h-7 w-20" }}
        step={0.01}
        min={0}
      />
      {dirty && (
        <Button
          size="sm"
          variant="flat"
          color="primary"
          isLoading={busy}
          className="h-7 min-w-0 px-2"
          onPress={async () => {
            const n = Number(val);
            if (!Number.isFinite(n) || n < 0) return;
            setBusy(true);
            try {
              const res = await fetch(`/api/upstream/key/${keyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rechargeMultiplier: n }),
              });
              if (!res.ok) {
                addToast({ title: "保存失败", color: "danger" });
                return;
              }
              addToast({ title: "已保存", color: "success" });
              onSaved(n);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存
        </Button>
      )}
    </div>
  );
}

function CredRow({
  icon,
  label,
  value,
  mono,
  after,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  after?: React.ReactNode;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-default-400 flex items-center gap-1 w-12 shrink-0">
        {icon}
        {label}
      </span>
      <span
        className={`flex-1 truncate ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </span>
      {after}
      {onCopy && (
        <button
          className="text-default-400 hover:text-default-700"
          onClick={onCopy}
          title="复制"
        >
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

function AccountFormTabs({
  tab,
  setTab,
  form,
  setForm,
  invDraft,
  setInvDraft,
  addInventoryDraft,
  removeInventory,
  isNew,
  supplierOptions,
  categoryList,
}: {
  tab: string;
  setTab: (v: string) => void;
  form: {
    name: string;
    type: string;
    categories: string[];
    supplier: string;
    baseUrl: string;
    email: string;
    password: string;
    accessToken: string;
    notes: string;
    inventory: InventoryItem[];
  };
  setForm: (
    f: (prev: {
      name: string;
      type: string;
      categories: string[];
      supplier: string;
      baseUrl: string;
      email: string;
      password: string;
      accessToken: string;
      notes: string;
      inventory: InventoryItem[];
    }) => {
      name: string;
      type: string;
      categories: string[];
      supplier: string;
      baseUrl: string;
      email: string;
      password: string;
      accessToken: string;
      notes: string;
      inventory: InventoryItem[];
    },
  ) => void;
  supplierOptions: string[];
  invDraft: InventoryItem;
  setInvDraft: (v: InventoryItem) => void;
  addInventoryDraft: () => void;
  removeInventory: (i: number) => void;
  isNew: boolean;
  categoryList: UpstreamCategory[];
}) {
  function toggleCategory(name: string) {
    setForm((f) => {
      const has = f.categories.includes(name);
      const next = has
        ? f.categories.filter((c) => c !== name)
        : [...f.categories, name];
      return { ...f, categories: next };
    });
  }
  function toggleInventoryCategory(idx: number, name: string) {
    setForm((f) => {
      const list = f.inventory.slice();
      const it = { ...list[idx] };
      const cur = it.categories ?? [];
      it.categories = cur.includes(name)
        ? cur.filter((c) => c !== name)
        : [...cur, name];
      list[idx] = it;
      return { ...f, inventory: list };
    });
  }
  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={(k) => setTab(String(k))}
      variant="underlined"
      classNames={{ tabList: "px-0" }}
    >
      <Tab key="inventory" title="货源">
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-12 gap-2 items-end">
            <Input
              size="sm"
              label="名称"
              placeholder="Claude Sonnet"
              className="col-span-3"
              value={invDraft.name}
              onValueChange={(v) =>
                setInvDraft({ ...invDraft, name: v })
              }
            />
            <Input
              size="sm"
              label="价格"
              placeholder="$5/M"
              className="col-span-3"
              value={invDraft.price ?? ""}
              onValueChange={(v) =>
                setInvDraft({ ...invDraft, price: v })
              }
            />
            <Input
              size="sm"
              label="并发"
              placeholder="100"
              className="col-span-2"
              value={invDraft.concurrency ?? ""}
              onValueChange={(v) =>
                setInvDraft({ ...invDraft, concurrency: v })
              }
            />
            <Input
              size="sm"
              label="备注"
              placeholder="可选"
              className="col-span-3"
              value={invDraft.note ?? ""}
              onValueChange={(v) => setInvDraft({ ...invDraft, note: v })}
            />
            <Button
              size="sm"
              color="primary"
              variant="flat"
              isIconOnly
              className="col-span-1"
              onPress={addInventoryDraft}
              isDisabled={!invDraft.name.trim()}
            >
              <Plus size={14} />
            </Button>
          </div>
          {invDraft.name.trim() && (
            <p className="text-xs text-warning">
              ⚠ 上方有未添加的草稿「{invDraft.name}」，点 + 添加；保存时也会自动加入
            </p>
          )}
          {form.inventory.length === 0 ? (
            <p className="text-xs text-default-400 italic">
              未添加货源。填上面的输入框 + 点 + 添加。
            </p>
          ) : (
            <div className="space-y-2">
              {form.inventory.map((it, i) => {
                const itemCats = it.categories ?? [];
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-divider/50 p-2.5 bg-content2/30"
                  >
                    <div className="flex items-start gap-2 justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{it.name}</div>
                        <div className="text-xs text-default-500 mt-0.5">
                          价格 <b>{it.price || "—"}</b> · 并发{" "}
                          <b>{it.concurrency || "—"}</b>
                          {it.note && (
                            <span className="text-default-400">
                              {" "}
                              · {it.note}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="light"
                        isIconOnly
                        color="danger"
                        onPress={() => removeInventory(i)}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                    {/* 该货源所属分类: 候选 = 渠道勾选的分类 (form.categories);
                        缺省/不勾 = 继承渠道全部分类 */}
                    {form.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-[10px] text-default-400 self-center">
                          属于分类:
                        </span>
                        {form.categories.map((c) => {
                          const on = itemCats.includes(c);
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => toggleInventoryCategory(i, c)}
                              className={
                                "px-1.5 py-0.5 rounded text-[10px] border transition-colors " +
                                (on
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-content2/60 border-divider/60 hover:bg-content2")
                              }
                            >
                              {on ? "✓ " : ""}
                              {c}
                            </button>
                          );
                        })}
                        {itemCats.length === 0 && (
                          <span className="text-[10px] text-default-400 self-center">
                            (空 = 继承渠道全部分类)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Tab>
      <Tab key="creds" title="凭据">
        <div className="space-y-3 pt-2">
          <Input
            label="名称"
            value={form.name}
            onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          {isNew && (
            <Select
              label="类型"
              selectedKeys={new Set([form.type])}
              onSelectionChange={(k) =>
                setForm((f) => ({
                  ...f,
                  type: Array.from(k as Set<string>)[0] ?? "sub2api",
                }))
              }
            >
              <SelectItem key="sub2api">sub2api</SelectItem>
              <SelectItem key="newapi">newapi</SelectItem>
            </Select>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-default-500">
              分类(可多选 · 决定渠道在管理页的 Tab 归属, 不影响定价/同步)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {categoryList.length === 0 ? (
                <span className="text-xs text-default-400">
                  还没有任何分类, 关闭对话框后点页面顶部"新建分类"先创建。
                </span>
              ) : (
                categoryList.map((c) => {
                  const checked = form.categories.includes(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.name)}
                      className={
                        "px-2.5 py-1 rounded-full text-xs border transition-colors " +
                        (checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-content2/60 border-divider/60 hover:bg-content2")
                      }
                    >
                      {checked ? "✓ " : ""}
                      {c.name}
                    </button>
                  );
                })
              )}
            </div>
            {form.categories.length === 0 && categoryList.length > 0 && (
              <span className="text-[11px] text-warning">
                ⚠ 没勾任何分类, 这个渠道不会出现在任何 Tab 里
              </span>
            )}
          </div>
          <Autocomplete
            label="上游/货源 (可选)"
            description="同名 supplier 在管理页会聚成一张卡。留空 = 散户渠道。已有的可从下拉选,也可手填新名。"
            allowsCustomValue
            // 控制为受控: defaultItems + onInputChange/onSelectionChange 配合
            // (heroui Autocomplete 在 selectedKey + 自定义 value 模式下容易状态打架,
            // 这里只用 inputValue + 推荐 items, 写 form.supplier 由 onInputChange 统一处理)
            inputValue={form.supplier}
            onInputChange={(v) =>
              setForm((f) => ({ ...f, supplier: v }))
            }
            defaultItems={supplierOptions.map((s) => ({ key: s, label: s }))}
          >
            {(item) => (
              <AutocompleteItem key={item.key}>{item.label}</AutocompleteItem>
            )}
          </Autocomplete>
          <Input
            label="Base URL"
            placeholder="http://1.2.3.4:8080"
            value={form.baseUrl}
            onValueChange={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
          />
          <Input
            label="Email / 用户名"
            description="newapi 的话填用户名（不是邮箱），sub2api 填邮箱"
            value={form.email}
            onValueChange={(v) => setForm((f) => ({ ...f, email: v }))}
          />
          <Input
            label={isNew ? "密码" : "新密码（留空则不修改）"}
            type="password"
            value={form.password}
            onValueChange={(v) => setForm((f) => ({ ...f, password: v }))}
          />
          <Input
            label={
              isNew
                ? "Access Token（可选，跳过登录）"
                : "Access Token（留空则不修改）"
            }
            description="粘贴手动登录获取的 token，sub2api 渠道有 cf 盾时可绕过登录。token 过期后会自动尝试用上面的账号密码 relogin；只填 token 没填账号密码则会报错，需手动更新。"
            type="password"
            value={form.accessToken}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, accessToken: v }))
            }
          />
        </div>
      </Tab>
      <Tab key="notes" title="备注">
        <div className="pt-2">
          <Textarea
            label="备注"
            description="续费提醒、合同细节、联系人等。无格式要求"
            minRows={6}
            value={form.notes}
            onValueChange={(v) => setForm((f) => ({ ...f, notes: v }))}
          />
        </div>
      </Tab>
    </Tabs>
  );
}
