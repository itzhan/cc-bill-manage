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
  Bell,
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
  const [benchPushingKeyId, setBenchPushingKeyId] = useState<number | null>(null);

  const newDlg = useDisclosure();
  const editDlg = useDisclosure();
  const keysDlg = useDisclosure();
  const balanceAlertDlg = useDisclosure();
  const importSkAntDlg = useDisclosure();
  const groupPresetDlg = useDisclosure();
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
  const [categoryFilter, setCategoryFilter] = useState<string>(TAB_ALL);
  // 用户自定义的分类列表 — 决定 Tab 显示
  const [categoryList, setCategoryList] = useState<UpstreamCategory[]>([]);
  // 新增分类对话框
  const [newCategoryName, setNewCategoryName] = useState("");
  const newCategoryDlg = useDisclosure();
  const [invDraft, setInvDraft] = useState<InventoryItem>({
    name: "",
    price: "",
    note: "",
  });
  // "→ 货源" 弹窗状态
  const [pushInvKey, setPushInvKey] = useState<UpstreamKey | null>(null);
  const [pushInvCats, setPushInvCats] = useState<string[]>([]);
  const [pushInvBusy, setPushInvBusy] = useState(false);
  // "→ 本站" 弹窗状态. type 始终 apikey 不暴露; platform 用下拉
  // (anthropic/openai/gemini), gemini 时多一个 tier_id 字段。
  const [pushSiteKey, setPushSiteKey] = useState<UpstreamKey | null>(null);
  const [pushSiteForm, setPushSiteForm] = useState({
    siteAccountId: "",
    name: "",
    groupIds: "",
    concurrency: "10",
    priority: "1",
    rateMultiplier: "",
    platform: "anthropic",
    geminiTier: "aistudio_paid", // 仅 platform=gemini 时生效
  });
  const [pushSiteBusy, setPushSiteBusy] = useState(false);
  const [siteAccounts, setSiteAccounts] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [siteGroups, setSiteGroups] = useState<
    Array<{ id: number; name: string; rate_multiplier: number }>
  >([]);
  const [loadingSiteGroups, setLoadingSiteGroups] = useState(false);

  // === 批量"加到本站": keys 弹窗内多选 + 模板复用 ===
  // selectedKeyIds 跟当前打开的渠道 keys 弹窗强相关, 关弹窗 / 切渠道清空
  const [selectedKeyIds, setSelectedKeyIds] = useState<Set<number>>(new Set());
  const [bulkPushOpen, setBulkPushOpen] = useState(false);
  const [bulkPushBusy, setBulkPushBusy] = useState(false);
  const [bulkPushForm, setBulkPushForm] = useState({
    siteAccountId: "",
    templateRemoteAccountId: "",
    namePrefix: "",
    nameSuffix: "",
  });
  // 模板候选: 选定 site 后从 /api/site/[id]/accounts 拉 SiteBoundAccount 列表
  // (这些就是 sub2api 上的 admin account)。
  const [templateAccounts, setTemplateAccounts] = useState<
    Array<{ id: number; remoteAccountId: number; name: string }>
  >([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

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
    if (!confirm(`删除分类 "${name}"?\n各渠道下货源条目里勾过这个分类的会变成"无分类",该 Tab 也会消失。`)) {
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

  // "→ 货源": 把当前 key 写到所在渠道的 inventory JSON 里。
  // 名字用 key.name, 价格用 "×{effectiveRateMultiplier}" (priceNumeric 能抓出
  // 数字用于跨渠道比价)。
  function openPushToInventory(k: UpstreamKey) {
    setPushInvKey(k);
    // 默认勾选当前 Tab (如果不是"全部"); 否则空, 让用户自己挑
    const initial =
      categoryFilter === TAB_ALL || !categoryFilter ? [] : [categoryFilter];
    setPushInvCats(initial);
  }
  async function submitPushToInventory() {
    if (!pushInvKey || !keysModalAccount) return;
    setPushInvBusy(true);
    try {
      const currentInv = parseInventory(keysModalAccount.inventory);
      const newItem: InventoryItem = {
        name: pushInvKey.name,
        price: `×${pushInvKey.effectiveRateMultiplier}`,
        categories: pushInvCats.length > 0 ? pushInvCats : undefined,
        note: pushInvKey.hasExclusiveRate
          ? `专属倍率 · ${pushInvKey.groupName}`
          : pushInvKey.groupName,
      };
      const nextInv = [...currentInv, newItem];
      const res = await fetch(`/api/upstream/${keysModalAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory: JSON.stringify(nextInv) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast({ title: "加入失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已加入货源", color: "success" });
      setPushInvKey(null);
      await load();
      // keysModalAccount 是引用旧 state, 在 load 后我们要更新它
      // 但保留弹窗打开 — 让用户继续看 keys
    } finally {
      setPushInvBusy(false);
    }
  }

  // "→ 本站": 打开弹窗前先拉取 SiteAccount 列表
  async function openPushToSite(k: UpstreamKey) {
    setPushSiteKey(k);
    setPushSiteForm((f) => ({
      ...f,
      name: k.name,
      rateMultiplier: String(k.effectiveRateMultiplier),
      groupIds: "",
    }));
    setSiteGroups([]);
    try {
      const r = await fetch("/api/site", { cache: "no-store" });
      const j = await r.json();
      setSiteAccounts(
        (j.items ?? []).map(
          (s: { id: number; name: string }) => ({ id: s.id, name: s.name }),
        ),
      );
    } catch (e) {
      addToast({
        title: "加载站点列表失败",
        description: String(e),
        color: "danger",
      });
    }
  }
  // === 批量 push 相关 helpers ===
  function toggleKeySelect(id: number) {
    setSelectedKeyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openBulkPushDialog() {
    if (selectedKeyIds.size === 0) {
      addToast({ title: "请先勾选 key", color: "warning" });
      return;
    }
    // 复用 pushSite 的 site 列表加载逻辑(同一份数据)。
    try {
      const r = await fetch("/api/site", { cache: "no-store" });
      const j = await r.json();
      setSiteAccounts(
        (j.items ?? []).map(
          (s: { id: number; name: string }) => ({ id: s.id, name: s.name }),
        ),
      );
    } catch (e) {
      addToast({
        title: "加载站点列表失败",
        description: String(e),
        color: "danger",
      });
      return;
    }
    setTemplateAccounts([]);
    setBulkPushForm({
      siteAccountId: "",
      templateRemoteAccountId: "",
      namePrefix: "",
      nameSuffix: "",
    });
    setBulkPushOpen(true);
  }

  async function loadTemplateAccounts(siteId: number) {
    if (!siteId) return;
    setLoadingTemplates(true);
    try {
      const r = await fetch(`/api/site/${siteId}/accounts`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      const items = (j.items ?? []) as Array<{
        id: number;
        remoteAccountId: number;
        name: string;
      }>;
      // 按名字排序方便用户找
      items.sort((a, b) => a.name.localeCompare(b.name));
      setTemplateAccounts(items);
    } catch (e) {
      addToast({
        title: "加载模板账号失败",
        description: String(e),
        color: "danger",
      });
      setTemplateAccounts([]);
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function submitBulkPush() {
    const siteAccountId = Number(bulkPushForm.siteAccountId);
    const templateRemoteAccountId = Number(
      bulkPushForm.templateRemoteAccountId,
    );
    if (!siteAccountId) {
      addToast({ title: "请选择目标站点", color: "warning" });
      return;
    }
    if (!templateRemoteAccountId) {
      addToast({ title: "请选择模板账号", color: "warning" });
      return;
    }
    if (selectedKeyIds.size === 0) {
      addToast({ title: "未选中 key", color: "warning" });
      return;
    }
    setBulkPushBusy(true);
    try {
      const res = await fetch("/api/upstream/keys/bulk-push-to-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upstreamKeyIds: Array.from(selectedKeyIds),
          siteAccountId,
          templateRemoteAccountId,
          namePrefix: bulkPushForm.namePrefix,
          nameSuffix: bulkPushForm.nameSuffix,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast({
          title: "批量推送失败",
          description: String(j.error || res.status),
          color: "danger",
        });
        return;
      }
      const failedRows = (j.results ?? []).filter(
        (r: { ok: boolean }) => !r.ok,
      );
      if (failedRows.length > 0) {
        addToast({
          title: `成功 ${j.success} / 共 ${j.total}, 失败 ${j.failed}`,
          description: failedRows
            .slice(0, 3)
            .map(
              (r: { keyName: string; error?: string }) =>
                `${r.keyName}: ${r.error}`,
            )
            .join("; "),
          color: "warning",
        });
      } else {
        addToast({
          title: `已批量推送 ${j.success} 个 key`,
          color: "success",
        });
      }
      setSelectedKeyIds(new Set());
      setBulkPushOpen(false);
      if (keysModalAccount) await loadKeys(keysModalAccount.id);
    } finally {
      setBulkPushBusy(false);
    }
  }

  async function loadSiteGroups(siteId: number) {
    if (!siteId) return;
    setLoadingSiteGroups(true);
    try {
      const r = await fetch(`/api/site/${siteId}/groups`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setSiteGroups(j.items ?? []);
    } catch (e) {
      addToast({
        title: "加载分组失败",
        description: String(e),
        color: "danger",
      });
      setSiteGroups([]);
    } finally {
      setLoadingSiteGroups(false);
    }
  }
  async function submitPushToSite() {
    if (!pushSiteKey) return;
    const siteId = Number(pushSiteForm.siteAccountId);
    const concurrency = Number(pushSiteForm.concurrency);
    const priority = Number(pushSiteForm.priority);
    const rateMultiplier = Number(pushSiteForm.rateMultiplier);
    const groupIds = pushSiteForm.groupIds
      .split(/[,，]/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!siteId) {
      addToast({ title: "请选择目标站点账号", color: "warning" });
      return;
    }
    if (!pushSiteForm.name.trim()) {
      addToast({ title: "请填账号名称", color: "warning" });
      return;
    }
    if (groupIds.length === 0) {
      addToast({ title: "至少勾一个分组", color: "warning" });
      return;
    }
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      addToast({ title: "并发非法", color: "warning" });
      return;
    }
    if (!Number.isFinite(rateMultiplier) || rateMultiplier <= 0) {
      addToast({ title: "倍率非法", color: "warning" });
      return;
    }
    if (!Number.isFinite(priority) || priority < 0) {
      addToast({ title: "优先级非法", color: "warning" });
      return;
    }
    setPushSiteBusy(true);
    try {
      const res = await fetch(
        `/api/upstream/key/${pushSiteKey.id}/push-to-site`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteAccountId: siteId,
            name: pushSiteForm.name.trim(),
            groupIds,
            concurrency,
            priority,
            rateMultiplier,
            platform: pushSiteForm.platform || "anthropic",
            // type 始终 apikey, sub2api API 里 type 必填
            type: "apikey",
            geminiTier:
              pushSiteForm.platform === "gemini"
                ? pushSiteForm.geminiTier
                : undefined,
          }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast({
          title: "推送失败",
          description: j.error,
          color: "danger",
        });
        return;
      }
      addToast({
        title: `已创建账号 + binding (#${j.remoteAccountId})`,
        color: "success",
      });
      setPushSiteKey(null);
    } finally {
      setPushSiteBusy(false);
    }
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
    setForm({
      name: "",
      type: "sub2api",
      categories: [], // 渠道无分类, 提交空数组
      supplier: "",
      baseUrl: "",
      email: "",
      password: "",
      accessToken: "",
      notes: "",
      inventory: [],
    });
    setInvDraft({ name: "", price: "", note: "" });
    setEditTab("creds");
    newDlg.onOpen();
  }
  function openEdit(a: UpstreamAccount) {
    setEditing(a);
    setForm({
      name: a.name,
      type: a.type,
      categories: [], // 渠道无分类
      supplier: a.supplier ?? "",
      baseUrl: a.baseUrl,
      email: a.email,
      password: "",
      accessToken: "",
      notes: a.notes ?? "",
      inventory: parseInventory(a.inventory),
    });
    setInvDraft({ name: "", price: "", note: "" });
    setEditTab("inventory");
    editDlg.onOpen();
  }

  function openKeys(a: UpstreamAccount) {
    setKeysModalAccount(a);
    setSelectedKeyIds(new Set()); // 切换渠道时清空选择, 避免误带入
    keysDlg.onOpen();
    if (!keys[a.id]) loadKeys(a.id);
  }

  function addInventoryDraft() {
    if (!invDraft.name.trim()) return;
    setForm((f) => ({ ...f, inventory: [...f.inventory, { ...invDraft }] }));
    setInvDraft({ name: "", price: "", note: "" });
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

  // 一键把 UpstreamKey 推到 /bench(智商测试) 的 BenchChannel + Key 表。
  // 后端按 baseUrl 复用 channel, 按 (channelId, apiKey) 去重 key, 已存在不报错。
  async function pushKeyToBench(keyId: number, name: string) {
    setBenchPushingKeyId(keyId);
    try {
      const res = await fetch(`/api/bench/import-upstream-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamKeyId: keyId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast({
          title: "添加到智测失败",
          description: String(j.error || res.status),
          color: "danger",
        });
        return;
      }
      const parts: string[] = [];
      if (j.channelCreated) parts.push("已新建渠道");
      else parts.push("复用已有渠道");
      if (j.keyCreated) parts.push("已新建 key");
      else parts.push("key 已存在");
      addToast({
        title: `${name} 已加入智测`,
        description: parts.join(" · "),
        color: "success",
      });
    } finally {
      setBenchPushingKeyId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 分类只属于货源条目, 渠道本身不再带分类。Tab 过滤逻辑:
  //   - 全部 tab: 所有渠道都显示, 所有货源都展示
  //   - 某分类 tab: 渠道有至少 1 条 inventory item 命中此分类才显示;
  //                 该渠道的货源段也只展示命中此分类的条目
  //   - 货源条目分类规则: it.categories 包含此 tab → 命中;
  //                       it.categories 空 → 只在 "全部" tab 显示
  function inventoryMatchesTab(it: InventoryItem): boolean {
    if (categoryFilter === TAB_ALL) return true;
    const cats = it.categories ?? [];
    return cats.includes(categoryFilter);
  }
  const filteredAccounts = accounts.filter((a) => {
    if (categoryFilter === TAB_ALL) return true;
    const inv = parseInventory(a.inventory);
    return inv.some(inventoryMatchesTab);
  });
  // 当前 Tab 下"同名货源最低价"映射: name(lowercase) → {accountId, price}
  // 同 Tab 下显示的所有渠道里, 对每个 inventory 名字找最低价 (按 priceNumeric)。
  // 该 (name, accountId) 在渲染时拿到 🏆 最低价 标识。
  const bestPriceByName = (() => {
    type Best = { accountId: number; numeric: number };
    const m = new Map<string, Best>();
    for (const a of filteredAccounts) {
      const inv = parseInventory(a.inventory);
      for (const it of inv) {
        if (!inventoryMatchesTab(it)) continue;
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
    const filtered = inv.filter(inventoryMatchesTab);
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
            startContent={<Bell size={14} />}
            onPress={() => balanceAlertDlg.onOpen()}
          >
            余额提醒
          </Button>
          <Button
            variant="flat"
            startContent={<Package size={14} />}
            onPress={() => groupPresetDlg.onOpen()}
            title="按本站分组维护可复用的分组集合, 录入 sk-ant / 推到本站时一键套用"
          >
            分组预设
          </Button>
          <Button
            variant="flat"
            startContent={<KeyRound size={14} />}
            onPress={() => importSkAntDlg.onOpen()}
          >
            批量录入 sk-ant
          </Button>
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

      <BalanceAlertModal
        isOpen={balanceAlertDlg.isOpen}
        onOpenChange={balanceAlertDlg.onOpenChange}
      />
      <ImportSkAntModal
        isOpen={importSkAntDlg.isOpen}
        onOpenChange={importSkAntDlg.onOpenChange}
      />
      <GroupPresetsModal
        isOpen={groupPresetDlg.isOpen}
        onOpenChange={groupPresetDlg.onOpenChange}
      />

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
              // 渠道数 = 至少有一条货源属于该分类的渠道数
              count: accounts.filter((a) =>
                parseInventory(a.inventory).some((it) =>
                  (it.categories ?? []).includes(c.name),
                ),
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
          新建货源分类
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
                        <div className="grid grid-cols-2 gap-1 px-2.5 py-1 text-[10px] uppercase tracking-wide text-default-400 bg-content2/40">
                          <span>名称</span>
                          <span>倍率 / 价格</span>
                        </div>
                        {inv.map((it, i) => {
                          const best = isBestPrice(a, it);
                          return (
                            <div
                              key={i}
                              className={
                                "grid grid-cols-2 gap-1 px-2.5 py-1.5 text-xs border-t border-divider/40 items-center " +
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

      {/* 新建货源分类 */}
      <Modal
        isOpen={newCategoryDlg.isOpen}
        onClose={newCategoryDlg.onClose}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>新建货源分类</ModalHeader>
          <ModalBody>
            <Input
              label="分类名"
              placeholder="例如 claude / openai / windsurf / kiro"
              value={newCategoryName}
              onValueChange={setNewCategoryName}
              autoFocus
            />
            <p className="text-xs text-default-500">
              创建后 Tab 列表会立刻出现这个分类。编辑某条货源时勾选它属于这个
              分类, 切到该 Tab 就只看到属于此分类的货源。
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
                      <>
                      {/* 批量推到本站工具条 - 仅在勾了至少 1 个 key 时露出。
                          选中后弹模板选择窗, 新建账号复用模板配置, 一次性创建+建 binding。 */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap text-[11px]">
                        <Checkbox
                          size="sm"
                          isSelected={
                            selectedKeyIds.size > 0 &&
                            filtered.every((k) => selectedKeyIds.has(k.id))
                          }
                          isIndeterminate={
                            selectedKeyIds.size > 0 &&
                            !filtered.every((k) => selectedKeyIds.has(k.id))
                          }
                          onValueChange={(v) => {
                            if (v) {
                              setSelectedKeyIds(new Set(filtered.map((k) => k.id)));
                            } else {
                              setSelectedKeyIds(new Set());
                            }
                          }}
                        >
                          <span className="text-[11px]">
                            {selectedKeyIds.size > 0
                              ? `已选 ${selectedKeyIds.size}`
                              : "全选"}
                          </span>
                        </Checkbox>
                        {selectedKeyIds.size > 0 && (
                          <>
                            <Button
                              size="sm"
                              color="primary"
                              variant="flat"
                              className="h-6 px-2 min-w-0 text-[11px]"
                              onPress={openBulkPushDialog}
                            >
                              批量加到本站(用模板配置)
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              className="h-6 px-2 min-w-0 text-[11px]"
                              onPress={() => setSelectedKeyIds(new Set())}
                            >
                              取消选择
                            </Button>
                          </>
                        )}
                      </div>
                      <Table removeWrapper aria-label="keys">
                        <TableHeader>
                          <TableColumn>{" "}</TableColumn>
                          <TableColumn>名称</TableColumn>
                          <TableColumn>分组×倍率</TableColumn>
                          <TableColumn>今日</TableColumn>
                          <TableColumn>累计</TableColumn>
                          <TableColumn>充值倍率</TableColumn>
                          <TableColumn>操作</TableColumn>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((k) => {
                            const rm = k.rechargeMultiplier ?? 1;
                            return (
                            <TableRow key={k.id}>
                              <TableCell className="w-8">
                                <Checkbox
                                  size="sm"
                                  isSelected={selectedKeyIds.has(k.id)}
                                  onValueChange={() => toggleKeySelect(k.id)}
                                />
                              </TableCell>
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
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="flat"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onPress={() => openPushToInventory(k)}
                                    title="加入到此渠道的货源(选分类)"
                                  >
                                    → 货源
                                  </Button>
                                  <Button
                                    size="sm"
                                    color="primary"
                                    variant="flat"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onPress={() => openPushToSite(k)}
                                    title="一键添加到本站(创建账号+建绑定)"
                                  >
                                    → 本站
                                  </Button>
                                  <Button
                                    size="sm"
                                    color="secondary"
                                    variant="flat"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onPress={() => pushKeyToBench(k.id, k.name)}
                                    isLoading={benchPushingKeyId === k.id}
                                    title="一键加入智商测试(自动复用 baseUrl, 同 key 不重复)"
                                  >
                                    → 智测
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      </>
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

      {/* "→ 货源" 弹窗: 把 key 加进所在渠道 inventory + 选分类 */}
      <Modal
        isOpen={pushInvKey !== null}
        onClose={() => setPushInvKey(null)}
        size="md"
      >
        <ModalContent>
          <ModalHeader>
            将 key 加入货源 · {pushInvKey?.name}
          </ModalHeader>
          <ModalBody>
            <p className="text-xs text-default-500">
              这条货源将以 <b>{pushInvKey?.name}</b> 为名,价格用{" "}
              <b>×{pushInvKey?.effectiveRateMultiplier}</b> (跨渠道比价用),
              备注自动填 {pushInvKey?.groupName}。
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-default-500">所属分类(可多选)</span>
              <div className="flex flex-wrap gap-1.5">
                {categoryList.length === 0 ? (
                  <span className="text-xs text-default-400">
                    还没有分类, 关闭后去顶部"新建分类"
                  </span>
                ) : (
                  categoryList.map((c) => {
                    const on = pushInvCats.includes(c.name);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setPushInvCats((cur) =>
                            cur.includes(c.name)
                              ? cur.filter((x) => x !== c.name)
                              : [...cur, c.name],
                          )
                        }
                        className={
                          "px-2.5 py-1 rounded-full text-xs border " +
                          (on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-content2/60 border-divider/60")
                        }
                      >
                        {on ? "✓ " : ""}
                        {c.name}
                      </button>
                    );
                  })
                )}
              </div>
              {pushInvCats.length === 0 && (
                <span className="text-[11px] text-default-400">
                  留空 = 继承所在渠道的全部分类
                </span>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setPushInvKey(null)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={pushInvBusy}
              onPress={submitPushToInventory}
            >
              加入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 批量推到本站(模板复用)弹窗 — 选 site + template, 一次性把
          多个 key 创建为账号 + 建 binding。配置完全继承模板, 只换
          base_url + api_key + 账号名。 */}
      <Modal
        isOpen={bulkPushOpen}
        onOpenChange={setBulkPushOpen}
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div className="flex flex-col">
                  <span>批量加到本站(用模板配置)</span>
                  <span className="text-xs text-default-500 font-normal mt-0.5">
                    已勾选 {selectedKeyIds.size} 个 key · 将复用模板账号的
                    platform / 并发 / 优先级 / 倍率 / 分组 / model_mapping
                  </span>
                </div>
              </ModalHeader>
              <ModalBody className="gap-3">
                <Select
                  label="目标站点"
                  selectedKeys={
                    bulkPushForm.siteAccountId
                      ? [bulkPushForm.siteAccountId]
                      : []
                  }
                  onSelectionChange={(keys) => {
                    const v = String(Array.from(keys)[0] ?? "");
                    setBulkPushForm((f) => ({
                      ...f,
                      siteAccountId: v,
                      templateRemoteAccountId: "",
                    }));
                    if (v) void loadTemplateAccounts(Number(v));
                    else setTemplateAccounts([]);
                  }}
                >
                  {siteAccounts.map((s) => (
                    <SelectItem key={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </Select>
                <Autocomplete
                  label={
                    loadingTemplates
                      ? "模板账号(加载中…)"
                      : `模板账号(共 ${templateAccounts.length} 个)`
                  }
                  isDisabled={!bulkPushForm.siteAccountId || loadingTemplates}
                  placeholder="输入名字搜索…"
                  defaultItems={templateAccounts.map((t) => ({
                    key: String(t.remoteAccountId),
                    label: t.name,
                  }))}
                  selectedKey={
                    bulkPushForm.templateRemoteAccountId || null
                  }
                  onSelectionChange={(k) => {
                    setBulkPushForm((f) => ({
                      ...f,
                      templateRemoteAccountId: k != null ? String(k) : "",
                    }));
                  }}
                  description="新账号的 platform / 并发 / 优先级 / 倍率 / 分组 / model_mapping 等都会跟此账号一致"
                >
                  {(item) => (
                    <AutocompleteItem key={item.key}>
                      {item.label}
                    </AutocompleteItem>
                  )}
                </Autocomplete>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    size="sm"
                    label="账号名前缀(可空)"
                    placeholder=""
                    value={bulkPushForm.namePrefix}
                    onValueChange={(v) =>
                      setBulkPushForm((f) => ({ ...f, namePrefix: v }))
                    }
                  />
                  <Input
                    size="sm"
                    label="账号名后缀(可空)"
                    placeholder=""
                    value={bulkPushForm.nameSuffix}
                    onValueChange={(v) =>
                      setBulkPushForm((f) => ({ ...f, nameSuffix: v }))
                    }
                  />
                </div>
                <p className="text-[11px] text-default-500 leading-relaxed">
                  新账号名 = 前缀 + 上游 key 名 + 后缀。重名时 sub2api 会报错,
                  失败的 key 会在结果里列出, 不影响其他成功创建的。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={close}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isLoading={bulkPushBusy}
                  onPress={submitBulkPush}
                >
                  推送 {selectedKeyIds.size} 个 key
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* "→ 本站" 弹窗: 选目标站点+填表 → 创建账号 + 建 binding */}
      <Modal
        isOpen={pushSiteKey !== null}
        onClose={() => setPushSiteKey(null)}
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            添加到本站 · {pushSiteKey?.name}
          </ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-xs text-default-500">
              在选定的站点账号上创建一个 sub2api admin 账号 ,
              credentials 用此 upstream key, 然后自动建 binding。
            </p>
            <Select
              label="目标站点账号"
              selectedKeys={
                pushSiteForm.siteAccountId
                  ? new Set([pushSiteForm.siteAccountId])
                  : new Set()
              }
              onSelectionChange={(k) => {
                const v = Array.from(k as Set<string>)[0] ?? "";
                setPushSiteForm((f) => ({ ...f, siteAccountId: v }));
                if (v) loadSiteGroups(Number(v));
              }}
            >
              {siteAccounts.map((s) => (
                <SelectItem key={String(s.id)}>{s.name}</SelectItem>
              ))}
            </Select>
            <Input
              label="账号名称"
              value={pushSiteForm.name}
              onValueChange={(v) =>
                setPushSiteForm((f) => ({ ...f, name: v }))
              }
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-default-500">
                分组(可多选)
                {loadingSiteGroups && (
                  <span className="ml-1 text-default-400">加载中…</span>
                )}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {!pushSiteForm.siteAccountId ? (
                  <span className="text-xs text-default-400">
                    先选目标站点账号
                  </span>
                ) : siteGroups.length === 0 && !loadingSiteGroups ? (
                  <Input
                    size="sm"
                    label="分组 IDs (逗号分隔)"
                    placeholder="例如 1,2"
                    value={pushSiteForm.groupIds}
                    onValueChange={(v) =>
                      setPushSiteForm((f) => ({ ...f, groupIds: v }))
                    }
                  />
                ) : (
                  siteGroups.map((g) => {
                    const set = new Set(
                      pushSiteForm.groupIds
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    );
                    const on = set.has(String(g.id));
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          const cur = new Set(set);
                          if (cur.has(String(g.id))) cur.delete(String(g.id));
                          else cur.add(String(g.id));
                          setPushSiteForm((f) => ({
                            ...f,
                            groupIds: [...cur].join(","),
                          }));
                        }}
                        className={
                          "px-2.5 py-1 rounded-full text-xs border " +
                          (on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-content2/60 border-divider/60")
                        }
                        title={`#${g.id} · ×${g.rate_multiplier}`}
                      >
                        {on ? "✓ " : ""}
                        {g.name}
                        <span className="opacity-60 ml-1">
                          ×{g.rate_multiplier}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                label="并发"
                value={pushSiteForm.concurrency}
                onValueChange={(v) =>
                  setPushSiteForm((f) => ({ ...f, concurrency: v }))
                }
              />
              <Input
                type="number"
                label="优先级"
                description="数字越小越优先 (默认 1)"
                value={pushSiteForm.priority}
                onValueChange={(v) =>
                  setPushSiteForm((f) => ({ ...f, priority: v }))
                }
              />
              <Input
                type="number"
                step="0.01"
                label="rate_multiplier"
                description="账号倍率"
                value={pushSiteForm.rateMultiplier}
                onValueChange={(v) =>
                  setPushSiteForm((f) => ({ ...f, rateMultiplier: v }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                size="sm"
                label="平台"
                selectedKeys={new Set([pushSiteForm.platform])}
                onSelectionChange={(k) => {
                  const v =
                    Array.from(k as Set<string>)[0] ?? "anthropic";
                  setPushSiteForm((f) => ({ ...f, platform: v }));
                }}
              >
                <SelectItem key="anthropic">Anthropic (Claude)</SelectItem>
                <SelectItem key="openai">OpenAI</SelectItem>
                <SelectItem key="gemini">Gemini</SelectItem>
              </Select>
              {pushSiteForm.platform === "gemini" ? (
                <Select
                  size="sm"
                  label="Gemini tier"
                  selectedKeys={new Set([pushSiteForm.geminiTier])}
                  onSelectionChange={(k) => {
                    const v =
                      Array.from(k as Set<string>)[0] ?? "aistudio_paid";
                    setPushSiteForm((f) => ({ ...f, geminiTier: v }));
                  }}
                >
                  <SelectItem key="aistudio_paid">AI Studio Paid</SelectItem>
                  <SelectItem key="aistudio_free">AI Studio Free</SelectItem>
                </Select>
              ) : (
                <Input
                  size="sm"
                  label="type"
                  value="apikey"
                  isReadOnly
                  description="type 固定 apikey"
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setPushSiteKey(null)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={pushSiteBusy}
              onPress={submitPushToSite}
            >
              创建+绑定
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
              className="col-span-4"
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
              label="备注"
              placeholder="可选"
              className="col-span-4"
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
                          价格 <b>{it.price || "—"}</b>
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
                    {/* 该货源所属分类: 候选 = 全部 UpstreamCategory.
                        留空 = 只在"全部" Tab 显示 (其它分类 Tab 不会出现这条货源). */}
                    {categoryList.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-[10px] text-default-400 self-center">
                          属于分类:
                        </span>
                        {categoryList.map((c) => {
                          const on = itemCats.includes(c.name);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleInventoryCategory(i, c.name)}
                              className={
                                "px-1.5 py-0.5 rounded text-[10px] border transition-colors " +
                                (on
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-content2/60 border-divider/60 hover:bg-content2")
                              }
                            >
                              {on ? "✓ " : ""}
                              {c.name}
                            </button>
                          );
                        })}
                        {itemCats.length === 0 && (
                          <span className="text-[10px] text-default-400 self-center">
                            (空 = 只在&quot;全部&quot;显示)
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
          {/* 渠道本身不再有分类概念 — 分类只属于"货源"条目 (在下面"货源"
              Tab 里配置). 表单底层 form.categories 留空数组提交即可。 */}
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

// ──────────────────────────────────────────────────────────────────
// 余额提醒 modal
// 一张表罗列所有渠道:启用 / 间隔(分) / 阈值列表(自由文本)
// 阈值用逗号 / 空格 / 换行分隔, 输入 "10000 5000 1000" / "10000,5000" 都行。
// "用户充钱"逻辑在后端: balance 回到 ≥ 阈值时把该阈值从 fired 中移除。
// ──────────────────────────────────────────────────────────────────

interface BalanceAlertItem {
  id: number;
  name: string;
  supplier: string | null;
  balance: number | null;
  balanceUpdatedAt: string | null;
  enabled: boolean;
  intervalMin: number;
  thresholds: number[];
  fired: number[];
  lastCheckAt: string | null;
}

function parseThresholdsInput(raw: string): number[] {
  if (!raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => b - a);
}

function BalanceAlertModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<BalanceAlertItem[]>([]);
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/upstream/balance-alert", {
        cache: "no-store",
      });
      const j = (await r.json()) as { items: BalanceAlertItem[] };
      setItems(j.items || []);
      const texts: Record<number, string> = {};
      for (const it of j.items || []) {
        texts[it.id] = it.thresholds.join(", ");
      }
      setDraftText(texts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  function update(id: number, patch: Partial<BalanceAlertItem>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = items.map((it) => ({
        id: it.id,
        enabled: it.enabled,
        intervalMin: it.intervalMin,
        thresholds: parseThresholdsInput(draftText[it.id] ?? ""),
      }));
      const r = await fetch("/api/upstream/balance-alert", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({
          title: "保存失败",
          description: String(j.error || r.status),
          color: "danger",
        });
        return;
      }
      const j = (await r.json()) as { updated: number };
      addToast({ title: `已保存 ${j.updated} 个渠道`, color: "success" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function runCheckNow() {
    const r = await fetch("/api/upstream/balance-alert/check", {
      method: "POST",
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      addToast({
        title: "触发失败",
        description: String(j.error || r.status),
        color: "danger",
      });
      return;
    }
    addToast({
      title: "已触发一次检测",
      description: "受 intervalMin 节流; 想立刻发邮件可临时把间隔改成 1 分钟",
      color: "success",
    });
    await load();
  }

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          (x.supplier ?? "").toLowerCase().includes(q),
      )
    : items;
  const enabledCount = items.filter((x) => x.enabled).length;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              <div className="flex flex-col">
                <span className="flex items-center gap-2">
                  <Bell size={16} /> 渠道余额提醒
                </span>
                <span className="text-xs text-default-500 font-normal mt-0.5">
                  跌破阈值 → 邮件提醒;充值回到阈值之上后,下次再跌破时重新提醒。
                  邮件使用「设置」页里配置的发件/收件邮箱。
                </span>
              </div>
            </ModalHeader>
            <ModalBody className="gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  size="sm"
                  placeholder="按渠道名 / 货源筛选…"
                  value={filter}
                  onValueChange={setFilter}
                  className="flex-1 min-w-[200px]"
                />
                <span className="text-xs text-default-500">
                  已启用 {enabledCount} / {items.length}
                </span>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={runCheckNow}
                  isDisabled={loading || saving}
                >
                  立即触发一次检测
                </Button>
              </div>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (
                <Table removeWrapper aria-label="balance alerts">
                  <TableHeader>
                    <TableColumn>渠道</TableColumn>
                    <TableColumn>当前余额</TableColumn>
                    <TableColumn>启用</TableColumn>
                    <TableColumn>间隔(分)</TableColumn>
                    <TableColumn>阈值(USD, 多个用空格/逗号/换行)</TableColumn>
                    <TableColumn>已触发</TableColumn>
                  </TableHeader>
                  <TableBody emptyContent="没有匹配的渠道">
                    {filtered.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{it.name}</span>
                            {it.supplier && (
                              <span className="text-[10px] text-default-400">
                                {it.supplier}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`font-mono ${
                              it.balance == null
                                ? "text-default-400"
                                : it.balance > 0
                                  ? "text-foreground"
                                  : "text-warning"
                            }`}
                          >
                            {it.balance == null
                              ? "—"
                              : `$${fmtMoneyShort(it.balance)}`}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            isSelected={it.enabled}
                            onValueChange={(v) =>
                              update(it.id, { enabled: v })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            size="sm"
                            min={1}
                            className="w-20"
                            value={String(it.intervalMin)}
                            onValueChange={(v) =>
                              update(it.id, {
                                intervalMin: Math.max(
                                  1,
                                  Math.floor(Number(v) || 60),
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            size="sm"
                            placeholder="例: 10000, 5000, 1000"
                            value={draftText[it.id] ?? ""}
                            onValueChange={(v) =>
                              setDraftText((m) => ({ ...m, [it.id]: v }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {it.fired.length === 0 ? (
                            <span className="text-default-400 text-xs">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {it.fired.map((t) => (
                                <Chip
                                  key={t}
                                  size="sm"
                                  color="warning"
                                  variant="flat"
                                  classNames={{
                                    base: "h-5",
                                    content: "text-[10px] px-1.5",
                                  }}
                                >
                                  ${fmtMoneyShort(t)}
                                </Chip>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close}>
                关闭
              </Button>
              <Button color="primary" onPress={save} isLoading={saving}>
                保存全部
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────
// 批量录入 sk-ant token modal
// 表单 → 调 /api/site/[id]/import-sk-ant → 把成功/失败结果列在下面给用户售后参考
// ──────────────────────────────────────────────────────────────────

interface ImportSkAntResultRow {
  tokenMasked: string;
  name: string;
  ok: boolean;
  stage?: "cookie-auth" | "create";
  error?: string;
  remoteAccountId?: number;
}

function ImportSkAntModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]);
  const [groups, setGroups] = useState<
    Array<{ id: number; name: string; rate_multiplier?: number }>
  >([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [presets, setPresets] = useState<
    Array<{ id: number; name: string; groupIds: number[] }>
  >([]);
  const [form, setForm] = useState({
    siteAccountId: "",
    namePrefix: "",
    concurrency: "10",
    windowCostLimit: "0",
    rateMultiplier: "1",
    groupIds: [] as number[],
    tokens: "",
  });
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportSkAntResultRow[] | null>(null);
  const [startIdx, setStartIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setResults(null);
    setStartIdx(null);
    fetch("/api/site", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) =>
        setSites(
          (j.items ?? []).map((s: { id: number; name: string }) => ({
            id: s.id,
            name: s.name,
          })),
        ),
      )
      .catch(() => {
        addToast({ title: "加载站点失败", color: "danger" });
      });
  }, [isOpen]);

  // 切换站点时拉该站点的分组列表 + 预设列表
  useEffect(() => {
    if (!isOpen) return;
    const sid = Number(form.siteAccountId);
    if (!sid) {
      setGroups([]);
      setPresets([]);
      setForm((f) => ({ ...f, groupIds: [] }));
      return;
    }
    setLoadingGroups(true);
    Promise.allSettled([
      fetch(`/api/site/${sid}/groups`, { cache: "no-store" }).then((r) =>
        r.json(),
      ),
      fetch(`/api/site-group-presets?siteAccountId=${sid}`, {
        cache: "no-store",
      }).then((r) => r.json()),
    ])
      .then(([gRes, pRes]) => {
        if (gRes.status === "fulfilled" && !gRes.value.error) {
          setGroups(
            (gRes.value.items ?? []) as Array<{
              id: number;
              name: string;
              rate_multiplier?: number;
            }>,
          );
        } else {
          setGroups([]);
          addToast({ title: "加载分组失败", color: "danger" });
        }
        if (pRes.status === "fulfilled") {
          setPresets(
            (pRes.value.items ?? []) as Array<{
              id: number;
              name: string;
              groupIds: number[];
            }>,
          );
        } else {
          setPresets([]);
        }
        // 切站点清空已选, 避免把别的站点的 group id 误带过去
        setForm((f) => ({ ...f, groupIds: [] }));
      })
      .finally(() => setLoadingGroups(false));
  }, [isOpen, form.siteAccountId]);

  async function submit() {
    const siteId = Number(form.siteAccountId);
    if (!siteId) {
      addToast({ title: "请选择目标站点", color: "warning" });
      return;
    }
    // namePrefix 可空 — 后端留空时直接用 sk 当账号名
    const namePrefix = form.namePrefix.trim();
    const concurrency = Math.max(1, Math.floor(Number(form.concurrency) || 0));
    if (!concurrency) {
      addToast({ title: "并发数非法", color: "warning" });
      return;
    }
    const windowCostLimit = Math.max(0, Number(form.windowCostLimit) || 0);
    const rateMultiplier =
      Math.max(0, Number(form.rateMultiplier) || 0) || 1;
    const groupIds = form.groupIds.filter(
      (n) => Number.isFinite(n) && n > 0,
    );
    const tokens = form.tokens
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      addToast({ title: "请粘贴至少 1 个 token", color: "warning" });
      return;
    }
    setBusy(true);
    setResults(null);
    try {
      const r = await fetch(`/api/site/${siteId}/import-sk-ant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens,
          namePrefix,
          concurrency,
          windowCostLimit,
          rateMultiplier,
          groupIds,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        addToast({
          title: "提交失败",
          description: String(j.error || r.status),
          color: "danger",
        });
        return;
      }
      setResults(j.results || []);
      setStartIdx(j.startIdx ?? null);
      addToast({
        title: `录入完成: 成功 ${j.success} / 共 ${j.total}, 失败 ${j.failed}`,
        color: j.failed > 0 ? "warning" : "success",
      });
    } finally {
      setBusy(false);
    }
  }

  function copyFailedTokens() {
    if (!results) return;
    const failed = results
      .filter((r) => !r.ok)
      .map((r) => `${r.name}\t${r.tokenMasked}\t${r.error ?? ""}`)
      .join("\n");
    if (!failed) {
      addToast({ title: "没有失败行", color: "default" });
      return;
    }
    void copyToClipboard(failed).then((ok) =>
      addToast({
        title: ok ? "失败列表已复制" : "复制失败",
        color: ok ? "success" : "danger",
      }),
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              <div className="flex flex-col">
                <span>批量录入 sk-ant Token (setup-token)</span>
                <span className="text-xs text-default-500 font-normal mt-0.5">
                  每个 sk 走完整 2 步:cookie-auth 换 oauth → 创建账号 ·
                  失败行会标 cookie-auth/create 哪个阶段挂了
                </span>
              </div>
            </ModalHeader>
            <ModalBody className="gap-3">
              <Select
                label="目标站点"
                selectedKeys={
                  form.siteAccountId ? [form.siteAccountId] : []
                }
                onSelectionChange={(keys) => {
                  const v = String(Array.from(keys)[0] ?? "");
                  setForm((f) => ({ ...f, siteAccountId: v }));
                }}
              >
                {sites.map((s) => (
                  <SelectItem key={String(s.id)}>{s.name}</SelectItem>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  size="sm"
                  label="名称前缀(可空)"
                  placeholder="留空 = 用 sk 当账号名"
                  description="留空: 账号名 = sk 字符串 (方便人工对账)。填了: prefix-N, N 自动续上已有最大值。"
                  value={form.namePrefix}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, namePrefix: v }))
                  }
                />
                <Select
                  size="sm"
                  label={
                    loadingGroups
                      ? "分组(加载中…)"
                      : form.siteAccountId
                        ? `分组 (共 ${groups.length} 个, 可多选)`
                        : "分组 (先选站点)"
                  }
                  selectionMode="multiple"
                  isDisabled={!form.siteAccountId || loadingGroups}
                  selectedKeys={form.groupIds.map((n) => String(n))}
                  onSelectionChange={(keys) => {
                    const arr = Array.from(keys as Set<string>)
                      .map((s) => Number(s))
                      .filter((n) => Number.isFinite(n) && n > 0);
                    setForm((f) => ({ ...f, groupIds: arr }));
                  }}
                >
                  {groups.map((g) => (
                    <SelectItem key={String(g.id)}>
                      {g.name}
                      {g.rate_multiplier != null
                        ? ` ×${g.rate_multiplier}`
                        : ""}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {form.siteAccountId && presets.length > 0 && (
                <Select
                  size="sm"
                  label={`套用预设 (该站 ${presets.length} 个可选)`}
                  description="选预设 = 一键回填分组; 选后还能手动加/减"
                  selectedKeys={[]}
                  onSelectionChange={(keys) => {
                    const v = String(Array.from(keys)[0] ?? "");
                    const preset = presets.find((p) => String(p.id) === v);
                    if (!preset) return;
                    const valid = new Set(groups.map((g) => g.id));
                    const arr = preset.groupIds.filter((n) => valid.has(n));
                    setForm((f) => ({ ...f, groupIds: arr }));
                    if (arr.length < preset.groupIds.length) {
                      addToast({
                        title: `预设里 ${preset.groupIds.length - arr.length} 个分组当前站点不存在, 已忽略`,
                        color: "warning",
                      });
                    }
                  }}
                >
                  {presets.map((p) => (
                    <SelectItem
                      key={String(p.id)}
                      textValue={p.name}
                    >
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-[10px] text-default-400">
                          {p.groupIds
                            .map((gid) => {
                              const g = groups.find((x) => x.id === gid);
                              return g ? g.name : `#${gid}`;
                            })
                            .join(", ")}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </Select>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Input
                  type="number"
                  size="sm"
                  label="并发数"
                  min={1}
                  value={form.concurrency}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, concurrency: v }))
                  }
                />
                <Input
                  type="number"
                  size="sm"
                  label="5h 金额上限 USD"
                  description="0 = 不启用"
                  min={0}
                  step="0.5"
                  value={form.windowCostLimit}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, windowCostLimit: v }))
                  }
                />
                <Input
                  type="number"
                  size="sm"
                  label="倍率"
                  min={0}
                  step="0.01"
                  value={form.rateMultiplier}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, rateMultiplier: v }))
                  }
                />
              </div>
              <Textarea
                label="sk-ant Token 列表"
                description="一行一个; 自动忽略空行 + 前后空格 + 不以 sk-ant- 开头的会标记失败"
                minRows={6}
                value={form.tokens}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tokens: v }))
                }
                placeholder={"sk-ant-...\nsk-ant-...\nsk-ant-..."}
              />

              {results && (
                <div className="border border-divider/60 rounded-lg p-2">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-xs">
                      <span className="text-success">
                        成功 {results.filter((r) => r.ok).length}
                      </span>
                      <span className="text-default-400 mx-2">·</span>
                      <span className="text-danger">
                        失败 {results.filter((r) => !r.ok).length}
                      </span>
                      {startIdx != null && (
                        <span className="text-default-400 ml-2">
                          (起始编号 {startIdx})
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="flat"
                      className="h-7 px-2 text-[11px]"
                      onPress={copyFailedTokens}
                    >
                      复制失败行
                    </Button>
                  </div>
                  <Table removeWrapper aria-label="results">
                    <TableHeader>
                      <TableColumn>状态</TableColumn>
                      <TableColumn>阶段</TableColumn>
                      <TableColumn>账号名</TableColumn>
                      <TableColumn>token</TableColumn>
                      <TableColumn>错误</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {results.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Chip
                              size="sm"
                              variant="flat"
                              color={r.ok ? "success" : "danger"}
                            >
                              {r.ok ? "成功" : "失败"}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            {r.stage ? (
                              <Chip
                                size="sm"
                                variant="flat"
                                color={
                                  r.stage === "cookie-auth"
                                    ? "warning"
                                    : "primary"
                                }
                              >
                                {r.stage}
                              </Chip>
                            ) : (
                              <span className="text-default-400 text-xs">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span
                              className="font-mono text-xs break-all"
                              title={r.name}
                            >
                              {r.name.length > 28
                                ? `${r.name.slice(0, 16)}...${r.name.slice(-8)}`
                                : r.name}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-default-500">
                              {r.tokenMasked}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-danger break-all">
                              {r.error ?? ""}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close}>
                关闭
              </Button>
              <Button color="primary" isLoading={busy} onPress={submit}>
                提交录入
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────
// 分组预设管理 modal
// 选 site → 列该 site 的预设 + 在线增删改。每个预设 = (name, groupIds[])。
// 后续 ImportSkAntModal / push-to-site 选预设时一键填 groupIds。
// ──────────────────────────────────────────────────────────────────

interface PresetRow {
  id: number;
  siteAccountId: number;
  name: string;
  groupIds: number[];
}

function GroupPresetsModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [groups, setGroups] = useState<
    Array<{ id: number; name: string; rate_multiplier?: number }>
  >([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [editing, setEditing] = useState<{
    id: number | null;
    name: string;
    groupIds: number[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/site", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) =>
        setSites(
          (j.items ?? []).map((s: { id: number; name: string }) => ({
            id: s.id,
            name: s.name,
          })),
        ),
      )
      .catch(() => {
        addToast({ title: "加载站点失败", color: "danger" });
      });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !siteId) {
      setGroups([]);
      setPresets([]);
      setEditing(null);
      return;
    }
    const sid = Number(siteId);
    setLoadingGroups(true);
    setLoadingPresets(true);
    Promise.allSettled([
      fetch(`/api/site/${sid}/groups`, { cache: "no-store" }).then((r) =>
        r.json(),
      ),
      fetch(`/api/site-group-presets?siteAccountId=${sid}`, {
        cache: "no-store",
      }).then((r) => r.json()),
    ])
      .then(([gRes, pRes]) => {
        if (gRes.status === "fulfilled") {
          setGroups(
            (gRes.value.items ?? []) as Array<{
              id: number;
              name: string;
              rate_multiplier?: number;
            }>,
          );
        } else {
          setGroups([]);
          addToast({ title: "加载分组失败", color: "danger" });
        }
        if (pRes.status === "fulfilled") {
          setPresets((pRes.value.items ?? []) as PresetRow[]);
        } else {
          setPresets([]);
        }
      })
      .finally(() => {
        setLoadingGroups(false);
        setLoadingPresets(false);
      });
  }, [isOpen, siteId]);

  function startNew() {
    setEditing({ id: null, name: "", groupIds: [] });
  }

  function startEdit(p: PresetRow) {
    setEditing({ id: p.id, name: p.name, groupIds: [...p.groupIds] });
  }

  async function save() {
    if (!editing) return;
    const sid = Number(siteId);
    if (!sid) return;
    const name = editing.name.trim();
    if (!name) {
      addToast({ title: "预设名必填", color: "warning" });
      return;
    }
    if (editing.groupIds.length === 0) {
      addToast({ title: "至少选 1 个分组", color: "warning" });
      return;
    }
    setSaving(true);
    try {
      const r = editing.id
        ? await fetch(`/api/site-group-presets/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              groupIds: editing.groupIds,
            }),
          })
        : await fetch(`/api/site-group-presets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteAccountId: sid,
              name,
              groupIds: editing.groupIds,
            }),
          });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({
          title: "保存失败",
          description: String(j.error || r.status),
          color: "danger",
        });
        return;
      }
      addToast({ title: "已保存", color: "success" });
      setEditing(null);
      const list = await fetch(
        `/api/site-group-presets?siteAccountId=${sid}`,
        { cache: "no-store" },
      ).then((x) => x.json());
      setPresets(list.items ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: PresetRow) {
    if (!confirm(`删除预设「${p.name}」?`)) return;
    const r = await fetch(`/api/site-group-presets/${p.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    setPresets((arr) => arr.filter((x) => x.id !== p.id));
    addToast({ title: "已删除", color: "success" });
  }

  const groupName = (id: number): string => {
    const g = groups.find((x) => x.id === id);
    return g ? g.name : `#${id}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              <div className="flex flex-col">
                <span>分组预设管理</span>
                <span className="text-xs text-default-500 font-normal mt-0.5">
                  按本站维护常用分组集合 · 录入 sk-ant 等场景一键回填
                </span>
              </div>
            </ModalHeader>
            <ModalBody className="gap-3">
              <Select
                label="本站"
                selectedKeys={siteId ? [siteId] : []}
                onSelectionChange={(keys) => {
                  setSiteId(String(Array.from(keys)[0] ?? ""));
                  setEditing(null);
                }}
              >
                {sites.map((s) => (
                  <SelectItem key={String(s.id)}>{s.name}</SelectItem>
                ))}
              </Select>

              {!siteId ? (
                <p className="text-xs text-default-500 py-4 text-center">
                  请先选一个本站
                </p>
              ) : loadingPresets || loadingGroups ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-default-500">
                      共 {presets.length} 个预设
                    </span>
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      startContent={<Plus size={12} />}
                      onPress={startNew}
                    >
                      新建预设
                    </Button>
                  </div>

                  {editing && (
                    <Card className="border border-primary/40 bg-primary-50/30">
                      <CardBody className="gap-2">
                        <div className="text-xs text-default-700 font-medium">
                          {editing.id ? `编辑预设 #${editing.id}` : "新建预设"}
                        </div>
                        <Input
                          size="sm"
                          label="预设名称"
                          placeholder="例: claude 全套"
                          value={editing.name}
                          onValueChange={(v) =>
                            setEditing((e) =>
                              e ? { ...e, name: v } : e,
                            )
                          }
                        />
                        <Select
                          size="sm"
                          label={`分组(共 ${groups.length} 个, 可多选)`}
                          selectionMode="multiple"
                          selectedKeys={editing.groupIds.map((n) =>
                            String(n),
                          )}
                          onSelectionChange={(keys) => {
                            const arr = Array.from(keys as Set<string>)
                              .map((x) => Number(x))
                              .filter((n) => Number.isFinite(n) && n > 0);
                            setEditing((e) =>
                              e ? { ...e, groupIds: arr } : e,
                            );
                          }}
                        >
                          {groups.map((g) => (
                            <SelectItem key={String(g.id)}>
                              {g.name}
                              {g.rate_multiplier != null
                                ? ` ×${g.rate_multiplier}`
                                : ""}
                            </SelectItem>
                          ))}
                        </Select>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => setEditing(null)}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            color="primary"
                            isLoading={saving}
                            onPress={save}
                          >
                            保存
                          </Button>
                        </div>
                      </CardBody>
                    </Card>
                  )}

                  {presets.length === 0 && !editing ? (
                    <p className="text-xs text-default-500 py-4 text-center">
                      还没有预设, 点「新建预设」开始
                    </p>
                  ) : presets.length > 0 ? (
                    <Table removeWrapper aria-label="presets">
                      <TableHeader>
                        <TableColumn>名称</TableColumn>
                        <TableColumn>包含分组</TableColumn>
                        <TableColumn>{" "}</TableColumn>
                      </TableHeader>
                      <TableBody>
                        {presets.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <span className="text-sm font-medium">
                                {p.name}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {p.groupIds.map((gid) => (
                                  <Chip
                                    key={gid}
                                    size="sm"
                                    variant="flat"
                                    classNames={{
                                      base: "h-5",
                                      content: "text-[10px] px-1.5",
                                    }}
                                  >
                                    {groupName(gid)}
                                  </Chip>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="light"
                                  className="h-7 px-2 text-[11px]"
                                  onPress={() => startEdit(p)}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="light"
                                  color="danger"
                                  className="h-7 px-2 text-[11px]"
                                  onPress={() => remove(p)}
                                >
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close}>
                关闭
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
