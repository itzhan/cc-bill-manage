"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
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
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
  hidden: boolean;
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

  const [newDlgOpen, setNewDlgOpen] = useState(false);
  const [editDlgOpen, setEditDlgOpen] = useState(false);
  const [keysDlgOpen, setKeysDlgOpen] = useState(false);
  const [balanceAlertDlgOpen, setBalanceAlertDlgOpen] = useState(false);
  const [importSkAntDlgOpen, setImportSkAntDlgOpen] = useState(false);
  const [groupPresetDlgOpen, setGroupPresetDlgOpen] = useState(false);
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
  const [showHidden, setShowHidden] = useState(false);
  // 当前 Tab; 历史渠道 db push 时自动落到 claude, 默认显示 claude。
  const [categoryFilter, setCategoryFilter] = useState<string>(TAB_ALL);
  // 用户自定义的分类列表 — 决定 Tab 显示
  const [categoryList, setCategoryList] = useState<UpstreamCategory[]>([]);
  // 新增分类对话框
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDlgOpen, setNewCategoryDlgOpen] = useState(false);
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
        fetch(`/api/upstream?hidden=${showHidden ? "1" : "0"}`, { cache: "no-store" }),
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
      toast.warning("分类名必填");
      return;
    }
    const res = await fetch("/api/upstream/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(`新增失败: ${j.error || ""}`);
      return;
    }
    setNewCategoryName("");
    setNewCategoryDlgOpen(false);
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
      toast.error(`删除失败: ${j.error || ""}`);
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
        toast.error(`加入失败: ${j.error || ""}`);
        return;
      }
      toast.success("已加入货源");
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
      toast.error(`加载站点列表失败: ${String(e)}`);
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
      toast.warning("请先勾选 key");
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
      toast.error(`加载站点列表失败: ${String(e)}`);
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
      toast.error(`加载模板账号失败: ${String(e)}`);
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
      toast.warning("请选择目标站点");
      return;
    }
    if (!templateRemoteAccountId) {
      toast.warning("请选择模板账号");
      return;
    }
    if (selectedKeyIds.size === 0) {
      toast.warning("未选中 key");
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
        toast.error(`批量推送失败: ${String(j.error || res.status)}`);
        return;
      }
      const failedRows = (j.results ?? []).filter(
        (r: { ok: boolean }) => !r.ok,
      );
      if (failedRows.length > 0) {
        toast.warning(
          `成功 ${j.success} / 共 ${j.total}, 失败 ${j.failed}: ${failedRows
            .slice(0, 3)
            .map(
              (r: { keyName: string; error?: string }) =>
                `${r.keyName}: ${r.error}`,
            )
            .join("; ")}`,
        );
      } else {
        toast.success(`已批量推送 ${j.success} 个 key`);
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
      toast.error(`加载分组失败: ${String(e)}`);
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
      toast.warning("请选择目标站点账号");
      return;
    }
    if (!pushSiteForm.name.trim()) {
      toast.warning("请填账号名称");
      return;
    }
    if (groupIds.length === 0) {
      toast.warning("至少勾一个分组");
      return;
    }
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      toast.warning("并发非法");
      return;
    }
    if (!Number.isFinite(rateMultiplier) || rateMultiplier <= 0) {
      toast.warning("倍率非法");
      return;
    }
    if (!Number.isFinite(priority) || priority < 0) {
      toast.warning("优先级非法");
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
        toast.error(`推送失败: ${j.error || ""}`);
        return;
      }
      toast.success(`已创建账号 + binding (#${j.remoteAccountId})`);
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
        toast.error(`同步失败: ${j.error || ""}`);
      } else {
        toast.success("用量已更新");
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
        toast.error(`刷新失败: ${j.error || ""}`);
      } else {
        toast.success("结构已刷新");
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
        toast.error(`批量刷新失败: ${j.error || ""}`);
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
        toast.success(`已完成 ${total} 个渠道的刷新 + 同步`);
      } else {
        const desc = [
          ...failedRefresh.map((x) => `刷新 ${x.name}: ${x.error}`),
          ...failedSync.map((x) => `同步 ${x.name}: ${x.error}`),
        ]
          .slice(0, 4)
          .join(" · ");
        toast.warning(`${total} 个中 ${failedCount} 项失败: ${desc}`);
      }
      await load();
      if (keysModalAccount) await loadKeys(keysModalAccount.id);
    } catch (e) {
      toast.error(`批量刷新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyAll(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除该上游账号？相关的 keys 和绑定也会删除。")) return;
    const res = await fetch(`/api/upstream/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(`删除失败: ${j.error || ""}`);
      return;
    }
    toast.success("已删除");
    await load();
  }

  async function toggleHidden(id: number, hidden: boolean) {
    await fetch(`/api/upstream/${id}`, {
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
    setNewDlgOpen(true);
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
    setEditDlgOpen(true);
  }

  function openKeys(a: UpstreamAccount) {
    setKeysModalAccount(a);
    setSelectedKeyIds(new Set()); // 切换渠道时清空选择, 避免误带入
    setKeysDlgOpen(true);
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
      toast.warning("请填写名称和 Base URL");
      return;
    }
    if (!form.accessToken && (!form.email || !form.password)) {
      toast.warning("请填写 Access Token，或同时填写 Email + 密码");
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
      toast.error(`创建失败: ${j.error || ""}`);
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
    setNewDlgOpen(false);
    toast.success("已创建");
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
      toast.error(`保存失败: ${j.error || ""}`);
      return;
    }
    setEditDlgOpen(false);
    toast.success("已保存");
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
      if (ok) toast.success("已复制");
      else toast.error("复制失败");
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
        toast.error(`获取 key 失败: ${j.error || ""}`);
        return;
      }
      const fullKey: string | null = j.item?.apiKey ?? null;
      if (!fullKey) {
        toast.warning(`未拿到完整 key: ${j.item?.revealError || "上游可能也只返回了 mask"}`);
        return;
      }
      const ok = await copyToClipboard(fullKey);
      if (ok) toast.success(`${name} 的 key 已复制`);
      else toast.error("复制失败");
    } catch (e) {
      toast.error(`复制失败: ${e instanceof Error ? e.message : String(e)}`);
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
        toast.error(`添加到智测失败: ${String(j.error || res.status)}`);
        return;
      }
      const parts: string[] = [];
      if (j.channelCreated) parts.push("已新建渠道");
      else parts.push("复用已有渠道");
      if (j.keyCreated) parts.push("已新建 key");
      else parts.push("key 已存在");
      toast.success(`${name} 已加入智测: ${parts.join(" · ")}`);
    } finally {
      setBenchPushingKeyId(null);
    }
  }

  useEffect(() => {
    load();
  }, [showHidden]);

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
  // 该 (name, accountId) 在渲染时拿到 最低价 标识。
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

  // Build tab items for category filter
  const tabItems = [
    ...categoryList.map((c) => ({
      key: c.name,
      label: c.name,
      count: accounts.filter((a) =>
        parseInventory(a.inventory).some((it) =>
          (it.categories ?? []).includes(c.name),
        ),
      ).length,
    })),
    {
      key: TAB_ALL,
      label: "全部",
      count: accounts.length,
    },
  ];

  return (
    <Shell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">渠道管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            凭据 · 余额 · 货源情况 · 点卡片底部按钮查看消费明细
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            onClick={() => setBalanceAlertDlgOpen(true)}
          >
            <Bell size={14} />
            余额提醒
          </Button>
          <Button
            variant="secondary"
            onClick={() => setGroupPresetDlgOpen(true)}
            title="按本站分组维护可复用的分组集合, 录入 sk-ant / 推到本站时一键套用"
          >
            <Package size={14} />
            分组预设
          </Button>
          <Button
            variant="secondary"
            onClick={() => setImportSkAntDlgOpen(true)}
          >
            <KeyRound size={14} />
            批量录入 sk-ant
          </Button>
          <Button
            variant="secondary"
            onClick={refreshAndSyncAll}
            disabled={busyAll}
          >
            {busyAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
            一键刷新同步
          </Button>
          <Button
            variant="secondary"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
            {showHidden ? "查看启用" : "查看已隐藏"}
          </Button>
          <Button onClick={openNew}>
            <Plus size={14} />
            新建
          </Button>
        </div>
      </div>

      <BalanceAlertModal
        open={balanceAlertDlgOpen}
        onOpenChange={setBalanceAlertDlgOpen}
      />
      <ImportSkAntModal
        open={importSkAntDlgOpen}
        onOpenChange={setImportSkAntDlgOpen}
      />
      <GroupPresetsModal
        open={groupPresetDlgOpen}
        onOpenChange={setGroupPresetDlgOpen}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Tabs
          value={categoryFilter}
          onValueChange={setCategoryFilter}
        >
          <TabsList>
            {tabItems.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                <span className="flex items-center gap-1.5">
                  {t.label}
                  <span className="text-[10px] text-muted-foreground/70">{t.count}</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setNewCategoryDlgOpen(true)}
        >
          <Plus size={12} />
          新建货源分类
        </Button>
        {categoryFilter !== TAB_ALL && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-destructive"
            title="删除当前分类"
            onClick={() => {
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
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-4">暂无上游账号</CardContent>
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
                  <Card key={`sup:${sName}`}>
                    <CardHeader
                      className="flex flex-row justify-between items-center gap-2 pb-2 cursor-pointer"
                      onClick={() => toggleSupplier(sName)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2
                          size={16}
                          className="text-muted-foreground shrink-0"
                        />
                        <h3 className="font-semibold text-base truncate">
                          {sName}
                        </h3>
                        <Badge variant="secondary">
                          {channels.length} 渠道
                        </Badge>
                        {anyError && (
                          <Badge variant="destructive">
                            部分同步失败
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-xs">
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-muted-foreground">今日合计</span>
                          <span
                            className={cn(
                              "font-bold",
                              totalToday > 0
                                ? "text-foreground"
                                : "text-muted-foreground/70",
                            )}
                          >
                            ${fmtMoneyShort(totalToday)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end leading-tight">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Wallet size={11} /> 余额合计
                          </span>
                          <span
                            className={cn(
                              "font-bold",
                              !hasBalance
                                ? "text-muted-foreground/70"
                                : totalBalance > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {hasBalance
                              ? `$${fmtMoneyShort(totalBalance)}`
                              : "—"}
                          </span>
                        </div>
                        <ChevronDown
                          size={16}
                          className={cn(
                            "text-muted-foreground/70 transition-transform",
                            !collapsed && "rotate-180",
                          )}
                        />
                      </div>
                    </CardHeader>
                    {!collapsed && (
                      <CardContent className="pt-0 space-y-1.5">
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
                            onToggleHidden={() => toggleHidden(a.id, !a.hidden)}
                            onRemove={() => remove(a.id)}
                          />
                        ))}
                      </CardContent>
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
                <h2 className="text-sm font-semibold text-foreground/80 mb-3">
                  未分组渠道 ({grouped.ungrouped.length})
                </h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {grouped.ungrouped.map((a) => {
                  const inv = visibleInventory(a);
                  const isRevealed = revealed.has(a.id);
                  return (
                    <Card key={a.id}>
                <CardHeader className="flex flex-row justify-between items-start gap-2 pb-2">
                  <div className="flex flex-col leading-tight min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base truncate">
                        {a.name}
                      </h3>
                      <Badge variant="secondary">
                        {a.type}
                      </Badge>
                      {a.lastSyncError && (
                        <Badge variant="destructive">
                          同步失败
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground/70 mt-0.5">
                      最后同步 {fmtDate(a.lastSyncAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-end leading-tight">
                      <div className="text-muted-foreground text-xs">今日消费</div>
                      <span
                        className={cn(
                          "font-bold",
                          (a.todayCost ?? 0) > 0
                            ? "text-foreground"
                            : "text-muted-foreground/70",
                        )}
                      >
                        ${fmtMoneyShort(a.todayCost ?? 0)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end leading-tight">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Wallet size={12} /> 余额
                      </div>
                      <span
                        className={cn(
                          "font-bold",
                          a.balance == null
                            ? "text-muted-foreground/70"
                            : a.balance > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {a.balance == null
                          ? "—"
                          : `$${fmtMoneyShort(a.balance)}`}
                      </span>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      onClick={() => refreshOne(a.id)}
                      disabled={busyRefresh === a.id || busy === a.id}
                      title="刷新（结构 + 用量）"
                    >
                      {(busyRefresh === a.id || busy === a.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="pt-0 space-y-3">
                  {/* 凭据 */}
                  <section className="rounded-lg bg-muted/50 p-2.5 space-y-1.5">
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
                            className="text-muted-foreground/70 hover:text-foreground"
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
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                      <Package size={12} />
                      <span>货源</span>
                      <span className="text-muted-foreground/70">{inv.length}</span>
                      {categoryFilter !== TAB_ALL && (
                        <span className="text-[10px] text-muted-foreground/70">
                          · 已按 {categoryFilter} 过滤, 按价升序
                        </span>
                      )}
                    </div>
                    {inv.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70 italic">
                        {categoryFilter === TAB_ALL
                          ? "未填写。点编辑添加。"
                          : `当前分类 (${categoryFilter}) 下无货源`}
                      </p>
                    ) : (
                      <div className="rounded-lg overflow-hidden border border-border">
                        <div className="grid grid-cols-2 gap-1 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70 bg-muted/40">
                          <span>名称</span>
                          <span>倍率 / 价格</span>
                        </div>
                        {inv.map((it, i) => {
                          const best = isBestPrice(a, it);
                          return (
                            <div
                              key={i}
                              className={cn(
                                "grid grid-cols-2 gap-1 px-2.5 py-1.5 text-xs border-t border-border items-center",
                                best && "bg-emerald-50/40 dark:bg-emerald-950/20",
                              )}
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
                                className={cn(
                                  "truncate",
                                  best
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : "font-medium",
                                )}
                              >
                                {it.price || (
                                  <span className="text-muted-foreground/70">—</span>
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
                    <section className="text-xs text-muted-foreground whitespace-pre-wrap break-words border-l-2 border-border pl-2">
                      {a.notes}
                    </section>
                  )}

                  {a.lastSyncError && (
                    <p className="text-xs text-destructive break-all">
                      ⚠ {a.lastSyncError}
                    </p>
                  )}
                </CardContent>

                <CardFooter className="flex justify-between items-center gap-2 pt-0 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => openKeys(a)}
                  >
                    {a._count?.keys ?? 0} keys →
                  </Badge>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => openEdit(a)}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => toggleHidden(a.id, !a.hidden)}
                      title={a.hidden ? "取消隐藏" : "隐藏"}
                    >
                      {a.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(a.id)}
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
      <Dialog open={newDlgOpen} onOpenChange={setNewDlgOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建上游账号</DialogTitle>
          </DialogHeader>
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑 · {editing?.name}</DialogTitle>
          </DialogHeader>
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

      {/* 新建货源分类 */}
      <Dialog open={newCategoryDlgOpen} onOpenChange={setNewCategoryDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建货源分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>分类名</Label>
              <Input
                placeholder="例如 claude / openai / windsurf / kiro"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              创建后 Tab 列表会立刻出现这个分类。编辑某条货源时勾选它属于这个
              分类, 切到该 Tab 就只看到属于此分类的货源。
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewCategoryDlgOpen(false)}>
              取消
            </Button>
            <Button onClick={addCategory}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* keys 详情 modal */}
      <Dialog open={keysDlgOpen} onOpenChange={setKeysDlgOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {keysModalAccount?.name} · keys 消费
            </DialogTitle>
          </DialogHeader>
          <div>
            {!keysModalAccount ? null : !keys[keysModalAccount.id] ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : keys[keysModalAccount.id].length === 0 ? (
              <p className="text-muted-foreground text-sm">
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
                    <div className="rounded-lg border border-border p-2.5 mb-3 flex items-center gap-2 bg-muted/30">
                      <KeyRound size={12} className="text-muted-foreground/70 shrink-0" />
                      <span className="text-xs text-muted-foreground shrink-0">站点 URL</span>
                      <code className="font-mono text-xs flex-1 truncate" title={keysModalAccount.baseUrl}>
                        {keysModalAccount.baseUrl}
                      </code>
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        className="h-7 w-7"
                        onClick={() => copy(keysModalAccount.baseUrl)}
                        title="复制 URL"
                      >
                        <Copy size={13} />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={showZero}
                          onCheckedChange={(v) => setShowZero(!!v)}
                        />
                        <span>显示今日 0 消费的 key</span>
                      </label>
                      {!showZero && hidden > 0 && (
                        <span>已隐藏 {hidden} 个 0 消费 key</span>
                      )}
                    </div>
                    {filtered.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        没有今日有消费的 key。
                      </p>
                    ) : (
                      <>
                      {/* 批量推到本站工具条 - 仅在勾了至少 1 个 key 时露出。
                          选中后弹模板选择窗, 新建账号复用模板配置, 一次性创建+建 binding。 */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap text-[11px]">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={
                              selectedKeyIds.size > 0 &&
                              filtered.every((k) => selectedKeyIds.has(k.id))
                                ? true
                                : selectedKeyIds.size > 0
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(v) => {
                              if (v) {
                                setSelectedKeyIds(new Set(filtered.map((k) => k.id)));
                              } else {
                                setSelectedKeyIds(new Set());
                              }
                            }}
                          />
                          <span className="text-[11px]">
                            {selectedKeyIds.size > 0
                              ? `已选 ${selectedKeyIds.size}`
                              : "全选"}
                          </span>
                        </label>
                        {selectedKeyIds.size > 0 && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-6 px-2 min-w-0 text-[11px]"
                              onClick={openBulkPushDialog}
                            >
                              批量加到本站(用模板配置)
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 min-w-0 text-[11px]"
                              onClick={() => setSelectedKeyIds(new Set())}
                            >
                              取消选择
                            </Button>
                          </>
                        )}
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{" "}</TableHead>
                            <TableHead>名称</TableHead>
                            <TableHead>分组×倍率</TableHead>
                            <TableHead>今日</TableHead>
                            <TableHead>累计</TableHead>
                            <TableHead>充值倍率</TableHead>
                            <TableHead>操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((k) => {
                            const rm = k.rechargeMultiplier ?? 1;
                            return (
                            <TableRow key={k.id}>
                              <TableCell className="w-8">
                                <Checkbox
                                  checked={selectedKeyIds.has(k.id)}
                                  onCheckedChange={() => toggleKeySelect(k.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-col leading-tight min-w-0">
                                    <span className="text-sm">{k.name}</span>
                                    <span className="font-mono text-xs text-muted-foreground/70 truncate">
                                      {k.keyMasked}
                                    </span>
                                  </div>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => copyFullKey(k.id, k.name)}
                                    title="复制完整 key"
                                    disabled={copyingKeyId === k.id}
                                  >
                                    {copyingKeyId === k.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="text-sm">
                                    {k.groupName}
                                  </span>
                                  <span className="text-xs text-muted-foreground/70">
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
                                    className={cn("font-medium", k.isStale && "text-muted-foreground/70")}
                                  >
                                    {fmtMoneyShort(effToday(k) * rm)}
                                  </span>
                                  {k.isStale ? (
                                    <span
                                      className="text-[10px] text-amber-600 dark:text-amber-400"
                                      title={`上次同步 ${k.lastUpdatedAt ? new Date(k.lastUpdatedAt).toLocaleString("zh-CN") : "—"} 时为 ${fmtMoneyShort(k.todayActualCost * rm)}`}
                                    >
                                      ⚠ 数据过期(同步失败)
                                    </span>
                                  ) : rm !== 1 ? (
                                    <span className="text-[10px] text-muted-foreground/70">
                                      面值 {fmtMoneyShort(k.todayActualCost)}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col leading-tight">
                                  <span className="text-foreground/80">
                                    {fmtMoneyShort(k.totalActualCost * rm)}
                                  </span>
                                  {rm !== 1 && (
                                    <span className="text-[10px] text-muted-foreground/70">
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
                                    variant="secondary"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onClick={() => openPushToInventory(k)}
                                    title="加入到此渠道的货源(选分类)"
                                  >
                                    → 货源
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onClick={() => openPushToSite(k)}
                                    title="一键添加到本站(创建账号+建绑定)"
                                  >
                                    → 本站
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 min-w-0 px-2 text-[10px]"
                                    onClick={() => pushKeyToBench(k.id, k.name)}
                                    disabled={benchPushingKeyId === k.id}
                                    title="一键加入智商测试(自动复用 baseUrl, 同 key 不重复)"
                                  >
                                    {benchPushingKeyId === k.id && (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    )}
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
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                keysModalAccount && syncOne(keysModalAccount.id)
              }
              disabled={busy === keysModalAccount?.id}
            >
              {busy === keysModalAccount?.id && <Loader2 className="h-4 w-4 animate-spin" />}
              同步用量
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                keysModalAccount && refreshOne(keysModalAccount.id)
              }
              disabled={busyRefresh === keysModalAccount?.id}
            >
              {busyRefresh === keysModalAccount?.id && <Loader2 className="h-4 w-4 animate-spin" />}
              结构刷新
            </Button>
            <Button variant="secondary" onClick={() => setKeysDlgOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "→ 货源" 弹窗: 把 key 加进所在渠道 inventory + 选分类 */}
      <Dialog open={pushInvKey !== null} onOpenChange={(v) => { if (!v) setPushInvKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              将 key 加入货源 · {pushInvKey?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              这条货源将以 <b>{pushInvKey?.name}</b> 为名,价格用{" "}
              <b>×{pushInvKey?.effectiveRateMultiplier}</b> (跨渠道比价用),
              备注自动填 {pushInvKey?.groupName}。
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">所属分类(可多选)</span>
              <div className="flex flex-wrap gap-1.5">
                {categoryList.length === 0 ? (
                  <span className="text-xs text-muted-foreground/70">
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
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs border",
                          on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/60 border-border",
                        )}
                      >
                        {on ? "✓ " : ""}
                        {c.name}
                      </button>
                    );
                  })
                )}
              </div>
              {pushInvCats.length === 0 && (
                <span className="text-[11px] text-muted-foreground/70">
                  留空 = 继承所在渠道的全部分类
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPushInvKey(null)}>
              取消
            </Button>
            <Button
              disabled={pushInvBusy}
              onClick={submitPushToInventory}
            >
              {pushInvBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              加入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量推到本站(模板复用)弹窗 — 选 site + template, 一次性把
          多个 key 创建为账号 + 建 binding。配置完全继承模板, 只换
          base_url + api_key + 账号名。 */}
      <Dialog open={bulkPushOpen} onOpenChange={setBulkPushOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量加到本站(用模板配置)</DialogTitle>
            <DialogDescription>
              已勾选 {selectedKeyIds.size} 个 key · 将复用模板账号的
              platform / 并发 / 优先级 / 倍率 / 分组 / model_mapping
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>目标站点</Label>
              <Select
                value={bulkPushForm.siteAccountId}
                onValueChange={(v) => {
                  setBulkPushForm((f) => ({
                    ...f,
                    siteAccountId: v,
                    templateRemoteAccountId: "",
                  }));
                  if (v) void loadTemplateAccounts(Number(v));
                  else setTemplateAccounts([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择站点" />
                </SelectTrigger>
                <SelectContent>
                  {siteAccounts.map((s) => (
                    <SelectItem key={String(s.id)} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {loadingTemplates
                  ? "模板账号(加载中…)"
                  : `模板账号(共 ${templateAccounts.length} 个)`}
              </Label>
              <Input
                placeholder="输入名字搜索…"
                disabled={!bulkPushForm.siteAccountId || loadingTemplates}
                list="template-accounts-list"
                value={
                  templateAccounts.find(
                    (t) => String(t.remoteAccountId) === bulkPushForm.templateRemoteAccountId,
                  )?.name ?? bulkPushForm.templateRemoteAccountId
                }
                onChange={(e) => {
                  const val = e.target.value;
                  // Check if the entered value matches a template account name
                  const match = templateAccounts.find((t) => t.name === val);
                  setBulkPushForm((f) => ({
                    ...f,
                    templateRemoteAccountId: match ? String(match.remoteAccountId) : "",
                  }));
                }}
              />
              <datalist id="template-accounts-list">
                {templateAccounts.map((t) => (
                  <option key={t.remoteAccountId} value={t.name} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                新账号的 platform / 并发 / 优先级 / 倍率 / 分组 / model_mapping 等都会跟此账号一致
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>账号名前缀(可空)</Label>
                <Input
                  className="h-8"
                  value={bulkPushForm.namePrefix}
                  onChange={(e) =>
                    setBulkPushForm((f) => ({ ...f, namePrefix: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>账号名后缀(可空)</Label>
                <Input
                  className="h-8"
                  value={bulkPushForm.nameSuffix}
                  onChange={(e) =>
                    setBulkPushForm((f) => ({ ...f, nameSuffix: e.target.value }))
                  }
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              新账号名 = 前缀 + 上游 key 名 + 后缀。重名时 sub2api 会报错,
              失败的 key 会在结果里列出, 不影响其他成功创建的。
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkPushOpen(false)}>
              取消
            </Button>
            <Button
              disabled={bulkPushBusy}
              onClick={submitBulkPush}
            >
              {bulkPushBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              推送 {selectedKeyIds.size} 个 key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "→ 本站" 弹窗: 选目标站点+填表 → 创建账号 + 建 binding */}
      <Dialog open={pushSiteKey !== null} onOpenChange={(v) => { if (!v) setPushSiteKey(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              添加到本站 · {pushSiteKey?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              在选定的站点账号上创建一个 sub2api admin 账号 ,
              credentials 用此 upstream key, 然后自动建 binding。
            </p>
            <div className="space-y-1.5">
              <Label>目标站点账号</Label>
              <Select
                value={pushSiteForm.siteAccountId}
                onValueChange={(v) => {
                  setPushSiteForm((f) => ({ ...f, siteAccountId: v }));
                  if (v) loadSiteGroups(Number(v));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择站点" />
                </SelectTrigger>
                <SelectContent>
                  {siteAccounts.map((s) => (
                    <SelectItem key={String(s.id)} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>账号名称</Label>
              <Input
                value={pushSiteForm.name}
                onChange={(e) =>
                  setPushSiteForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                分组(可多选)
                {loadingSiteGroups && (
                  <span className="ml-1 text-muted-foreground/70">加载中…</span>
                )}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {!pushSiteForm.siteAccountId ? (
                  <span className="text-xs text-muted-foreground/70">
                    先选目标站点账号
                  </span>
                ) : siteGroups.length === 0 && !loadingSiteGroups ? (
                  <div className="space-y-1.5 w-full">
                    <Label>分组 IDs (逗号分隔)</Label>
                    <Input
                      className="h-8"
                      placeholder="例如 1,2"
                      value={pushSiteForm.groupIds}
                      onChange={(e) =>
                        setPushSiteForm((f) => ({ ...f, groupIds: e.target.value }))
                      }
                    />
                  </div>
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
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs border",
                          on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/60 border-border",
                        )}
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
              <div className="space-y-1.5">
                <Label>并发</Label>
                <Input
                  type="number"
                  value={pushSiteForm.concurrency}
                  onChange={(e) =>
                    setPushSiteForm((f) => ({ ...f, concurrency: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Input
                  type="number"
                  value={pushSiteForm.priority}
                  onChange={(e) =>
                    setPushSiteForm((f) => ({ ...f, priority: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">数字越小越优先 (默认 1)</p>
              </div>
              <div className="space-y-1.5">
                <Label>rate_multiplier</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={pushSiteForm.rateMultiplier}
                  onChange={(e) =>
                    setPushSiteForm((f) => ({ ...f, rateMultiplier: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">账号倍率</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>平台</Label>
                <Select
                  value={pushSiteForm.platform}
                  onValueChange={(v) =>
                    setPushSiteForm((f) => ({ ...f, platform: v }))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {pushSiteForm.platform === "gemini" ? (
                <div className="space-y-1.5">
                  <Label>Gemini tier</Label>
                  <Select
                    value={pushSiteForm.geminiTier}
                    onValueChange={(v) =>
                      setPushSiteForm((f) => ({ ...f, geminiTier: v }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aistudio_paid">AI Studio Paid</SelectItem>
                      <SelectItem value="aistudio_free">AI Studio Free</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>type</Label>
                  <Input
                    className="h-8"
                    value="apikey"
                    readOnly
                  />
                  <p className="text-xs text-muted-foreground">type 固定 apikey</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPushSiteKey(null)}>
              取消
            </Button>
            <Button
              disabled={pushSiteBusy}
              onClick={submitPushToSite}
            >
              {pushSiteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              创建+绑定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onToggleHidden,
  onRemove,
}: {
  a: UpstreamAccount;
  busy: boolean;
  inv: InventoryItem[];
  isBest: (it: InventoryItem) => boolean;
  categoryFilter: string;
  onClickKeys: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted/60 cursor-pointer border border-border/30"
      onClick={onClickKeys}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          <span className="font-medium text-sm truncate">{a.name}</span>
          <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
            {a.type}
          </Badge>
          {a.lastSyncError && (
            <Badge
              variant="destructive"
              className="h-5 text-[10px] px-1.5"
              title={a.lastSyncError}
            >
              ⚠ 同步失败
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 text-xs">
          <div className="flex flex-col items-end leading-tight w-16">
            <span className="text-muted-foreground/70">今日</span>
            <span
              className={cn(
                "tabular-nums",
                (a.todayCost ?? 0) > 0 ? "font-semibold" : "text-muted-foreground/70",
              )}
            >
              ${fmtMoneyShort(a.todayCost ?? 0)}
            </span>
          </div>
          <div className="flex flex-col items-end leading-tight w-20">
            <span className="text-muted-foreground/70">余额</span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                a.balance == null
                  ? "text-muted-foreground/70"
                  : a.balance > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
              )}
            >
              {a.balance == null ? "—" : `$${fmtMoneyShort(a.balance)}`}
            </span>
          </div>
          <span className="text-muted-foreground/70 hidden md:inline">
            {a._count?.keys ?? 0} keys
          </span>
          <div
            className="flex gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              onClick={onRefresh}
              disabled={busy}
              title="刷新+同步"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              onClick={onEdit}
              title="编辑"
            >
              <Pencil size={13} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              onClick={onToggleHidden}
              title={a.hidden ? "取消隐藏" : "隐藏"}
            >
              {a.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onRemove}
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
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  best
                    ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30"
                    : "bg-muted/60 border-border",
                )}
                title={it.note || undefined}
                onClick={(e) => e.stopPropagation()}
              >
                {best && "🏆 "}
                <b>{it.name}</b>{" "}
                <span className={best ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground"}>
                  {it.price || "—"}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {inv.length === 0 && categoryFilter !== TAB_ALL && (
        <div className="text-[10px] text-muted-foreground/70 pl-1">
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
        className="h-7 w-20"
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        step={0.01}
        min={0}
      />
      {dirty && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          className="h-7 min-w-0 px-2"
          onClick={async () => {
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
                toast.error("保存失败");
                return;
              }
              toast.success("已保存");
              onSaved(n);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
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
      <span className="text-muted-foreground/70 flex items-center gap-1 w-12 shrink-0">
        {icon}
        {label}
      </span>
      <span
        className={cn("flex-1 truncate", mono && "font-mono")}
        title={value}
      >
        {value}
      </span>
      {after}
      {onCopy && (
        <button
          className="text-muted-foreground/70 hover:text-foreground"
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
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="inventory">货源</TabsTrigger>
        <TabsTrigger value="creds">凭据</TabsTrigger>
        <TabsTrigger value="notes">备注</TabsTrigger>
      </TabsList>
      <TabsContent value="inventory">
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">名称</Label>
              <Input
                className="h-8"
                placeholder="Claude Sonnet"
                value={invDraft.name}
                onChange={(e) =>
                  setInvDraft({ ...invDraft, name: e.target.value })
                }
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">价格</Label>
              <Input
                className="h-8"
                placeholder="$5/M"
                value={invDraft.price ?? ""}
                onChange={(e) =>
                  setInvDraft({ ...invDraft, price: e.target.value })
                }
              />
            </div>
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">备注</Label>
              <Input
                className="h-8"
                placeholder="可选"
                value={invDraft.note ?? ""}
                onChange={(e) => setInvDraft({ ...invDraft, note: e.target.value })}
              />
            </div>
            <Button
              size="icon-sm"
              variant="secondary"
              className="col-span-1"
              onClick={addInventoryDraft}
              disabled={!invDraft.name.trim()}
            >
              <Plus size={14} />
            </Button>
          </div>
          {invDraft.name.trim() && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ 上方有未添加的草稿「{invDraft.name}」，点 + 添加；保存时也会自动加入
            </p>
          )}
          {form.inventory.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 italic">
              未添加货源。填上面的输入框 + 点 + 添加。
            </p>
          ) : (
            <div className="space-y-2">
              {form.inventory.map((it, i) => {
                const itemCats = it.categories ?? [];
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-border p-2.5 bg-muted/30"
                  >
                    <div className="flex items-start gap-2 justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{it.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          价格 <b>{it.price || "—"}</b>
                          {it.note && (
                            <span className="text-muted-foreground/70">
                              {" "}
                              · {it.note}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeInventory(i)}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                    {/* 该货源所属分类: 候选 = 全部 UpstreamCategory.
                        留空 = 只在"全部" Tab 显示 (其它分类 Tab 不会出现这条货源). */}
                    {categoryList.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-[10px] text-muted-foreground/70 self-center">
                          属于分类:
                        </span>
                        {categoryList.map((c) => {
                          const on = itemCats.includes(c.name);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleInventoryCategory(i, c.name)}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                                on
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/60 border-border hover:bg-muted",
                              )}
                            >
                              {on ? "✓ " : ""}
                              {c.name}
                            </button>
                          );
                        })}
                        {itemCats.length === 0 && (
                          <span className="text-[10px] text-muted-foreground/70 self-center">
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
      </TabsContent>
      <TabsContent value="creds">
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>名称</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          {isNew && (
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, type: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sub2api">sub2api</SelectItem>
                  <SelectItem value="newapi">newapi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {/* 渠道本身不再有分类概念 — 分类只属于"货源"条目 (在下面"货源"
              Tab 里配置). 表单底层 form.categories 留空数组提交即可。 */}
          <div className="space-y-1.5">
            <Label>上游/货源 (可选)</Label>
            <Input
              placeholder="输入或选择供应商名"
              list="supplier-options-list"
              value={form.supplier}
              onChange={(e) =>
                setForm((f) => ({ ...f, supplier: e.target.value }))
              }
            />
            <datalist id="supplier-options-list">
              {supplierOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              同名 supplier 在管理页会聚成一张卡。留空 = 散户渠道。已有的可从下拉选,也可手填新名。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              placeholder="http://1.2.3.4:8080"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email / 用户名</Label>
            <Input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">newapi 的话填用户名（不是邮箱），sub2api 填邮箱</p>
          </div>
          <div className="space-y-1.5">
            <Label>{isNew ? "密码" : "新密码（留空则不修改）"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {isNew
                ? "Access Token（可选，跳过登录）"
                : "Access Token（留空则不修改）"}
            </Label>
            <Input
              type="password"
              value={form.accessToken}
              onChange={(e) =>
                setForm((f) => ({ ...f, accessToken: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              粘贴手动登录获取的 token，sub2api 渠道有 cf 盾时可绕过登录。token 过期后会自动尝试用上面的账号密码 relogin；只填 token 没填账号密码则会报错，需手动更新。
            </p>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="notes">
        <div className="pt-2 space-y-1.5">
          <Label>备注</Label>
          <Textarea
            rows={6}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">续费提醒、合同细节、联系人等。无格式要求</p>
        </div>
      </TabsContent>
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
  open,
  onOpenChange,
}: {
  open: boolean;
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
    if (open) load();
  }, [open]);

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
        toast.error(`保存失败: ${String(j.error || r.status)}`);
        return;
      }
      const j = (await r.json()) as { updated: number };
      toast.success(`已保存 ${j.updated} 个渠道`);
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
      toast.error(`触发失败: ${String(j.error || r.status)}`);
      return;
    }
    toast.success("已触发一次检测 (受 intervalMin 节流; 想立刻发邮件可临时把间隔改成 1 分钟)");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell size={16} /> 渠道余额提醒
          </DialogTitle>
          <DialogDescription>
            跌破阈值 → 邮件提醒;充值回到阈值之上后,下次再跌破时重新提醒。
            邮件使用「设置」页里配置的发件/收件邮箱。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              className="h-8 flex-1 min-w-[200px]"
              placeholder="按渠道名 / 货源筛选…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              已启用 {enabledCount} / {items.length}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={runCheckNow}
              disabled={loading || saving}
            >
              立即触发一次检测
            </Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>渠道</TableHead>
                  <TableHead>当前余额</TableHead>
                  <TableHead>启用</TableHead>
                  <TableHead>间隔(分)</TableHead>
                  <TableHead>阈值(USD, 多个用空格/逗号/换行)</TableHead>
                  <TableHead>已触发</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      没有匹配的渠道
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{it.name}</span>
                          {it.supplier && (
                            <span className="text-[10px] text-muted-foreground/70">
                              {it.supplier}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "font-mono",
                            it.balance == null
                              ? "text-muted-foreground/70"
                              : it.balance > 0
                                ? "text-foreground"
                                : "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {it.balance == null
                            ? "—"
                            : `$${fmtMoneyShort(it.balance)}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={it.enabled}
                          onCheckedChange={(v) =>
                            update(it.id, { enabled: !!v })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-20"
                          min={1}
                          value={String(it.intervalMin)}
                          onChange={(e) =>
                            update(it.id, {
                              intervalMin: Math.max(
                                1,
                                Math.floor(Number(e.target.value) || 60),
                              ),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8"
                          placeholder="例: 10000, 5000, 1000"
                          value={draftText[it.id] ?? ""}
                          onChange={(e) =>
                            setDraftText((m) => ({ ...m, [it.id]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {it.fired.length === 0 ? (
                          <span className="text-muted-foreground/70 text-xs">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {it.fired.map((t) => (
                              <Badge
                                key={t}
                                variant="warning"
                                className="h-5 text-[10px] px-1.5"
                              >
                                ${fmtMoneyShort(t)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存全部
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  open,
  onOpenChange,
}: {
  open: boolean;
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
    if (!open) return;
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
        toast.error("加载站点失败");
      });
  }, [open]);

  // 切换站点时拉该站点的分组列表 + 预设列表
  useEffect(() => {
    if (!open) return;
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
          toast.error("加载分组失败");
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
  }, [open, form.siteAccountId]);

  async function submit() {
    const siteId = Number(form.siteAccountId);
    if (!siteId) {
      toast.warning("请选择目标站点");
      return;
    }
    // namePrefix 可空 — 后端留空时直接用 sk 当账号名
    const namePrefix = form.namePrefix.trim();
    const concurrency = Math.max(1, Math.floor(Number(form.concurrency) || 0));
    if (!concurrency) {
      toast.warning("并发数非法");
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
      toast.warning("请粘贴至少 1 个 token");
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
        toast.error(`提交失败: ${String(j.error || r.status)}`);
        return;
      }
      setResults(j.results || []);
      setStartIdx(j.startIdx ?? null);
      if (j.failed > 0) {
        toast.warning(`录入完成: 成功 ${j.success} / 共 ${j.total}, 失败 ${j.failed}`);
      } else {
        toast.success(`录入完成: 成功 ${j.success} / 共 ${j.total}, 失败 ${j.failed}`);
      }
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
      toast("没有失败行");
      return;
    }
    void copyToClipboard(failed).then((ok) => {
      if (ok) toast.success("失败列表已复制");
      else toast.error("复制失败");
    });
  }

  // Multi-select groups via Popover+Checkbox pattern
  const groupLabel = loadingGroups
    ? "分组(加载中…)"
    : form.siteAccountId
      ? `分组 (共 ${groups.length} 个, 可多选)`
      : "分组 (先选站点)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量录入 sk-ant Token (setup-token)</DialogTitle>
          <DialogDescription>
            每个 sk 走完整 2 步:cookie-auth 换 oauth → 创建账号 ·
            失败行会标 cookie-auth/create 哪个阶段挂了
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>目标站点</Label>
            <Select
              value={form.siteAccountId}
              onValueChange={(v) => setForm((f) => ({ ...f, siteAccountId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择站点" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>名称前缀(可空)</Label>
              <Input
                className="h-8"
                placeholder="留空 = 用 sk 当账号名"
                value={form.namePrefix}
                onChange={(e) =>
                  setForm((f) => ({ ...f, namePrefix: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">留空: 账号名 = sk 字符串 (方便人工对账)。填了: prefix-N, N 自动续上已有最大值。</p>
            </div>
            <div className="space-y-1.5">
              <Label>{groupLabel}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between h-8 text-sm font-normal"
                    disabled={!form.siteAccountId || loadingGroups}
                  >
                    <span className="truncate">
                      {form.groupIds.length === 0
                        ? "选择分组…"
                        : form.groupIds
                            .map((id) => {
                              const g = groups.find((x) => x.id === id);
                              return g ? g.name : `#${id}`;
                            })
                            .join(", ")}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {groups.map((g) => {
                      const checked = form.groupIds.includes(g.id);
                      return (
                        <label
                          key={g.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              if (v) {
                                setForm((f) => ({ ...f, groupIds: [...f.groupIds, g.id] }));
                              } else {
                                setForm((f) => ({ ...f, groupIds: f.groupIds.filter((x) => x !== g.id) }));
                              }
                            }}
                          />
                          <span>
                            {g.name}
                            {g.rate_multiplier != null
                              ? ` ×${g.rate_multiplier}`
                              : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {form.siteAccountId && presets.length > 0 && (
            <div className="space-y-1.5">
              <Label>{`套用预设 (该站 ${presets.length} 个可选)`}</Label>
              <Select
                value=""
                onValueChange={(v) => {
                  const preset = presets.find((p) => String(p.id) === v);
                  if (!preset) return;
                  const valid = new Set(groups.map((g) => g.id));
                  const arr = preset.groupIds.filter((n) => valid.has(n));
                  setForm((f) => ({ ...f, groupIds: arr }));
                  if (arr.length < preset.groupIds.length) {
                    toast.warning(
                      `预设里 ${preset.groupIds.length - arr.length} 个分组当前站点不存在, 已忽略`,
                    );
                  }
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="选择预设以回填分组" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={String(p.id)} value={String(p.id)}>
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-[10px] text-muted-foreground/70">
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
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">选预设 = 一键回填分组; 选后还能手动加/减</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>并发数</Label>
              <Input
                type="number"
                className="h-8"
                min={1}
                value={form.concurrency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, concurrency: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>5h 金额上限 USD</Label>
              <Input
                type="number"
                className="h-8"
                min={0}
                step="0.5"
                value={form.windowCostLimit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, windowCostLimit: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">0 = 不启用</p>
            </div>
            <div className="space-y-1.5">
              <Label>倍率</Label>
              <Input
                type="number"
                className="h-8"
                min={0}
                step="0.01"
                value={form.rateMultiplier}
                onChange={(e) =>
                  setForm((f) => ({ ...f, rateMultiplier: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>sk-ant Token 列表</Label>
            <Textarea
              rows={6}
              value={form.tokens}
              onChange={(e) =>
                setForm((f) => ({ ...f, tokens: e.target.value }))
              }
              placeholder={"sk-ant-...\nsk-ant-...\nsk-ant-..."}
            />
            <p className="text-xs text-muted-foreground">一行一个; 自动忽略空行 + 前后空格 + 不以 sk-ant- 开头的会标记失败</p>
          </div>

          {results && (
            <div className="border border-border rounded-lg p-2">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    成功 {results.filter((r) => r.ok).length}
                  </span>
                  <span className="text-muted-foreground/70 mx-2">·</span>
                  <span className="text-destructive">
                    失败 {results.filter((r) => !r.ok).length}
                  </span>
                  {startIdx != null && (
                    <span className="text-muted-foreground/70 ml-2">
                      (起始编号 {startIdx})
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  onClick={copyFailedTokens}
                >
                  复制失败行
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>状态</TableHead>
                    <TableHead>阶段</TableHead>
                    <TableHead>账号名</TableHead>
                    <TableHead>token</TableHead>
                    <TableHead>错误</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant={r.ok ? "success" : "destructive"}>
                          {r.ok ? "成功" : "失败"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.stage ? (
                          <Badge
                            variant={
                              r.stage === "cookie-auth"
                                ? "warning"
                                : "default"
                            }
                          >
                            {r.stage}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/70 text-xs">
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
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.tokenMasked}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-destructive break-all">
                          {r.error ?? ""}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            提交录入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  open,
  onOpenChange,
}: {
  open: boolean;
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
    if (!open) return;
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
        toast.error("加载站点失败");
      });
  }, [open]);

  useEffect(() => {
    if (!open || !siteId) {
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
          toast.error("加载分组失败");
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
  }, [open, siteId]);

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
      toast.warning("预设名必填");
      return;
    }
    if (editing.groupIds.length === 0) {
      toast.warning("至少选 1 个分组");
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
        toast.error(`保存失败: ${String(j.error || r.status)}`);
        return;
      }
      toast.success("已保存");
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
      toast.error("删除失败");
      return;
    }
    setPresets((arr) => arr.filter((x) => x.id !== p.id));
    toast.success("已删除");
  }

  const groupName = (id: number): string => {
    const g = groups.find((x) => x.id === id);
    return g ? g.name : `#${id}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>分组预设管理</DialogTitle>
          <DialogDescription>
            按本站维护常用分组集合 · 录入 sk-ant 等场景一键回填
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>本站</Label>
            <Select
              value={siteId}
              onValueChange={(v) => {
                setSiteId(v);
                setEditing(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择站点" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!siteId ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              请先选一个本站
            </p>
          ) : loadingPresets || loadingGroups ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  共 {presets.length} 个预设
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={startNew}
                >
                  <Plus size={12} />
                  新建预设
                </Button>
              </div>

              {editing && (
                <Card className="border border-primary/40 bg-primary/5">
                  <CardContent className="space-y-2 pt-4">
                    <div className="text-xs text-foreground/80 font-medium">
                      {editing.id ? `编辑预设 #${editing.id}` : "新建预设"}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">预设名称</Label>
                      <Input
                        className="h-8"
                        placeholder="例: claude 全套"
                        value={editing.name}
                        onChange={(e) =>
                          setEditing((prev) =>
                            prev ? { ...prev, name: e.target.value } : prev,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{`分组(共 ${groups.length} 个, 可多选)`}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-between h-8 text-sm font-normal"
                          >
                            <span className="truncate">
                              {editing.groupIds.length === 0
                                ? "选择分组…"
                                : editing.groupIds
                                    .map((id) => groupName(id))
                                    .join(", ")}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="start">
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {groups.map((g) => {
                              const checked = editing.groupIds.includes(g.id);
                              return (
                                <label
                                  key={g.id}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => {
                                      setEditing((prev) => {
                                        if (!prev) return prev;
                                        if (v) {
                                          return { ...prev, groupIds: [...prev.groupIds, g.id] };
                                        } else {
                                          return { ...prev, groupIds: prev.groupIds.filter((x) => x !== g.id) };
                                        }
                                      });
                                    }}
                                  />
                                  <span>
                                    {g.name}
                                    {g.rate_multiplier != null
                                      ? ` ×${g.rate_multiplier}`
                                      : ""}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={save}
                      >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        保存
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {presets.length === 0 && !editing ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  还没有预设, 点「新建预设」开始
                </p>
              ) : presets.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>包含分组</TableHead>
                      <TableHead>{" "}</TableHead>
                    </TableRow>
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
                              <Badge
                                key={gid}
                                variant="secondary"
                                className="h-5 text-[10px] px-1.5"
                              >
                                {groupName(gid)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => startEdit(p)}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                              onClick={() => remove(p)}
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
