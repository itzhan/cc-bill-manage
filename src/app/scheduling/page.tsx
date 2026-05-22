"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  CardHeader,
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
  Switch,
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
  Activity,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  TestTube2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import Shell from "@/components/Shell";
import SmartDispatchPanel from "@/components/SmartDispatchPanel";
import StatCard from "@/components/StatCard";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtMoneyShort } from "@/lib/format";

const POLL_MS = 2000;
const STRUCTURE_MS = 60_000;
const BINDINGS_MS = 60_000;

interface SiteRow {
  id: number;
  name: string;
}

interface GroupRow {
  id: number;
  name: string;
  rate_multiplier: number;
  status: string;
}

interface AccountRow {
  id: number;
  name: string;
  status?: string;
  concurrency?: number;
  priority?: number;
  rate_multiplier?: number;
  group_ids?: number[];
  platform?: string;
  type?: string;
  // sub2api keeps status=active even when the account is failing; the real
  // signal lives in error_message. Treat non-empty as a soft "error" flag.
  error_message?: string | null;
  // Dedicated "participate in dispatch" flag on sub2api admin account.
  // When false, the dispatcher excludes this account regardless of status.
  schedulable?: boolean;
  // Free-text annotation on the channel (sub2api `notes` field).
  notes?: string | null;
}

interface ConcurrencyState {
  account?: Record<
    string,
    {
      current_in_use: number;
      max_capacity?: number;
      group_id?: number;
      group_name?: string;
      waiting_in_queue?: number;
    }
  >;
}

function isErrored(a: AccountRow): boolean {
  return (
    a.status === "error" ||
    (typeof a.error_message === "string" && a.error_message.trim().length > 0)
  );
}

interface BindingInfo {
  bindingId: number;
  maxConcurrency: number | null;
  upstreamKeyName: string;
  upstreamAccountName: string;
  upstreamGroupName: string;
  upstreamGroupRateMultiplier: number;
  upstreamEffectiveRateMultiplier: number;
  upstreamHasExclusiveRate: boolean;
}

interface GroupUsersRow {
  group_id: number;
  group_name: string;
  users: Array<{
    user_id: number;
    email?: string;
    requests: number;
    cost: number;
    actual_cost: number;
  }>;
}

interface CustomGroupRow {
  id: number;
  siteAccountId: number;
  name: string;
  groupIds: number[];
}

interface TemplateRow {
  id: number;
  name: string;
  siteAccountId: number | null;
  platform: string;
  type: string;
  rateMultiplier: number;
  groupIds: string;
  modelList: string;
  confirmMixedChannelRisk: boolean;
  notes: string | null;
}

export default function SchedulingPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [concurrency, setConcurrency] = useState<ConcurrencyState>({});
  // Site-level RPM/TPM (polled every 2s alongside concurrency).
  const [siteRate, setSiteRate] = useState<{ rpm: number; tpm: number } | null>(null);
  // Per-user real-time concurrency. Used by the top-5 panel above the
  // channels list. `enabled=false` when sub2api监控未开启 → 隐藏面板。
  const [userConc, setUserConc] = useState<{
    enabled: boolean;
    user: Record<string, { user_id: number; user_email?: string; username?: string; current_in_use: number; max_capacity?: number }>;
  } | null>(null);
  const [bindings, setBindings] = useState<
    Record<string, BindingInfo[]>
  >({});
  const [groupUsage, setGroupUsage] = useState<
    Record<string, { cost: number; actualCost: number; requests: number }>
  >({});
  const [groupUsers, setGroupUsers] = useState<GroupUsersRow[]>([]);
  const [accountStats, setAccountStats] = useState<
    Record<
      string,
      {
        requests: number;
        tokens: number;
        cost: number;
        user_cost: number;
        standard_cost?: number;
      }
    >
  >({});
  const [view, setView] = useState<"channels" | "users" | "errors">("channels");
  const [structureLoading, setStructureLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAcc, setBusyAcc] = useState<number | null>(null);
  const [editAcc, setEditAcc] = useState<AccountRow | null>(null);
  const [editConcurrency, setEditConcurrency] = useState<string>("");
  const [editPriority, setEditPriority] = useState<string>("");
  const [editActive, setEditActive] = useState(true);
  const [editSchedulable, setEditSchedulable] = useState(true);
  const [editGroupIds, setEditGroupIds] = useState<Set<string>>(new Set());
  const [editNotes, setEditNotes] = useState<string>("");
  // Model whitelist editing — loaded when the edit modal opens.
  const [editModels, setEditModels] = useState<string[]>([]);
  const [editModelsInitial, setEditModelsInitial] = useState<string[]>([]);
  const [editModelsLoading, setEditModelsLoading] = useState(false);
  const [editModelInput, setEditModelInput] = useState<string>("");
  // Which model to send through "测试此渠道". Defaults to opus-4-6.
  const [editTestModel, setEditTestModel] = useState<string>("claude-opus-4-6");
  // Credentials block displayed at the top of the edit modal — fetched on
  // open via GET /channels/[id], not bundled into the list payload.
  const [editCreds, setEditCreds] = useState<{
    baseUrl: string;
    apiKey: string;
  } | null>(null);
  const [editCredsLoading, setEditCredsLoading] = useState(false);
  const [editKeyRevealed, setEditKeyRevealed] = useState(false);
  // statusFilter stays per-browser (it's a quick toggle, not a shared
  // policy). excludePrefixes is now persisted server-side via Settings so
  // every operator sees the same exclusion list.
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [excludePrefixes, setExcludePrefixes] = useState<string>("");
  const [prefixDraft, setPrefixDraft] = useState<string>("");
  const [savingPrefixes, setSavingPrefixes] = useState(false);

  useEffect(() => {
    // statusFilter still cached locally
    try {
      const sf = localStorage.getItem("scheduling.statusFilter");
      if (sf === "all" || sf === "active" || sf === "inactive")
        setStatusFilter(sf);
    } catch {
      // ignore
    }
    // excludePrefixes is sourced from /api/settings
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const ep =
          (j.settings?.schedulingExcludePrefixes as string | null | undefined) ??
          "";
        setExcludePrefixes(ep);
        setPrefixDraft(ep);
      })
      .catch(() => {
        // network failure: keep defaults (empty)
      });
  }, []);

  function persistStatus(v: "all" | "active" | "inactive") {
    setStatusFilter(v);
    try {
      localStorage.setItem("scheduling.statusFilter", v);
    } catch {
      // ignore
    }
  }
  async function persistPrefixes(v: string): Promise<boolean> {
    setSavingPrefixes(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedulingExcludePrefixes: v || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({
          title: "保存失败",
          description: j.error,
          color: "danger",
        });
        return false;
      }
      // Optimistic: trust the value we just sent.
      setExcludePrefixes(v);
      addToast({ title: "已保存（对所有人生效）", color: "success" });
      return true;
    } catch (e) {
      addToast({
        title: "保存失败",
        description: e instanceof Error ? e.message : String(e),
        color: "danger",
      });
      return false;
    } finally {
      setSavingPrefixes(false);
    }
  }

  const newDlg = useDisclosure();
  const tplDlg = useDisclosure();
  const editDlg = useDisclosure();
  const filterDlg = useDisclosure();
  const cgrpDlg = useDisclosure();
  const smartDlg = useDisclosure();
  const [customGroups, setCustomGroups] = useState<CustomGroupRow[]>([]);
  const [smartScope, setSmartScope] = useState<{
    groupIds: number[];
    label: string;
  } | null>(null);

  // Load sub2api sites once
  useEffect(() => {
    fetch("/api/scheduling/sites", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const items = (j.items || []) as SiteRow[];
        setSites(items);
        if (items.length && siteId == null) setSiteId(items[0].id);
      });
  }, [siteId]);

  // localStorage cache so the page renders instantly on entry (no waiting
  // for the slow group-usage fan-out). Auto-poll is OFF; only the explicit
  // 刷新 button refetches structure / bindings / group-usage / group-users.
  // Concurrency stays on a 2s poll because it's the live indicator.
  const cacheKey = (k: string) =>
    siteId != null ? `scheduling.cache.site${siteId}.${k}` : "";
  const cacheGet = useCallback(
    <T,>(k: string): T | null => {
      const key = cacheKey(k);
      if (!key) return null;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId],
  );
  const cacheSet = useCallback(
    (k: string, v: unknown) => {
      const key = cacheKey(k);
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // quota etc. — ignore
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId],
  );
  const [cacheStamp, setCacheStamp] = useState<string | null>(null);

  const loadStructure = useCallback(async () => {
    if (siteId == null) return;
    setStructureLoading(true);
    try {
      const r = await fetch(`/api/scheduling/${siteId}/structure`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `structure ${r.status}`);
        return;
      }
      setError(null);
      const groupsArr = j.groups || [];
      const accountsArr = j.accounts || [];
      setGroups(groupsArr);
      setAccounts(accountsArr);
      cacheSet("structure", { groups: groupsArr, accounts: accountsArr });
    } catch (e) {
      setError(String(e));
    } finally {
      setStructureLoading(false);
    }
  }, [siteId, cacheSet]);

  const loadCustomGroups = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(
        `/api/scheduling/custom-groups?siteId=${siteId}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (r.ok) setCustomGroups(j.items || []);
    } catch {
      // keep prior list on transient failure
    }
  }, [siteId]);

  const loadConcurrency = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/concurrency`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) setConcurrency(j);
    } catch {
      // soft-fail; next tick will retry
    }
  }, [siteId]);

  const loadSiteRate = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/dashboard-stats`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok)
        setSiteRate({
          rpm: typeof j.rpm === "number" ? j.rpm : 0,
          tpm: typeof j.tpm === "number" ? j.tpm : 0,
        });
    } catch {
      // soft-fail
    }
  }, [siteId]);

  const loadUserConc = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/user-concurrency`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        setUserConc({
          enabled: j.enabled !== false,
          user: j.user ?? {},
        });
      }
    } catch {
      // soft-fail
    }
  }, [siteId]);

  const loadBindings = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/bindings`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        const m = j.byRemoteAccountId || {};
        setBindings(m);
        cacheSet("bindings", m);
      }
    } catch {
      // ignore
    }
  }, [siteId, cacheSet]);

  const loadGroupUsage = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/group-usage`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        const m = j.byGroup || {};
        setGroupUsage(m);
        cacheSet("groupUsage", m);
      }
    } catch {
      // ignore
    }
  }, [siteId, cacheSet]);

  const loadAccountStats = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/today-stats`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        const m = j.stats || {};
        setAccountStats(m);
        cacheSet("accountStats", m);
      }
    } catch {
      // ignore
    }
  }, [siteId, cacheSet]);

  const loadGroupUsers = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/group-users`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        const arr = j.groups || [];
        setGroupUsers(arr);
        cacheSet("groupUsers", arr);
      }
    } catch {
      // ignore
    }
  }, [siteId, cacheSet]);

  // Manual refresh: fetches everything fresh and stamps the cache.
  const refreshAll = useCallback(async () => {
    if (siteId == null) return;
    await Promise.all([
      loadStructure(),
      loadBindings(),
      loadConcurrency(),
      loadGroupUsage(),
      loadAccountStats(),
      loadCustomGroups(),
      ...(view === "users" ? [loadGroupUsers()] : []),
    ]);
    const now = new Date().toISOString();
    cacheSet("stamp", now);
    setCacheStamp(now);
  }, [
    siteId,
    view,
    loadStructure,
    loadBindings,
    loadConcurrency,
    loadGroupUsage,
    loadAccountStats,
    loadGroupUsers,
    loadCustomGroups,
    cacheSet,
  ]);

  const visibleRef = useRef<boolean>(
    typeof document === "undefined" ? true : !document.hidden,
  );

  // On site change: hydrate from cache (instant render). Only fetch fresh
  // when there's no cache (first visit) — otherwise the user must hit 刷新.
  useEffect(() => {
    if (siteId == null) return;
    const cachedStruct = cacheGet<{
      groups: GroupRow[];
      accounts: AccountRow[];
    }>("structure");
    const cachedBindings = cacheGet<Record<string, BindingInfo[]>>("bindings");
    const cachedUsage = cacheGet<typeof groupUsage>("groupUsage");
    const cachedUsers = cacheGet<GroupUsersRow[]>("groupUsers");
    const cachedStats = cacheGet<typeof accountStats>("accountStats");
    const cachedStamp = cacheGet<string>("stamp");
    let hasAny = false;
    if (cachedStruct) {
      setGroups(cachedStruct.groups || []);
      setAccounts(cachedStruct.accounts || []);
      hasAny = true;
    }
    if (cachedBindings) {
      setBindings(cachedBindings);
      hasAny = true;
    }
    if (cachedUsage) {
      setGroupUsage(cachedUsage);
      hasAny = true;
    }
    if (cachedUsers) {
      setGroupUsers(cachedUsers);
    }
    if (cachedStats) {
      setAccountStats(cachedStats);
    }
    if (cachedStamp) setCacheStamp(cachedStamp);
    if (!hasAny) {
      // Cold start — fetch once so the page isn't blank.
      refreshAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Concurrency + site RPM/TPM + per-user concurrency all poll at the same
  // 2s tick — they're the live indicators and all three calls are cheap.
  // Paused while tab is hidden.
  useEffect(() => {
    if (siteId == null) return;
    const fireAll = () => {
      loadConcurrency();
      loadSiteRate();
      loadUserConc();
    };
    fireAll();
    const tick = () => {
      if (!visibleRef.current) return;
      fireAll();
    };
    const t = setInterval(tick, POLL_MS);
    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (!document.hidden) fireAll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [siteId, loadConcurrency, loadSiteRate, loadUserConc]);

  // Group-users view: load on first switch if cache empty.
  useEffect(() => {
    if (siteId == null || view !== "users") return;
    if (groupUsers.length === 0) loadGroupUsers();
    // No interval — explicit refresh only.
  }, [siteId, view, groupUsers.length, loadGroupUsers]);

  // Account today stats: 2-minute auto-poll (cheaper than concurrency,
  // independent cadence). Paused while tab is hidden.
  useEffect(() => {
    if (siteId == null) return;
    const ACCOUNT_STATS_MS = 2 * 60 * 1000;
    const tick = () => {
      if (!visibleRef.current) return;
      loadAccountStats();
    };
    // No initial fetch here — cache hydrate already populated state.
    // First fetch happens at the 2-min tick or when user clicks 刷新.
    const t = setInterval(tick, ACCOUNT_STATS_MS);
    return () => clearInterval(t);
  }, [siteId, loadAccountStats]);

  // === aggregate per group ===
  // Compile exclude prefixes once. Lines starting with # treated as comments.
  const excludeList = useMemo(
    () =>
      excludePrefixes
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#")),
    [excludePrefixes],
  );

  // schedulable === false → user explicitly took the channel out of dispatch.
  // Default-hide; can opt back in via the chip below.
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("scheduling.showUnscheduled");
      if (v === "1") setShowUnscheduled(true);
    } catch {
      // ignore
    }
  }, []);
  function persistShowUnscheduled(v: boolean) {
    setShowUnscheduled(v);
    try {
      localStorage.setItem("scheduling.showUnscheduled", v ? "1" : "0");
    } catch {
      // ignore
    }
  }

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (!showUnscheduled && a.schedulable === false) return false;
      if (statusFilter === "active" && a.status !== "active") return false;
      if (statusFilter === "inactive" && a.status === "active") return false;
      if (
        excludeList.some((p) =>
          (a.name ?? "").toLowerCase().startsWith(p.toLowerCase()),
        )
      ) {
        return false;
      }
      return true;
    });
  }, [accounts, statusFilter, excludeList, showUnscheduled]);

  const unscheduledHiddenCount = useMemo(
    () =>
      showUnscheduled
        ? 0
        : accounts.filter((a) => a.schedulable === false).length,
    [accounts, showUnscheduled],
  );

  const grouped = useMemo(() => {
    const byGroup = new Map<
      number,
      {
        group: GroupRow;
        accounts: AccountRow[];
        // Schedulable=false members of THIS group, regardless of global filter.
        // GroupCard renders these on demand via its 显示未调度 toggle.
        unscheduled: AccountRow[];
        inFlight: number;
        capacity: number;
        active: number;
        inactive: number;
      }
    >();
    for (const g of groups) {
      byGroup.set(g.id, {
        group: g,
        accounts: [],
        unscheduled: [],
        inFlight: 0,
        capacity: 0,
        active: 0,
        inactive: 0,
      });
    }
    for (const a of filteredAccounts) {
      const ids = a.group_ids ?? [];
      for (const gid of ids) {
        const slot = byGroup.get(gid);
        if (!slot) continue;
        slot.accounts.push(a);
        slot.capacity += a.concurrency ?? 0;
        const inflight = concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
        slot.inFlight += inflight;
        if (a.status === "active") slot.active++;
        else slot.inactive++;
      }
    }
    // Build unscheduled list — apply the same name-prefix excludeList
    // (e.g. "az-" / "test-") so cards don't surface accounts the user
    // explicitly hid. Status filter is intentionally NOT applied here:
    // the unscheduled view is its own scope.
    const isExcluded = (n: string) =>
      excludeList.some((p) => n.toLowerCase().startsWith(p.toLowerCase()));
    for (const a of accounts) {
      if (a.schedulable !== false) continue;
      if (isExcluded(a.name ?? "")) continue;
      const ids = a.group_ids ?? [];
      for (const gid of ids) {
        const slot = byGroup.get(gid);
        if (!slot) continue;
        slot.unscheduled.push(a);
      }
    }
    const arr = [...byGroup.values()]
      .filter((g) => g.accounts.length > 0 || g.unscheduled.length > 0)
      .map((g) => ({
        ...g,
        todayCost: groupUsage[String(g.group.id)]?.actualCost ?? 0,
      }));
    // Primary: today's actual cost desc. Tiebreak: in-flight desc.
    arr.sort((a, b) => b.todayCost - a.todayCost || b.inFlight - a.inFlight);
    return arr;
  }, [
    groups,
    filteredAccounts,
    accounts,
    concurrency,
    groupUsage,
    excludeList,
  ]);

  const hiddenCount = accounts.length - filteredAccounts.length;

  async function patchAccount(
    accId: number,
    body: Record<string, unknown>,
  ) {
    if (siteId == null) return;
    setBusyAcc(accId);
    try {
      const r = await fetch(
        `/api/scheduling/${siteId}/channels/${accId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({ title: "更新失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已更新", color: "success" });
      await loadStructure();
    } finally {
      setBusyAcc(null);
    }
  }

  async function testAccount(accId: number, modelId?: string) {
    if (siteId == null) return;
    addToast({ title: "测试中…", color: "default" });
    const r = await fetch(
      `/api/scheduling/${siteId}/channels/${accId}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelId ? { model_id: modelId } : {}),
      },
    );
    const j = await r.json();
    addToast({
      title: j.ok ? "测试成功" : "测试失败",
      description: j.ok ? undefined : (j.output || "").slice(0, 200),
      color: j.ok ? "success" : "danger",
    });
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">资源调度</h1>
          <p className="text-xs text-default-500 mt-0.5">
            按分组聚合 · in-flight 每 2 秒刷新 · 结构数据本地缓存，点刷新更新
            {cacheStamp && (
              <span className="ml-2 text-default-400">
                上次刷新 {new Date(cacheStamp).toLocaleString("zh-CN")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <Select
            size="sm"
            label="站点"
            className="w-full sm:w-[200px]"
            selectedKeys={siteId != null ? new Set([String(siteId)]) : new Set()}
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0];
              if (v) setSiteId(Number(v));
            }}
          >
            {sites.map((s) => (
              <SelectItem key={String(s.id)}>{s.name}</SelectItem>
            ))}
          </Select>
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw size={14} />}
            onPress={() => refreshAll()}
            isLoading={structureLoading}
          >
            刷新
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<SettingsIcon size={14} />}
            onPress={tplDlg.onOpen}
          >
            模板
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Layers size={14} />}
            onPress={cgrpDlg.onOpen}
            isDisabled={siteId == null}
          >
            自定义分组
          </Button>
          <Button
            size="sm"
            color="primary"
            startContent={<Plus size={14} />}
            onPress={newDlg.onOpen}
          >
            新增渠道
          </Button>
        </div>
      </div>

      {/* Filters: status + name-prefix exclusion (persisted to localStorage) */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-default-500">状态</span>
        {(["all", "active", "inactive"] as const).map((v) => (
          <Chip
            key={v}
            size="sm"
            variant={statusFilter === v ? "solid" : "flat"}
            color={statusFilter === v ? "primary" : "default"}
            className="cursor-pointer"
            onClick={() => persistStatus(v)}
          >
            {v === "all" ? "全部" : v === "active" ? "仅启用" : "仅禁用"}
          </Chip>
        ))}
        <Chip
          size="sm"
          variant={showUnscheduled ? "solid" : "flat"}
          color={showUnscheduled ? "primary" : "default"}
          className="cursor-pointer"
          onClick={() => persistShowUnscheduled(!showUnscheduled)}
        >
          {showUnscheduled ? "含未调度" : "仅调度中"}
          {unscheduledHiddenCount > 0 && !showUnscheduled && (
            <span className="ml-1 text-default-400">
              ({unscheduledHiddenCount})
            </span>
          )}
        </Chip>
        <Button
          size="sm"
          variant="flat"
          onPress={() => {
            setPrefixDraft(excludePrefixes);
            filterDlg.onOpen();
          }}
        >
          排除前缀{excludeList.length > 0 && ` (${excludeList.length})`}
        </Button>
        {hiddenCount > 0 && (
          <span className="text-xs text-default-400">
            已隐藏 {hiddenCount} 个账号
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatCard
          label="当前 RPM"
          value={siteRate ? siteRate.rpm.toLocaleString() : "—"}
          icon={Activity}
          accent="primary"
        />
        <StatCard
          label="当前 TPM"
          value={siteRate ? siteRate.tpm.toLocaleString() : "—"}
          accent="success"
        />
      </div>

      <TopUsersPanel userConc={userConc} siteId={siteId} />


      {error && (
        <Card className="mb-4 bg-danger-50 border border-danger-200 shadow-none">
          <CardBody className="text-danger text-sm">{error}</CardBody>
        </Card>
      )}

      <Tabs
        selectedKey={view}
        onSelectionChange={(k) =>
          setView(String(k) as "channels" | "users" | "errors")
        }
        variant="underlined"
        className="mb-4"
        classNames={{ tabList: "px-0" }}
      >
        <Tab key="channels" title="渠道调度" />
        <Tab key="users" title="分组使用" />
        <Tab key="errors" title="错误排行" />
      </Tabs>

      {view === "errors" ? (
        <ErrorRankingView siteId={siteId} />
      ) : view === "users" ? (
        <GroupUsersView
          rows={groupUsers}
          excludeList={excludeList}
        />
      ) : grouped.length === 0 && !structureLoading ? (
        <Card>
          <CardBody className="text-default-500 text-sm">
            没有可显示的分组（或站点尚未拉取结构）。
          </CardBody>
        </Card>
      ) : (
        <>
          {customGroups.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-default-700 mb-2">
                <Layers size={14} className="text-primary" />
                自定义分组
                <span className="text-xs text-default-400 font-normal">
                  ({customGroups.length})
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {customGroups.map((cg) => (
                  <CustomGroupCard
                    key={cg.id}
                    customGroup={cg}
                    siteId={siteId}
                    groups={groups}
                    accounts={accounts}
                    concurrency={concurrency}
                    accountStats={accountStats}
                    onSmartDispatch={(ids, label) => {
                      setSmartScope({ groupIds: ids, label });
                      smartDlg.onOpen();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {grouped.map((g) => (
            <GroupCard
              key={g.group.id}
              group={g.group}
              accounts={g.accounts}
              unscheduled={g.unscheduled}
              inFlight={g.inFlight}
              capacity={g.capacity}
              todayCost={g.todayCost}
              concurrency={concurrency}
              bindings={bindings}
              accountStats={accountStats}
              onEditAccount={(a) => {
                setEditAcc(a);
                setEditConcurrency(String(a.concurrency ?? 0));
                setEditPriority(String(a.priority ?? 0));
                setEditActive(a.status === "active");
                setEditSchedulable(a.schedulable !== false);
                setEditGroupIds(
                  new Set((a.group_ids ?? []).map(String)),
                );
                setEditNotes(a.notes ?? "");
                setEditModels([]);
                setEditModelsInitial([]);
                setEditModelInput("");
                setEditTestModel("claude-opus-4-6");
                setEditModelsLoading(true);
                setEditCreds(null);
                setEditCredsLoading(true);
                setEditKeyRevealed(false);
                if (siteId != null) {
                  fetch(
                    `/api/scheduling/${siteId}/channels/${a.id}/models`,
                    { cache: "no-store" },
                  )
                    .then((r) => r.json())
                    .then((j) => {
                      const ids = (
                        (j.items ?? []) as { id: string }[]
                      ).map((m) => m.id);
                      setEditModels(ids);
                      setEditModelsInitial(ids);
                    })
                    .catch(() => {
                      // leave empty — user can still add manually
                    })
                    .finally(() => setEditModelsLoading(false));
                  // Fetch full account so we can show url + api_key with copy.
                  fetch(`/api/scheduling/${siteId}/channels/${a.id}`, {
                    cache: "no-store",
                  })
                    .then((r) => r.json())
                    .then((j) => {
                      if (j.item) {
                        setEditCreds({
                          baseUrl: String(j.item.baseUrl ?? ""),
                          apiKey: String(j.item.apiKey ?? ""),
                        });
                      }
                    })
                    .catch(() => {})
                    .finally(() => setEditCredsLoading(false));
                }
                editDlg.onOpen();
              }}
              onSmartDispatch={(ids, label) => {
                setSmartScope({ groupIds: ids, label });
                smartDlg.onOpen();
              }}
              onChanged={loadStructure}
              siteId={siteId}
            />
          ))}
        </div>
        </>
      )}

      <SmartDispatchModal
        isOpen={smartDlg.isOpen}
        onClose={() => {
          smartDlg.onClose();
          setSmartScope(null);
        }}
        siteId={siteId}
        scope={smartScope}
        excludeList={excludeList}
        onChanged={() => {
          // refresh structure so the just-enabled accounts disappear
          // from the problem list on next open
          void loadStructure();
        }}
      />

      <CustomGroupsModal
        isOpen={cgrpDlg.isOpen}
        onClose={cgrpDlg.onClose}
        siteId={siteId}
        groups={groups}
        items={customGroups}
        onChanged={loadCustomGroups}
      />

      <Modal
        isOpen={filterDlg.isOpen}
        onClose={filterDlg.onClose}
        size="md"
      >
        <ModalContent>
          <ModalHeader>排除前缀（全局）</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-xs text-default-500">
              名字以下面任一前缀开头的账号将不显示在这里。每行一个；
              空行和以 # 开头的注释行会被忽略。大小写不敏感。
              <br />
              <span className="text-warning">
                ⚠ 服务器端保存，对所有访问者都生效。
              </span>
            </p>
            <Textarea
              label="前缀列表"
              placeholder={"# 注释\nxxx\nxxx1\ntest-"}
              minRows={6}
              value={prefixDraft}
              onValueChange={setPrefixDraft}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={filterDlg.onClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingPrefixes}
              onPress={async () => {
                const ok = await persistPrefixes(prefixDraft);
                if (ok) filterDlg.onClose();
              }}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={editDlg.isOpen}
        onClose={editDlg.onClose}
        size="md"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            编辑渠道{editAcc ? ` · ${editAcc.name}` : ""}
          </ModalHeader>
          <ModalBody>
            {editAcc && (
              <div className="flex flex-col gap-3">
                <ChannelCredsBlock
                  creds={editCreds}
                  loading={editCredsLoading}
                  reveal={editKeyRevealed}
                  setReveal={setEditKeyRevealed}
                />
                <div className="flex items-center justify-between">
                  <span className="text-sm">启用 (status)</span>
                  <Switch
                    size="sm"
                    isSelected={editActive}
                    onValueChange={setEditActive}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">参与调度</span>
                  <Switch
                    size="sm"
                    isSelected={editSchedulable}
                    onValueChange={setEditSchedulable}
                  />
                </div>
                <Input
                  type="number"
                  label="并发上限"
                  description={`实时使用：${concurrency.account?.[String(editAcc.id)]?.current_in_use ?? 0}`}
                  value={editConcurrency}
                  onValueChange={setEditConcurrency}
                  min={0}
                />
                <Input
                  type="number"
                  label="优先级"
                  description="数字越小越靠前；同优先级随机调度"
                  value={editPriority}
                  onValueChange={setEditPriority}
                  min={0}
                />
                <Select
                  size="sm"
                  label="分组"
                  description={`已选 ${editGroupIds.size} 个 · 候选 ${groups.length}`}
                  selectionMode="multiple"
                  isMultiline
                  selectedKeys={editGroupIds}
                  onSelectionChange={(k) =>
                    setEditGroupIds(
                      new Set(Array.from(k as Set<React.Key>).map(String)),
                    )
                  }
                  classNames={{ trigger: "min-h-12 py-2" }}
                  renderValue={(items) => (
                    <div className="flex flex-wrap gap-1">
                      {items.map((it) => (
                        <Chip key={it.key} size="sm" variant="flat">
                          {it.textValue}
                        </Chip>
                      ))}
                    </div>
                  )}
                >
                  {groups.map((g) => (
                    <SelectItem
                      key={String(g.id)}
                      textValue={`${g.name} (×${g.rate_multiplier})`}
                    >
                      {`${g.name} (×${g.rate_multiplier})`}
                    </SelectItem>
                  ))}
                </Select>
                <Textarea
                  label="备注"
                  placeholder="渠道说明 / 续费日期 / 联系人 等"
                  minRows={2}
                  value={editNotes}
                  onValueChange={setEditNotes}
                />
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-default-500">
                      可用模型
                      {editModelsLoading && (
                        <span className="ml-1 text-default-400">
                          · 加载中…
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-default-400">
                      {editModels.length === 0
                        ? "空 = 未限制（不传 model_mapping）"
                        : `${editModels.length} 个`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
                    {editModels.length === 0 ? (
                      <span className="text-xs text-default-400 italic">
                        {editModelsLoading ? "—" : "暂无（保存后该渠道允许全部模型）"}
                      </span>
                    ) : (
                      editModels.map((m) => (
                        <Chip
                          key={m}
                          size="sm"
                          variant="flat"
                          onClose={() =>
                            setEditModels(editModels.filter((x) => x !== m))
                          }
                        >
                          {m}
                        </Chip>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      size="sm"
                      placeholder="claude-opus-4-7"
                      value={editModelInput}
                      onValueChange={setEditModelInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = editModelInput.trim();
                          if (v && !editModels.includes(v)) {
                            setEditModels([...editModels, v]);
                          }
                          setEditModelInput("");
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        const v = editModelInput.trim();
                        if (v && !editModels.includes(v)) {
                          setEditModels([...editModels, v]);
                        }
                        setEditModelInput("");
                      }}
                      isDisabled={!editModelInput.trim()}
                    >
                      添加
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <Autocomplete
                    size="sm"
                    label="测试用模型"
                    className="flex-1"
                    defaultItems={(() => {
                      // Built-in suggestions + the channel's whitelisted
                      // models, deduped. Default selection lives in state.
                      const seen = new Set<string>();
                      const list: { key: string; label: string }[] = [];
                      for (const m of [
                        "claude-opus-4-6",
                        "claude-opus-4-7",
                        "claude-sonnet-4-6",
                        "claude-haiku-4-5",
                        ...editModels,
                      ]) {
                        if (!m || seen.has(m)) continue;
                        seen.add(m);
                        list.push({ key: m, label: m });
                      }
                      return list;
                    })()}
                    selectedKey={editTestModel}
                    inputValue={editTestModel}
                    onInputChange={setEditTestModel}
                    onSelectionChange={(k) => {
                      if (k != null) setEditTestModel(String(k));
                    }}
                    allowsCustomValue
                    description="默认 claude-opus-4-6；下拉里前 3 项是常用模型，再后面是该渠道的可用模型"
                  >
                    {(item) => (
                      <AutocompleteItem key={item.key}>
                        {item.label}
                      </AutocompleteItem>
                    )}
                  </Autocomplete>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<TestTube2 size={14} />}
                    onPress={() =>
                      testAccount(editAcc.id, editTestModel.trim() || undefined)
                    }
                    className="mb-0.5"
                  >
                    测试此渠道
                  </Button>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={editDlg.onClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={busyAcc === editAcc?.id}
              onPress={async () => {
                if (!editAcc || siteId == null) return;
                const c = Number(editConcurrency);
                const p = Number(editPriority);
                // schedulable lives on a dedicated sub2api endpoint — call
                // separately when it differs from current state.
                if ((editAcc.schedulable !== false) !== editSchedulable) {
                  await fetch(
                    `/api/scheduling/${siteId}/channels/${editAcc.id}/schedulable`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ schedulable: editSchedulable }),
                    },
                  );
                }
                await patchAccount(editAcc.id, {
                  status: editActive ? "active" : "inactive",
                  concurrency:
                    Number.isFinite(c) && c >= 0
                      ? Math.floor(c)
                      : (editAcc.concurrency ?? 0),
                  priority:
                    Number.isFinite(p) && p >= 0
                      ? Math.floor(p)
                      : (editAcc.priority ?? 0),
                  group_ids: Array.from(editGroupIds).map(Number),
                  notes: editNotes || null,
                });
                // Models are stored under credentials.model_mapping; the
                // dedicated route fetches the existing credentials, mutates
                // model_mapping, and PUTs the full credentials block.
                const modelsChanged =
                  editModels.length !== editModelsInitial.length ||
                  editModels.some((m, i) => m !== editModelsInitial[i]);
                if (modelsChanged) {
                  const r = await fetch(
                    `/api/scheduling/${siteId}/channels/${editAcc.id}/models`,
                    {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ models: editModels }),
                    },
                  );
                  if (!r.ok) {
                    const j = await r.json().catch(() => ({}));
                    addToast({
                      title: "模型保存失败",
                      description: j.error,
                      color: "danger",
                    });
                    return;
                  }
                }
                editDlg.onClose();
              }}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <NewChannelModal
        isOpen={newDlg.isOpen}
        onClose={newDlg.onClose}
        siteId={siteId}
        groups={groups}
        onCreated={async () => {
          newDlg.onClose();
          await loadStructure();
        }}
      />

      <TemplatesModal isOpen={tplDlg.isOpen} onClose={tplDlg.onClose} />
    </Shell>
  );
}

// ------------------------------------------------------------------
// Group-users view: per group → list of users that called it today.
// Useful for re-balancing accounts ("group X is dominated by user Y").
// ------------------------------------------------------------------
// ============================================================
// Error ranking view — calls /api/scheduling/[siteId]/error-ranking
// which pages through /admin/ops/request-errors (page_size=500) up to a
// hard cap and aggregates per account.
// ============================================================
interface ErrorRankRecentEvent {
  id: number;
  createdAt: string;
  statusCode: number;
  model: string;
  requestedModel: string;
  message: string;
  groupId: number | null;
  groupName: string;
  userId: number | null;
  userEmail: string;
  requestId: string;
  requestPath: string;
  isRetryable: boolean;
}

interface ErrorRankAccount {
  accountId: number;
  accountName: string;
  count: number;
  share: number;
  byStatus: Record<string, number>;
  byModel: Record<string, number>;
  groups: { groupId: number; groupName: string; count: number }[];
  latestAt: string;
  latestMessage: string;
  latestStatus: number;
  recentEvents: ErrorRankRecentEvent[];
}

interface ErrorRankSummary {
  errorRate: number;
  upstreamErrorRate: number;
  sla: number;
  requestCountTotal: number;
  successCount: number;
  errorCountTotal: number;
  businessLimitedCount: number;
  errorCountSla: number;
  upstreamErrorCount429: number;
  upstreamErrorCount529: number;
  upstreamErrorCountOther: number;
  healthScore: number | null;
  generatedAt: string;
}

interface ErrorRankPayload {
  range: string;
  totalErrors: number;
  processed: number;
  truncated: boolean;
  recentPerAccount: number;
  summary: ErrorRankSummary | null;
  accounts: ErrorRankAccount[];
}

const ERROR_RANGES: { key: string; label: string }[] = [
  { key: "1h", label: "近 1 小时" },
  { key: "6h", label: "近 6 小时" },
  { key: "24h", label: "近 24 小时" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
];

function ErrorRankingView({ siteId }: { siteId: number | null }) {
  const [range, setRange] = useState<string>("1h");
  const [data, setData] = useState<ErrorRankPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ErrorRankAccount | null>(null);

  const load = useCallback(async () => {
    if (siteId == null) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/scheduling/${siteId}/error-ranking?range=${range}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `${r.status}`);
        return;
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [siteId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  if (siteId == null) {
    return (
      <Card>
        <CardBody className="text-default-500 text-sm">先选站点</CardBody>
      </Card>
    );
  }

  const filtered = data
    ? data.accounts.filter((a) => {
        const lc = q.trim().toLowerCase();
        if (!lc) return true;
        return (
          a.accountName.toLowerCase().includes(lc) ||
          a.groups.some((g) =>
            (g.groupName ?? "").toLowerCase().includes(lc),
          )
        );
      })
    : [];

  const maxCount = data ? Math.max(1, ...data.accounts.map((a) => a.count)) : 1;

  return (
    <div className="flex flex-col gap-3">
      <Card className="bg-content1 border border-divider/50 shadow-none">
        <CardBody className="flex flex-row gap-2 items-center flex-wrap py-3">
          <span className="text-xs text-default-500">时间范围</span>
          {ERROR_RANGES.map((r) => (
            <Chip
              key={r.key}
              size="sm"
              variant={range === r.key ? "solid" : "flat"}
              color={range === r.key ? "primary" : "default"}
              className="cursor-pointer"
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Chip>
          ))}
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw size={14} />}
            onPress={load}
            isLoading={loading}
            className="ml-auto"
          >
            刷新
          </Button>
          <div className="w-full sm:w-64">
            <Input
              size="sm"
              placeholder="搜索账号/分组名…"
              value={q}
              onValueChange={setQ}
            />
          </div>
        </CardBody>
      </Card>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RateTile
            label="请求错误率"
            value={`${(data.summary.errorRate * 100).toFixed(2)}%`}
            sub={`${data.summary.errorCountTotal.toLocaleString()} / ${data.summary.requestCountTotal.toLocaleString()}`}
            severity={
              data.summary.errorRate >= 0.05
                ? "danger"
                : data.summary.errorRate >= 0.02
                  ? "warning"
                  : "ok"
            }
          />
          <RateTile
            label="上游错误率"
            value={`${(data.summary.upstreamErrorRate * 100).toFixed(2)}%`}
            sub={(() => {
              const o = data.summary.upstreamErrorCountOther;
              const r429 = data.summary.upstreamErrorCount429;
              const r529 = data.summary.upstreamErrorCount529;
              const parts: string[] = [];
              if (o > 0) parts.push(`其他 ${o.toLocaleString()}`);
              if (r429 > 0) parts.push(`429×${r429}`);
              if (r529 > 0) parts.push(`529×${r529}`);
              return parts.join(" / ") || "—";
            })()}
            severity={
              data.summary.upstreamErrorRate >= 0.1
                ? "danger"
                : data.summary.upstreamErrorRate >= 0.05
                  ? "warning"
                  : "ok"
            }
          />
          <RateTile
            label="SLA"
            value={`${(data.summary.sla * 100).toFixed(2)}%`}
            sub={`成功 ${data.summary.successCount.toLocaleString()}`}
            severity={
              data.summary.sla >= 0.99
                ? "ok"
                : data.summary.sla >= 0.95
                  ? "warning"
                  : "danger"
            }
          />
          <RateTile
            label="健康分"
            value={
              data.summary.healthScore != null
                ? String(data.summary.healthScore)
                : "—"
            }
            sub={`时间窗 ${data.range} · ${fmtTimeShort(data.summary.generatedAt)}`}
            severity={
              data.summary.healthScore == null
                ? "ok"
                : data.summary.healthScore >= 80
                  ? "ok"
                  : data.summary.healthScore >= 50
                    ? "warning"
                    : "danger"
            }
          />
        </div>
      )}

      {error && (
        <Card>
          <CardBody className="text-danger text-sm">{error}</CardBody>
        </Card>
      )}

      {data && (
        <Card className="bg-content1 border border-divider/50 shadow-none">
          <CardHeader className="flex justify-between items-center pb-2 flex-wrap gap-2">
            <div>
              <h2 className="font-semibold">账号错误排行</h2>
              <p className="text-xs text-default-500 mt-0.5">
                {data.range} · 共 {data.totalErrors.toLocaleString()} 条错误 · 涉及{" "}
                {data.accounts.length} 个账号 · 已处理{" "}
                {data.processed.toLocaleString()} 条
                {data.truncated && (
                  <span className="text-warning ml-1">
                    （达到 {data.processed.toLocaleString()} 上限，更早数据未统计）
                  </span>
                )}
              </p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {filtered.length === 0 ? (
              <p className="text-default-500 text-sm">
                {data.accounts.length === 0
                  ? "该时间窗内没有错误。"
                  : "当前筛选下没有匹配的账号。"}
              </p>
            ) : (
              <Table removeWrapper aria-label="error ranking">
                <TableHeader>
                  <TableColumn>排名</TableColumn>
                  <TableColumn>账号</TableColumn>
                  <TableColumn>分组</TableColumn>
                  <TableColumn className="text-right">错误数</TableColumn>
                  <TableColumn>占比</TableColumn>
                  <TableColumn>状态码</TableColumn>
                  <TableColumn>最近错误</TableColumn>
                </TableHeader>
                <TableBody>
                  {filtered.map((a, i) => {
                    const pct = (a.count / maxCount) * 100;
                    const groupLine = a.groups
                      .map((g) => `${g.groupName} (${g.count})`)
                      .join("、");
                    const statusBreakdown = Object.entries(a.byStatus)
                      .sort((x, y) => y[1] - x[1])
                      .map(([k, v]) => `${k}×${v}`)
                      .join(" / ");
                    return (
                      <TableRow
                        key={a.accountId}
                        className="cursor-pointer hover:bg-default-100"
                        onClick={() => setPicked(a)}
                      >
                        <TableCell className="font-mono text-xs text-default-500">
                          #{i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col leading-tight max-w-[260px]">
                            <span className="font-medium text-sm truncate">
                              {a.accountName}
                            </span>
                            <span className="text-[11px] text-default-400">
                              id={a.accountId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-xs text-default-500 break-all"
                            title={groupLine}
                          >
                            {a.groups[0]?.groupName ?? "—"}
                            {a.groups.length > 1 && (
                              <span className="text-default-400 ml-1">
                                +{a.groups.length - 1}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {a.count.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 h-2 rounded-full bg-content2 overflow-hidden">
                              <div
                                className="h-full bg-danger/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-default-500 tabular-nums w-10 text-right">
                              {(a.share * 100).toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-xs font-mono text-default-500"
                            title={statusBreakdown}
                          >
                            {statusBreakdown || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col leading-tight max-w-[260px]">
                            <span className="text-[11px] text-default-400">
                              {fmtTimeShort(a.latestAt)}
                            </span>
                            <span
                              className="text-xs text-danger truncate"
                              title={a.latestMessage}
                            >
                              {a.latestStatus} · {a.latestMessage || "—"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      <ErrorAccountModal
        account={picked}
        recentCap={data?.recentPerAccount ?? 0}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}

function ErrorAccountModal({
  account,
  recentCap,
  onClose,
}: {
  account: ErrorRankAccount | null;
  recentCap: number;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  useEffect(() => {
    if (!account) return;
    setQ("");
    setStatusF("all");
  }, [account]);

  const events = account?.recentEvents ?? [];
  const lc = q.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (statusF !== "all" && String(e.statusCode) !== statusF) return false;
    if (!lc) return true;
    return (
      (e.message ?? "").toLowerCase().includes(lc) ||
      (e.userEmail ?? "").toLowerCase().includes(lc) ||
      (e.model ?? "").toLowerCase().includes(lc) ||
      (e.requestId ?? "").toLowerCase().includes(lc)
    );
  });
  const statusCodes = account
    ? Object.keys(account.byStatus).sort(
        (a, b) => account.byStatus[b] - account.byStatus[a],
      )
    : [];

  return (
    <Modal
      isOpen={account != null}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {account && (
          <>
            <ModalHeader className="flex flex-col gap-1 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{account.accountName}</span>
                <Chip size="sm" variant="flat">
                  id={account.accountId}
                </Chip>
                <Chip size="sm" color="danger" variant="flat">
                  共 {account.count.toLocaleString()} 错
                </Chip>
                <Chip size="sm" variant="flat">
                  占比 {(account.share * 100).toFixed(2)}%
                </Chip>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-default-500">
                <span>
                  分组：
                  {account.groups.map((g) => `${g.groupName}(${g.count})`).join("、") || "—"}
                </span>
                <span>
                  状态码：
                  {Object.entries(account.byStatus)
                    .sort((x, y) => y[1] - x[1])
                    .map(([k, v]) => `${k}×${v}`)
                    .join(" / ") || "—"}
                </span>
                <span>
                  模型：
                  {Object.entries(account.byModel)
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 4)
                    .map(([k, v]) => `${k}×${v}`)
                    .join(" / ") || "—"}
                </span>
              </div>
            </ModalHeader>
            <ModalBody className="gap-3 pt-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip
                  size="sm"
                  variant={statusF === "all" ? "solid" : "flat"}
                  color={statusF === "all" ? "primary" : "default"}
                  className="cursor-pointer"
                  onClick={() => setStatusF("all")}
                >
                  全部
                </Chip>
                {statusCodes.map((sc) => (
                  <Chip
                    key={sc}
                    size="sm"
                    variant={statusF === sc ? "solid" : "flat"}
                    color={statusF === sc ? "primary" : "default"}
                    className="cursor-pointer"
                    onClick={() => setStatusF(sc)}
                  >
                    {sc} · {account.byStatus[sc]}
                  </Chip>
                ))}
                <div className="ml-auto w-full sm:w-72">
                  <Input
                    size="sm"
                    placeholder="搜索消息 / user / 模型 / request_id…"
                    value={q}
                    onValueChange={setQ}
                  />
                </div>
              </div>
              <p className="text-[11px] text-default-400">
                展示最近 {Math.min(events.length, recentCap)} 条原始错误
                {account.count > recentCap &&
                  `（该账号共 ${account.count.toLocaleString()} 条，更早的未保留）`}
                。
              </p>
              {filtered.length === 0 ? (
                <p className="text-default-500 text-sm py-4 text-center">
                  没有匹配的错误。
                </p>
              ) : (
                <Table removeWrapper aria-label="account errors">
                  <TableHeader>
                    <TableColumn>时间</TableColumn>
                    <TableColumn>状态</TableColumn>
                    <TableColumn>模型</TableColumn>
                    <TableColumn>用户</TableColumn>
                    <TableColumn>消息</TableColumn>
                    <TableColumn>request_id</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-default-500 whitespace-nowrap">
                          {fmtTimeShort(e.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="sm"
                            color={
                              e.statusCode >= 500
                                ? "danger"
                                : e.statusCode >= 400
                                  ? "warning"
                                  : "default"
                            }
                            variant="flat"
                          >
                            {e.statusCode || "?"}
                          </Chip>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col leading-tight">
                            <span>{e.model || "—"}</span>
                            {e.requestedModel && e.requestedModel !== e.model && (
                              <span className="text-[10px] text-default-400">
                                req: {e.requestedModel}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-default-500 max-w-[160px] truncate">
                          {e.userEmail || "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs text-danger max-w-[360px] truncate"
                          title={e.message}
                        >
                          {e.message || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-default-400 max-w-[140px] truncate">
                          {e.requestId || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                关闭
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// Compact rate chip shown on each scheduled-channel row. Reads upstream
// rate from the local Binding rows (which are already on the page state),
// so it's instant — no extra API call.
function BindingRateChip({ bind }: { bind: BindingInfo[] }) {
  if (bind.length === 0) {
    return (
      <span
        className="text-[10px] text-default-400 italic"
        title="该渠道未在「绑定」页配置上游 key"
      >
        未绑定
      </span>
    );
  }
  const sorted = [...bind].sort(
    (a, b) =>
      a.upstreamEffectiveRateMultiplier - b.upstreamEffectiveRateMultiplier,
  );
  const first = sorted[0];
  const tooltip = sorted
    .map(
      (b) =>
        `${b.upstreamGroupName} ×${b.upstreamEffectiveRateMultiplier}${b.upstreamHasExclusiveRate ? "（专属）" : ""} → ${b.upstreamKeyName}`,
    )
    .join("\n");
  // Color hint by rate vs face value (1×):
  //   < 1  green  — we buy cheaper than face, good margin
  //   = 1  default
  //   > 1  warning — we pay more than face, watch out
  const r = first.upstreamEffectiveRateMultiplier;
  const colorClass =
    r < 1
      ? "text-success"
      : r > 1
        ? "text-warning"
        : "text-default-500";
  return (
    <span
      className={`text-[10px] ${colorClass} font-medium`}
      title={tooltip}
    >
      上游 {first.upstreamGroupName} ×{r}
      {first.upstreamHasExclusiveRate ? " 专属" : ""}
      {sorted.length > 1 && (
        <span className="text-default-400 font-normal">
          {" "}
          +{sorted.length - 1}
        </span>
      )}
    </span>
  );
}

function TestResultChip({
  result,
}: {
  result?:
    | { kind: "pending" }
    | { kind: "ok"; latencyMs: number }
    | { kind: "fail"; latencyMs: number; output: string };
}) {
  if (!result) return null;
  if (result.kind === "pending") {
    return (
      <span className="text-[10px] text-primary inline-flex items-center gap-0.5">
        <Spinner size="sm" classNames={{ wrapper: "w-3 h-3" }} /> 测试中
      </span>
    );
  }
  const sec = (result.latencyMs / 1000).toFixed(2) + "s";
  if (result.kind === "ok") {
    // colour-code by latency: <5s 绿，<15s 默认，≥15s 橙
    const colorClass =
      result.latencyMs < 5000
        ? "text-success"
        : result.latencyMs < 15000
          ? "text-default-600"
          : "text-warning";
    return (
      <span className={`text-[10px] font-medium ${colorClass}`}>
        ✓ {sec}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] text-danger font-medium"
      title={result.output}
    >
      ✗ {sec}
    </span>
  );
}

function ChannelCredsBlock({
  creds,
  loading,
  reveal,
  setReveal,
}: {
  creds: { baseUrl: string; apiKey: string } | null;
  loading: boolean;
  reveal: boolean;
  setReveal: (v: boolean) => void;
}) {
  async function copy(text: string, label: string) {
    if (!text) return;
    const ok = await copyToClipboard(text);
    addToast({
      title: ok ? `${label} 已复制` : `${label} 复制失败`,
      color: ok ? "success" : "danger",
    });
  }
  const masked = creds?.apiKey
    ? creds.apiKey.length > 8
      ? `${creds.apiKey.slice(0, 4)}…${creds.apiKey.slice(-4)}`
      : "*".repeat(creds.apiKey.length)
    : "";
  return (
    <div className="rounded-lg border border-divider/50 p-2.5 bg-content2/30 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Link2 size={12} className="text-default-400 shrink-0" />
        <span className="text-[11px] text-default-500 shrink-0 w-10">URL</span>
        <code
          className="font-mono text-xs flex-1 truncate"
          title={creds?.baseUrl ?? ""}
        >
          {loading ? "加载中…" : creds?.baseUrl || "—"}
        </code>
        <Button
          size="sm"
          isIconOnly
          variant="flat"
          className="h-6 min-w-6"
          isDisabled={!creds?.baseUrl}
          onPress={() => creds && copy(creds.baseUrl, "URL")}
          title="复制 URL"
        >
          <Copy size={12} />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <KeyRound size={12} className="text-default-400 shrink-0" />
        <span className="text-[11px] text-default-500 shrink-0 w-10">Key</span>
        <code className="font-mono text-xs flex-1 truncate">
          {loading
            ? "加载中…"
            : !creds?.apiKey
              ? "—"
              : reveal
                ? creds.apiKey
                : masked}
        </code>
        <Button
          size="sm"
          isIconOnly
          variant="light"
          className="h-6 min-w-6"
          isDisabled={!creds?.apiKey}
          onPress={() => setReveal(!reveal)}
          title={reveal ? "隐藏" : "显示完整 key"}
        >
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
        </Button>
        <Button
          size="sm"
          isIconOnly
          variant="flat"
          className="h-6 min-w-6"
          isDisabled={!creds?.apiKey}
          onPress={() => creds && copy(creds.apiKey, "API Key")}
          title="复制完整 key"
        >
          <Copy size={12} />
        </Button>
      </div>
    </div>
  );
}

function fmtTimeShort(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return ts;
  }
}

function RateTile({
  label,
  value,
  sub,
  severity,
}: {
  label: string;
  value: string;
  sub: string;
  severity: "ok" | "warning" | "danger";
}) {
  const colorClass =
    severity === "danger"
      ? "text-danger"
      : severity === "warning"
        ? "text-warning"
        : "text-foreground";
  const borderClass =
    severity === "danger"
      ? "border-danger/40"
      : severity === "warning"
        ? "border-warning/40"
        : "border-divider/50";
  return (
    <Card className={`bg-content1 border ${borderClass} shadow-none`}>
      <CardBody className="py-3">
        <div className="text-xs text-default-500">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${colorClass}`}>
          {value}
        </div>
        <div className="text-[11px] text-default-400 mt-0.5 truncate" title={sub}>
          {sub}
        </div>
      </CardBody>
    </Card>
  );
}

function GroupUsersView({
  rows,
  excludeList,
}: {
  rows: GroupUsersRow[];
  excludeList: string[];
}) {
  // Apply the same name-prefix excludeList to filter out groups whose name
  // starts with one of these. Sort by today's total cost desc.
  const visible = useMemo(() => {
    const filtered = rows.filter(
      (g) =>
        !excludeList.some((p) =>
          (g.group_name ?? "").toLowerCase().startsWith(p.toLowerCase()),
        ),
    );
    return filtered
      .map((g) => ({
        ...g,
        totalCost: g.users.reduce((s, u) => s + (u.actual_cost ?? 0), 0),
        totalRequests: g.users.reduce((s, u) => s + (u.requests ?? 0), 0),
      }))
      .filter((g) => g.users.length > 0)
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [rows, excludeList]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="text-default-500 text-sm">
          加载中…（首次加载会扫描所有分组的用户消费）
        </CardBody>
      </Card>
    );
  }
  if (visible.length === 0) {
    return (
      <Card>
        <CardBody className="text-default-500 text-sm">
          没有今天有消费的分组。
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {visible.map((g) => {
        const sorted = [...g.users].sort(
          (a, b) => (b.actual_cost ?? 0) - (a.actual_cost ?? 0),
        );
        const top = sorted[0]?.actual_cost ?? 0;
        return (
          <Card
            key={g.group_id}
            className="bg-content1 border border-divider/50 shadow-none"
          >
            <CardHeader className="flex justify-between items-start gap-2 pb-2">
              <div className="flex flex-col leading-tight min-w-0">
                <h3 className="font-semibold truncate">{g.group_name}</h3>
                <span className="text-xs text-default-400">
                  {g.users.length} 个用户 · {g.totalRequests.toLocaleString()} req
                </span>
              </div>
              <span className="text-sm font-bold text-foreground">
                ${fmtMoneyShort(g.totalCost)}
              </span>
            </CardHeader>
            <CardBody className="pt-0 gap-1">
              {sorted.map((u) => {
                const pct =
                  top > 0 ? Math.min(100, Math.round((u.actual_cost / top) * 100)) : 0;
                return (
                  <div
                    key={u.user_id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-content2/40 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {u.email ?? `user#${u.user_id}`}
                      </div>
                      <div className="h-1 rounded-full bg-content2 overflow-hidden mt-1">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-default-500 text-[11px] shrink-0">
                      {u.requests.toLocaleString()} req
                    </span>
                    <span className="font-mono text-foreground shrink-0 w-16 text-right">
                      ${fmtMoneyShort(u.actual_cost)}
                    </span>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function GroupCard({
  group,
  accounts,
  unscheduled,
  inFlight,
  capacity,
  todayCost,
  concurrency,
  bindings,
  accountStats,
  onEditAccount,
  onSmartDispatch,
  onChanged,
  siteId,
}: {
  group: GroupRow;
  accounts: AccountRow[];
  unscheduled: AccountRow[];
  inFlight: number;
  capacity: number;
  todayCost: number;
  concurrency: ConcurrencyState;
  bindings: Record<string, BindingInfo[]>;
  accountStats: Record<
    string,
    { requests: number; cost: number; user_cost: number }
  >;
  onEditAccount: (a: AccountRow) => void;
  onSmartDispatch: (groupIds: number[], label: string) => void;
  onChanged: () => Promise<void> | void;
  siteId: number | null;
}) {
  const [mode, setMode] = useState<"scheduled" | "unscheduled">("scheduled");
  const [search, setSearch] = useState("");
  const [groupTesting, setGroupTesting] = useState(false);
  const [groupTestResults, setGroupTestResults] = useState<
    Record<
      number,
      | { kind: "pending" }
      | { kind: "ok"; latencyMs: number }
      | { kind: "fail"; latencyMs: number; output: string }
    >
  >({});
  // SLOW_MS仍用于"快/慢"分类显示（chip 颜色）。批量调整并发已下线，改为
  // 用户手动看测试结果再决定。
  const SLOW_MS = 10_000;
  // 自动测试：每 X 分钟触发一次"一键测试"。每个单测固定 30s 超时。
  // 旧版用秒（key=scheduling.autoTest），切换到分钟后改用新 key 避免错读。
  const AUTO_TEST_MIN_MINUTES = 1;
  const AUTO_TEST_KEY = `scheduling.autoTestV2.${siteId ?? "x"}.${group.id}`;
  const DEFAULT_TEST_MODEL = "claude-opus-4-6";
  const MODEL_PRESETS = [
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ];
  const [autoTestEnabled, setAutoTestEnabled] = useState(false);
  const [autoTestIntervalMin, setAutoTestIntervalMin] = useState(5);
  const [autoTestModel, setAutoTestModel] = useState<string>(
    DEFAULT_TEST_MODEL,
  );
  const [autoTestModalOpen, setAutoTestModalOpen] = useState(false);
  // Modal 草稿值，保存后才落到 state + localStorage
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftIntervalMin, setDraftIntervalMin] = useState(5);
  const [draftModel, setDraftModel] = useState<string>(DEFAULT_TEST_MODEL);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTO_TEST_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as {
        enabled?: boolean;
        intervalMin?: number;
        model?: string;
      };
      if (typeof v.enabled === "boolean") setAutoTestEnabled(v.enabled);
      if (
        typeof v.intervalMin === "number" &&
        v.intervalMin >= AUTO_TEST_MIN_MINUTES
      )
        setAutoTestIntervalMin(v.intervalMin);
      if (typeof v.model === "string" && v.model.trim()) {
        setAutoTestModel(v.model.trim());
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUTO_TEST_KEY]);
  function persistAutoTest(
    enabled: boolean,
    intervalMin: number,
    model: string,
  ) {
    try {
      localStorage.setItem(
        AUTO_TEST_KEY,
        JSON.stringify({ enabled, intervalMin, model }),
      );
    } catch {
      // ignore
    }
  }

  const baseList = mode === "scheduled" ? accounts : unscheduled;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? baseList.filter((a) => (a.name ?? "").toLowerCase().includes(q))
    : baseList;
  const pct =
    capacity > 0 ? Math.min(100, Math.round((inFlight / capacity) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary";
  // Sort by today's user_cost desc (matches the "$X" cell shown on each row).
  // Fall back to in-flight when stats unavailable so live activity still wins.
  const sortedAccounts = [...filtered].sort((a, b) => {
    const ac = accountStats[String(a.id)]?.user_cost ?? 0;
    const bc = accountStats[String(b.id)]?.user_cost ?? 0;
    if (bc !== ac) return bc - ac;
    const ai = concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
    const bi = concurrency.account?.[String(b.id)]?.current_in_use ?? 0;
    return bi - ai;
  });

  async function testGroup() {
    if (groupTesting || siteId == null) return;
    setGroupTesting(true);
    // Mark every visible account "pending" so the row shows a spinner badge
    // even before its individual fetch starts.
    setGroupTestResults(() => {
      const next: typeof groupTestResults = {};
      for (const a of sortedAccounts) next[a.id] = { kind: "pending" };
      return next;
    });
    const queue = [...sortedAccounts];
    const m = autoTestModel.trim();
    // 本地汇总，用于在 Promise.all 后做"全失败"判定;比读取异步 state 可靠。
    const localResults = new Map<
      number,
      { kind: "ok" } | { kind: "fail"; output: string }
    >();
    async function worker() {
      while (queue.length > 0) {
        const a = queue.shift();
        if (!a) break;
        const t0 = Date.now();
        try {
          const r = await fetch(
            `/api/scheduling/${siteId}/channels/${a.id}/test`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(m ? { model_id: m } : {}),
              // 单测 30 秒硬上限——避免一个挂死的渠道阻塞整轮测试。
              signal: AbortSignal.timeout(30_000),
            },
          );
          const j = await r.json();
          const latencyMs = Date.now() - t0;
          if (j.ok) {
            localResults.set(a.id, { kind: "ok" });
            setGroupTestResults((prev) => ({
              ...prev,
              [a.id]: { kind: "ok", latencyMs },
            }));
          } else {
            const output = String(j.output || "").slice(0, 600);
            localResults.set(a.id, { kind: "fail", output });
            setGroupTestResults((prev) => ({
              ...prev,
              [a.id]: { kind: "fail", latencyMs, output },
            }));
          }
        } catch (e) {
          const latencyMs = Date.now() - t0;
          const isTimeout =
            (e instanceof DOMException && e.name === "TimeoutError") ||
            (e instanceof Error && /timeout/i.test(e.message));
          const output = isTimeout
            ? `超时（>30s）`
            : e instanceof Error
              ? e.message
              : String(e);
          localResults.set(a.id, { kind: "fail", output });
          setGroupTestResults((prev) => ({
            ...prev,
            [a.id]: { kind: "fail", latencyMs, output },
          }));
        }
      }
    }
    // Concurrency 5 — same as smart-dispatch one-click. Higher upsets some
    // sub2api builds with 502/429.
    await Promise.all(
      Array.from({ length: Math.min(5, sortedAccounts.length) }, () => worker()),
    );
    setGroupTesting(false);

    // 全部账号失败 → 触发邮件告警(服务端按 siteId:groupId 做冷却,避免重复)。
    if (sortedAccounts.length > 0) {
      const fails = sortedAccounts
        .map((a) => {
          const r = localResults.get(a.id);
          return r && r.kind === "fail"
            ? { name: a.name, error: r.output }
            : null;
        })
        .filter((x): x is { name: string; error: string } => x != null);
      if (fails.length === sortedAccounts.length) {
        try {
          await fetch("/api/scheduling/group-alert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteId,
              groupId: group.id,
              groupName: group.name,
              totalAccounts: sortedAccounts.length,
              failingAccounts: fails,
            }),
          });
        } catch {
          // 邮件失败不影响 UI；服务端日志可查。
        }
      }
    }
  }

  // 自动测试：每 intervalSec 秒触发一次 testGroup。in-flight 守卫=groupTesting，
  // 标签页切走时停。testGroup 用 ref 取最新闭包，避免 interval 锁定旧 sortedAccounts。
  const testGroupRef = useRef<() => Promise<void>>(testGroup);
  useEffect(() => {
    testGroupRef.current = testGroup;
  });
  useEffect(() => {
    if (!autoTestEnabled || sortedAccounts.length === 0) return;
    const interval =
      Math.max(AUTO_TEST_MIN_MINUTES, autoTestIntervalMin) * 60 * 1000;
    let canceled = false;
    const tick = () => {
      if (canceled) return;
      if (document.hidden) return;
      if (groupTesting) return; // 上一轮没结束，跳过本次
      testGroupRef.current().catch(() => {
        // testGroup itself never throws (errors collected per-task)
      });
    };
    // 开启时立即跑一次
    tick();
    const t = setInterval(tick, interval);
    return () => {
      canceled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTestEnabled, autoTestIntervalMin, sortedAccounts.length]);

  const testStats = (() => {
    let ok = 0;
    let fail = 0;
    let totalLatency = 0;
    let okCount = 0;
    for (const r of Object.values(groupTestResults)) {
      if (r.kind === "ok") {
        ok++;
        totalLatency += r.latencyMs;
        okCount++;
      } else if (r.kind === "fail") {
        fail++;
      }
    }
    return {
      ok,
      fail,
      avgMs: okCount > 0 ? Math.round(totalLatency / okCount) : null,
    };
  })();

  return (
    <Card className="bg-content1 border border-divider/50 shadow-none">
      <CardHeader className="flex flex-col items-stretch gap-2 pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{group.name}</h3>
            <Chip size="sm" variant="flat">
              ×{group.rate_multiplier}
            </Chip>
            <Chip
              size="sm"
              variant="flat"
              color={group.status === "active" ? "default" : "warning"}
            >
              {group.status}
            </Chip>
          </div>
          <span className="text-xs text-default-500 flex items-center gap-2">
            {todayCost > 0 && (
              <span className="text-foreground font-medium">
                ${fmtMoneyShort(todayCost)}
              </span>
            )}
            {accounts.length} 渠道
            {unscheduled.length > 0 && (
              <Chip
                size="sm"
                variant={mode === "unscheduled" ? "solid" : "flat"}
                color={mode === "unscheduled" ? "warning" : "default"}
                className="cursor-pointer"
                onClick={() =>
                  setMode((m) =>
                    m === "scheduled" ? "unscheduled" : "scheduled",
                  )
                }
                classNames={{
                  base: "h-5",
                  content: "text-[11px] px-1.5",
                }}
              >
                {mode === "unscheduled"
                  ? `回到调度中`
                  : `未调度 ${unscheduled.length}`}
              </Chip>
            )}
            <Button
              size="sm"
              variant="light"
              isIconOnly
              className="min-w-0 w-7 h-7"
              title={
                autoTestEnabled
                  ? `自动测试已开启 · 每 ${autoTestIntervalMin} 分钟`
                  : "可用性自动检测设置"
              }
              onPress={() => {
                setDraftEnabled(autoTestEnabled);
                setDraftIntervalMin(autoTestIntervalMin);
                setDraftModel(autoTestModel);
                setAutoTestModalOpen(true);
              }}
            >
              <SettingsIcon
                size={14}
                className={autoTestEnabled ? "text-success" : ""}
              />
            </Button>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-content2 overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-default-600">
            {inFlight} / {capacity || "∞"}
          </span>
        </div>
        <Input
          size="sm"
          placeholder="搜索账号名…"
          value={search}
          onValueChange={setSearch}
          classNames={{ inputWrapper: "h-7 min-h-7" }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<TestTube2 size={14} />}
            onPress={testGroup}
            isLoading={groupTesting}
            isDisabled={sortedAccounts.length === 0}
          >
            一键测试（{sortedAccounts.length}）
          </Button>
          <span
            className="text-[11px] text-default-500 self-center font-mono"
            title="可在右上角齿轮里修改"
          >
            模型: {autoTestModel}
          </span>
          {autoTestEnabled && (
            <span className="text-[11px] text-success self-center">
              自动测试 · 每 {autoTestIntervalMin} 分钟
            </span>
          )}
          {(testStats.ok > 0 || testStats.fail > 0) && (
            <span className="text-[11px] text-default-500 self-center">
              {testStats.ok} 通过
              {testStats.fail > 0 && (
                <span className="text-danger"> · {testStats.fail} 失败</span>
              )}
              {testStats.avgMs != null && (
                <span className="ml-1">
                  · 平均 {(testStats.avgMs / 1000).toFixed(2)}s
                </span>
              )}
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="pt-0 gap-1">
        {sortedAccounts.map((a) => {
          const inflight = concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
          const lim = a.concurrency ?? 0;
          const full = lim > 0 && inflight >= lim;
          const off = a.status !== "active";
          const bind = bindings[String(a.id)] ?? [];
          const errored = isErrored(a);
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-content2/40 text-xs"
              title={errored && a.error_message ? a.error_message : undefined}
            >
              <span className="shrink-0 w-3 text-center">
                {errored ? (
                  <span className="text-danger">⚠</span>
                ) : a.status === "active" ? (
                  <span className="text-success">✓</span>
                ) : (
                  <span className="text-default-400">·</span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{a.name}</span>
                  <span className="text-[10px] text-default-400 font-normal shrink-0">
                    P{a.priority ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-1 leading-tight flex-wrap">
                  {a.schedulable === false && (
                    <span className="text-[10px] text-warning">未调度</span>
                  )}
                  <BindingRateChip bind={bind} />
                  <TestResultChip result={groupTestResults[a.id]} />
                  {bind.length > 0 && bind[0].maxConcurrency != null && (
                    <span className="text-[10px] text-primary">
                      绑 max {bind[0].maxConcurrency}
                    </span>
                  )}
                  {a.notes && (
                    <span
                      className="text-[10px] text-default-500 truncate"
                      title={a.notes}
                    >
                      📝 {a.notes}
                    </span>
                  )}
                  {errored && a.error_message && (
                    <span className="text-[10px] text-danger truncate">
                      {a.error_message}
                    </span>
                  )}
                </div>
              </div>
              {(() => {
                const s = accountStats[String(a.id)];
                const userCost = s?.user_cost ?? 0;
                if (userCost <= 0) return null;
                return (
                  <span
                    className="font-mono shrink-0 text-default-500"
                    title={`今日 cost ${s?.cost ?? 0} · user_cost ${userCost} · req ${s?.requests ?? 0}`}
                  >
                    ${fmtMoneyShort(userCost)}
                  </span>
                );
              })()}
              <span
                className={`font-mono shrink-0 ${
                  off
                    ? "text-default-400"
                    : full
                      ? "text-danger font-semibold"
                      : "text-foreground"
                }`}
              >
                {inflight}/{lim || "∞"}
              </span>
              <Button
                size="sm"
                variant="light"
                className="shrink-0 min-w-0 h-7 px-2"
                onPress={() => onEditAccount(a)}
              >
                编辑
              </Button>
            </div>
          );
        })}
        {siteId != null && (
          <button
            type="button"
            onClick={() => onSmartDispatch([group.id], group.name)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline self-start"
          >
            <Sparkles size={12} />
            智能调度
          </button>
        )}
      </CardBody>
      <Modal
        isOpen={autoTestModalOpen}
        onOpenChange={setAutoTestModalOpen}
        size="sm"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div className="flex flex-col">
                  <span>分组可用性自动检测</span>
                  <span className="text-xs text-default-500 font-normal">
                    分组「{group.name}」
                  </span>
                </div>
              </ModalHeader>
              <ModalBody className="gap-4">
                <Switch
                  isSelected={draftEnabled}
                  onValueChange={setDraftEnabled}
                >
                  启用自动检测
                </Switch>
                <Input
                  type="number"
                  label="检测间隔（分钟）"
                  description="每隔 N 分钟对本分组所有账号发起一次测试，单测 30 秒超时。最小 1 分钟。"
                  min={AUTO_TEST_MIN_MINUTES}
                  value={String(draftIntervalMin)}
                  onValueChange={(v) => {
                    const n = Math.max(
                      AUTO_TEST_MIN_MINUTES,
                      Math.floor(Number(v) || AUTO_TEST_MIN_MINUTES),
                    );
                    setDraftIntervalMin(n);
                  }}
                />
                <Autocomplete
                  size="sm"
                  label="测试模型"
                  description="自动检测 + 手动「一键测试」都会用这个模型。可输入自定义 model id。"
                  defaultItems={MODEL_PRESETS.map((m) => ({ key: m, label: m }))}
                  selectedKey={
                    MODEL_PRESETS.includes(draftModel) ? draftModel : null
                  }
                  inputValue={draftModel}
                  onInputChange={setDraftModel}
                  onSelectionChange={(k) => {
                    if (k != null) setDraftModel(String(k));
                  }}
                  allowsCustomValue
                >
                  {(item) => (
                    <AutocompleteItem key={item.key}>
                      {item.label}
                    </AutocompleteItem>
                  )}
                </Autocomplete>
                <p className="text-xs text-default-500 leading-relaxed">
                  当本分组所有账号在一次检测中全部失败时，将按「设置」页配置的
                  发件邮箱与收件人发送邮件提醒；同一分组在冷却窗口（设置页
                  「冷却分钟数」）内不会重复发送。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={close}>
                  取消
                </Button>
                <Button
                  color="primary"
                  onPress={() => {
                    const m =
                      draftModel.trim() || DEFAULT_TEST_MODEL;
                    setAutoTestEnabled(draftEnabled);
                    setAutoTestIntervalMin(draftIntervalMin);
                    setAutoTestModel(m);
                    persistAutoTest(draftEnabled, draftIntervalMin, m);
                    close();
                  }}
                >
                  保存
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------
// Custom group: aggregated card + management modal
// ------------------------------------------------------------------
function CustomGroupCard({
  customGroup,
  siteId,
  groups,
  accounts,
  concurrency,
  accountStats,
  onSmartDispatch,
}: {
  customGroup: CustomGroupRow;
  siteId: number | null;
  groups: GroupRow[];
  accounts: AccountRow[];
  concurrency: ConcurrencyState;
  accountStats: Record<
    string,
    { requests: number; cost: number; user_cost: number }
  >;
  onSmartDispatch: (groupIds: number[], label: string) => void;
}) {
  const memberSet = new Set(customGroup.groupIds);
  const memberGroups = groups.filter((g) => memberSet.has(g.id));
  // Union of accounts that belong to ANY member group, deduped by id.
  const seen = new Set<number>();
  const memberAccounts: AccountRow[] = [];
  for (const a of accounts) {
    const inAny = (a.group_ids ?? []).some((id) => memberSet.has(id));
    if (!inAny) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    memberAccounts.push(a);
  }
  // Stats roll-up.
  let inFlight = 0;
  let capacity = 0;
  let todayCost = 0;
  let activeCount = 0;
  let errCount = 0;
  for (const a of memberAccounts) {
    const conc = concurrency.account?.[String(a.id)];
    if (conc) {
      inFlight += conc.current_in_use ?? 0;
      capacity += conc.max_capacity ?? 0;
    } else {
      capacity += a.concurrency ?? 0;
    }
    todayCost += accountStats[String(a.id)]?.user_cost ?? 0;
    if (a.status === "active" && a.schedulable !== false) activeCount++;
    if (
      a.status === "error" ||
      (typeof a.error_message === "string" && a.error_message.trim().length > 0)
    )
      errCount++;
  }
  const pct =
    capacity > 0 ? Math.min(100, Math.round((inFlight / capacity) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary";

  return (
    <Card className="bg-content1 border border-primary/30 shadow-none">
      <CardHeader className="flex flex-col items-stretch gap-2 pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers size={14} className="text-primary" />
            <h3 className="font-semibold">{customGroup.name}</h3>
            <Chip size="sm" variant="flat" color="primary">
              {memberGroups.length} 个分组
            </Chip>
          </div>
          <span className="text-xs text-default-500 flex items-center gap-2">
            {todayCost > 0 && (
              <span className="text-foreground font-medium">
                ${fmtMoneyShort(todayCost)}
              </span>
            )}
            {memberAccounts.length} 渠道
            {errCount > 0 && (
              <Chip size="sm" color="danger" variant="flat">
                {errCount} 异常
              </Chip>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {memberGroups.map((g) => (
            <Chip
              key={g.id}
              size="sm"
              variant="flat"
              classNames={{ base: "h-5", content: "text-[11px] px-1.5" }}
            >
              {g.name} ×{g.rate_multiplier}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-content2 overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-default-600">
            {inFlight} / {capacity || "∞"}
          </span>
        </div>
      </CardHeader>
      <CardBody className="pt-0 gap-1">
        <div className="text-xs text-default-500">
          已启用 {activeCount} / {memberAccounts.length}（合并去重，跨分组同账号只算一次）
        </div>
        {siteId != null && (
          <button
            type="button"
            onClick={() =>
              onSmartDispatch(customGroup.groupIds, customGroup.name)
            }
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline self-start"
          >
            <Sparkles size={12} />
            智能调度
          </button>
        )}
      </CardBody>
    </Card>
  );
}

function SmartDispatchModal({
  isOpen,
  onClose,
  siteId,
  scope,
  excludeList,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  siteId: number | null;
  scope: { groupIds: number[]; label: string } | null;
  excludeList: string[];
  onChanged: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span>智能调度</span>
          {scope && (
            <Chip size="sm" variant="flat" color="primary">
              {scope.label}
            </Chip>
          )}
          {scope && scope.groupIds.length > 1 && (
            <Chip size="sm" variant="flat">
              {scope.groupIds.length} 个分组
            </Chip>
          )}
          {excludeList.length > 0 && (
            <Chip size="sm" variant="flat" color="default">
              已套用 {excludeList.length} 条排除前缀
            </Chip>
          )}
        </ModalHeader>
        <ModalBody className="pt-0">
          {scope && siteId != null ? (
            <SmartDispatchPanel
              siteId={siteId}
              groupIds={scope.groupIds}
              excludeList={excludeList}
              onChanged={onChanged}
            />
          ) : (
            <p className="text-default-500 text-sm py-4">未选择分组</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function CustomGroupsModal({
  isOpen,
  onClose,
  siteId,
  groups,
  items,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  siteId: number | null;
  groups: GroupRow[];
  items: CustomGroupRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CustomGroupRow | null>(null);
  const [name, setName] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function startNew() {
    setEditing(null);
    setName("");
    setPickedIds(new Set());
  }

  function startEdit(cg: CustomGroupRow) {
    setEditing(cg);
    setName(cg.name);
    setPickedIds(new Set(cg.groupIds.map(String)));
  }

  async function submit() {
    if (siteId == null) return;
    const ids = [...pickedIds].map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (!name.trim() || ids.length === 0) {
      addToast({ title: "请填写名称并至少选 1 个分组", color: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const r = await fetch(`/api/scheduling/custom-groups/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), groupIds: ids }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          addToast({ title: "保存失败", description: j.error, color: "danger" });
          return;
        }
        addToast({ title: "已保存", color: "success" });
      } else {
        const r = await fetch(`/api/scheduling/custom-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteAccountId: siteId,
            name: name.trim(),
            groupIds: ids,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          addToast({ title: "创建失败", description: j.error, color: "danger" });
          return;
        }
        addToast({ title: "已创建", color: "success" });
      }
      startNew();
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(cg: CustomGroupRow) {
    if (!confirm(`删除自定义分组「${cg.name}」？（不影响原始分组）`)) return;
    const r = await fetch(`/api/scheduling/custom-groups/${cg.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      addToast({ title: "删除失败", color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
    if (editing?.id === cg.id) startNew();
    await onChanged();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Layers size={16} /> 自定义分组
        </ModalHeader>
        <ModalBody className="gap-4">
          {/* Existing list */}
          <div>
            <div className="text-xs text-default-500 mb-2">
              已有自定义分组（{items.length}）
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-default-400 italic">
                还没有自定义分组。下方填写名称 + 选原始分组创建。
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((cg) => {
                  const memberNames = groups
                    .filter((g) => cg.groupIds.includes(g.id))
                    .map((g) => g.name)
                    .join("、");
                  return (
                    <div
                      key={cg.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-content2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{cg.name}</div>
                        <div className="text-[11px] text-default-400 truncate">
                          {memberNames || "(无成员)"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="light"
                        onPress={() => startEdit(cg)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="light"
                        color="danger"
                        onPress={() => remove(cg)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form */}
          <div className="border-t border-divider/40 pt-3">
            <div className="text-xs text-default-500 mb-2">
              {editing ? `编辑「${editing.name}」` : "新建自定义分组"}
            </div>
            <div className="flex flex-col gap-3">
              <Input
                label="名称"
                size="sm"
                value={name}
                onValueChange={setName}
              />
              <Select
                label="包含的原始分组（多选）"
                size="sm"
                selectionMode="multiple"
                selectedKeys={pickedIds}
                onSelectionChange={(k) =>
                  setPickedIds(new Set(Array.from(k as Set<React.Key>).map(String)))
                }
              >
                {groups.map((g) => (
                  <SelectItem key={String(g.id)}>
                    {`${g.name} (×${g.rate_multiplier})`}
                  </SelectItem>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  color="primary"
                  onPress={submit}
                  isLoading={submitting}
                  startContent={editing ? <Pencil size={14} /> : <Plus size={14} />}
                >
                  {editing ? "保存修改" : "创建"}
                </Button>
                {editing && (
                  <Button size="sm" variant="flat" onPress={startNew}>
                    取消编辑
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ------------------------------------------------------------------
// New channel modal
// ------------------------------------------------------------------
function NewChannelModal({
  isOpen,
  onClose,
  siteId,
  groups,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  siteId: number | null;
  groups: GroupRow[];
  onCreated: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [tplId, setTplId] = useState<string>("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrencyV] = useState("20");
  const [priority, setPriority] = useState("1");
  const [rateMul, setRateMul] = useState("1");
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/scheduling/templates")
      .then((r) => r.json())
      .then((j) => setTemplates(j.items || []));
  }, [isOpen]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => String(x.id) === id);
    setTplId(id);
    if (!t) return;
    try {
      setGroupSel(
        new Set(((JSON.parse(t.groupIds) as number[]) || []).map(String)),
      );
    } catch {
      setGroupSel(new Set());
    }
    try {
      setModels((JSON.parse(t.modelList) as string[]) || []);
    } catch {
      setModels([]);
    }
    setRateMul(String(t.rateMultiplier));
  }

  async function submit() {
    if (siteId == null) return;
    if (!name || !baseUrl || !apiKey) {
      addToast({ title: "名称 / Base URL / Key 必填", color: "warning" });
      return;
    }
    const tpl = templates.find((x) => String(x.id) === tplId);
    const body = {
      name,
      platform: tpl?.platform ?? "anthropic",
      type: tpl?.type ?? "apikey",
      credentials: {
        base_url: baseUrl,
        api_key: apiKey,
        ...(models.length
          ? {
              model_mapping: Object.fromEntries(models.map((m) => [m, m])),
            }
          : {}),
      },
      concurrency: Math.max(0, Number(concurrency) || 0),
      priority: Math.max(0, Number(priority) || 0),
      rate_multiplier: Number(rateMul) || 1,
      group_ids: Array.from(groupSel).map(Number),
      confirm_mixed_channel_risk: tpl?.confirmMixedChannelRisk ?? true,
    };
    setSubmitting(true);
    try {
      const r = await fetch(`/api/scheduling/${siteId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        addToast({ title: "创建失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已创建", color: "success" });
      // reset & close
      setName("");
      setBaseUrl("");
      setApiKey("");
      onClose();
      await onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>新增渠道</ModalHeader>
        <ModalBody className="gap-3">
          <Select
            size="sm"
            label="模板（可选）"
            placeholder="不使用模板"
            selectedKeys={tplId ? new Set([tplId]) : new Set()}
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0] ?? "";
              if (v) applyTemplate(v);
              else setTplId("");
            }}
          >
            {templates.map((t) => (
              <SelectItem
                key={String(t.id)}
              >{`${t.name} · ${t.platform}/${t.type}`}</SelectItem>
            ))}
          </Select>
          <Input
            label="名称"
            value={name}
            onValueChange={setName}
            isRequired
          />
          <Input
            label="Base URL"
            value={baseUrl}
            onValueChange={setBaseUrl}
            isRequired
          />
          <Input
            label="API Key"
            type="password"
            value={apiKey}
            onValueChange={setApiKey}
            isRequired
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              size="sm"
              type="number"
              label="并发"
              value={concurrency}
              onValueChange={setConcurrencyV}
            />
            <Input
              size="sm"
              type="number"
              label="优先级"
              value={priority}
              onValueChange={setPriority}
            />
            <Input
              size="sm"
              type="number"
              label="rate × 倍率"
              value={rateMul}
              onValueChange={setRateMul}
            />
          </div>
          <Select
            size="sm"
            label="分组"
            selectionMode="multiple"
            selectedKeys={groupSel}
            onSelectionChange={(k) =>
              setGroupSel(
                new Set(Array.from(k as Set<React.Key>).map(String)),
              )
            }
          >
            {groups.map((g) => (
              <SelectItem key={String(g.id)}>
                {`${g.name} (×${g.rate_multiplier})`}
              </SelectItem>
            ))}
          </Select>
          <div>
            <div className="text-xs text-default-500 mb-1">模型白名单</div>
            <div className="flex gap-1 flex-wrap mb-2">
              {models.map((m) => (
                <Chip
                  key={m}
                  size="sm"
                  variant="flat"
                  onClose={() =>
                    setModels(models.filter((x) => x !== m))
                  }
                >
                  {m}
                </Chip>
              ))}
              {models.length === 0 && (
                <span className="text-xs text-default-400 italic">
                  未设置（不传 model_mapping）
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                size="sm"
                placeholder="claude-sonnet-4-6"
                value={modelInput}
                onValueChange={setModelInput}
              />
              <Button
                size="sm"
                variant="flat"
                onPress={() => {
                  const v = modelInput.trim();
                  if (v && !models.includes(v)) setModels([...models, v]);
                  setModelInput("");
                }}
              >
                添加
              </Button>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={submit} isLoading={submitting}>
            创建
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Templates CRUD modal
// ------------------------------------------------------------------
function TemplatesModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [editing, setEditing] = useState<Partial<TemplateRow> | null>(null);

  async function load() {
    const r = await fetch("/api/scheduling/templates", { cache: "no-store" });
    const j = await r.json();
    setItems(j.items || []);
  }
  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  function startNew() {
    setEditing({
      name: "",
      platform: "anthropic",
      type: "apikey",
      rateMultiplier: 1,
      groupIds: "[]",
      modelList: "[]",
    });
  }

  async function save() {
    if (!editing || !editing.name) {
      addToast({ title: "name 必填", color: "warning" });
      return;
    }
    let groupIds: number[] = [];
    let modelList: string[] = [];
    try {
      groupIds = JSON.parse(editing.groupIds || "[]");
      modelList = JSON.parse(editing.modelList || "[]");
    } catch {
      addToast({ title: "groupIds/modelList 必须是合法 JSON 数组", color: "danger" });
      return;
    }
    const payload = {
      ...editing,
      groupIds,
      modelList,
    };
    const r =
      editing.id != null
        ? await fetch(`/api/scheduling/templates/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/scheduling/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    if (!r.ok) {
      addToast({ title: "保存失败", color: "danger" });
      return;
    }
    setEditing(null);
    await load();
  }

  async function del(id: number) {
    if (!confirm("删除此模板？")) return;
    await fetch(`/api/scheduling/templates/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>模板管理</ModalHeader>
        <ModalBody>
          <Tabs>
            <Tab key="list" title={`列表 (${items.length})`}>
              <div className="pt-2 space-y-2">
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={startNew}
                >
                  + 新建模板
                </Button>
                {items.length === 0 ? (
                  <p className="text-default-500 text-sm">暂无模板</p>
                ) : (
                  items.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2 rounded bg-content2/40 text-sm"
                    >
                      <div>
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-default-400 ml-2">
                          {t.platform} / {t.type} · ×{t.rateMultiplier}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => setEditing(t)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => del(t.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Tab>
          </Tabs>

          {editing && (
            <div className="mt-4 p-3 rounded-lg border border-divider/40 space-y-2">
              <Input
                size="sm"
                label="名称"
                value={editing.name ?? ""}
                onValueChange={(v) =>
                  setEditing({ ...editing, name: v })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  size="sm"
                  label="platform"
                  value={editing.platform ?? "anthropic"}
                  onValueChange={(v) =>
                    setEditing({ ...editing, platform: v })
                  }
                />
                <Input
                  size="sm"
                  label="type"
                  value={editing.type ?? "apikey"}
                  onValueChange={(v) => setEditing({ ...editing, type: v })}
                />
              </div>
              <Input
                size="sm"
                type="number"
                label="rate_multiplier"
                value={String(editing.rateMultiplier ?? 1)}
                onValueChange={(v) =>
                  setEditing({ ...editing, rateMultiplier: Number(v) })
                }
              />
              <Textarea
                size="sm"
                label="groupIds (JSON 数字数组)"
                placeholder="[1, 2, 3]"
                value={editing.groupIds ?? "[]"}
                onValueChange={(v) =>
                  setEditing({ ...editing, groupIds: v })
                }
              />
              <Textarea
                size="sm"
                label="modelList (JSON 字符串数组)"
                placeholder='["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]'
                value={editing.modelList ?? "[]"}
                onValueChange={(v) =>
                  setEditing({ ...editing, modelList: v })
                }
              />
              <Textarea
                size="sm"
                label="备注"
                value={editing.notes ?? ""}
                onValueChange={(v) =>
                  setEditing({ ...editing, notes: v || null })
                }
              />
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button size="sm" color="primary" onPress={save}>
                  保存
                </Button>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// 用户实时并发面板 · Top N（默认 3，可调）。每个用户一张卡片：
//   - 头部：用户名 / email + current_in_use / max_capacity 进度条
//   - 主体：近 1 分钟内打过的分组 + RPM used/limit
// 数据来源：
//   - 并发：父组件 2 秒一刷的 user-concurrency
//   - 分组 RPM：本组件按 topN 用户列表 fan-out /user-rpm-status（同节奏轮询）
function TopUsersPanel({
  userConc,
  siteId,
}: {
  userConc: {
    enabled: boolean;
    user: Record<
      string,
      {
        user_id: number;
        user_email?: string;
        username?: string;
        current_in_use: number;
        max_capacity?: number;
      }
    >;
  } | null;
  siteId: number | null;
}) {
  const [topN, setTopN] = useState<number>(3);
  // Top-K 分组数（每个用户卡片内显示几个分组）。默认 3，可调。
  const [topGroups, setTopGroups] = useState<number>(3);
  useEffect(() => {
    try {
      const rawN = localStorage.getItem("scheduling.topUsersN");
      const n = Number(rawN);
      if (Number.isFinite(n) && n >= 1 && n <= 20) setTopN(n);
      const rawG = localStorage.getItem("scheduling.topGroupsPerUser");
      const g = Number(rawG);
      if (Number.isFinite(g) && g >= 1 && g <= 20) setTopGroups(g);
    } catch {
      // ignore
    }
  }, []);
  function persistTopN(n: number) {
    setTopN(n);
    try {
      localStorage.setItem("scheduling.topUsersN", String(n));
    } catch {
      // ignore
    }
  }
  function persistTopGroups(g: number) {
    setTopGroups(g);
    try {
      localStorage.setItem("scheduling.topGroupsPerUser", String(g));
    } catch {
      // ignore
    }
  }

  type RpmStatus = {
    user_rpm_used?: number;
    user_rpm_limit?: number;
    per_group?: Array<{
      group_id: number;
      group_name?: string;
      used: number;
      limit?: number;
      source?: string;
    }>;
  };
  const [rpmByUser, setRpmByUser] = useState<Record<string, RpmStatus>>({});

  // 伪滑动窗口：sub2api 的 RPM 是"按分钟桶"存的，整点会归零。我们这边记录
  // 每个 (user, group) 上一次观察到的 used，检测到下降 → 整点切换 → 把
  // 切换前的最终值 stash 起来。显示时按当前在本分钟的秒数线性混合：
  //   displayed = current_partial + prev_final × (60 − sec_into_minute) / 60
  // 假设每分钟内流量均匀分布——视觉上把跳变变平滑。
  const rollingRef = useRef<
    Map<string, { lastValue: number; prevMinuteFinal: number }>
  >(new Map());

  function getSlidingValue(key: string, raw: number): number {
    const r = rollingRef.current.get(key);
    if (!r) return raw;
    const sec = Math.floor(Date.now() / 1000) % 60;
    const decay = (60 - sec) / 60;
    return Math.round(r.lastValue + r.prevMinuteFinal * decay);
  }

  function recordRolling(key: string, cur: number) {
    const prev = rollingRef.current.get(key);
    if (prev && cur < prev.lastValue) {
      // 下降 → 检测为整点切换：把切换前的值作为 prevMinuteFinal
      rollingRef.current.set(key, {
        lastValue: cur,
        prevMinuteFinal: prev.lastValue,
      });
    } else {
      rollingRef.current.set(key, {
        lastValue: cur,
        prevMinuteFinal: prev?.prevMinuteFinal ?? 0,
      });
    }
  }

  // Top-N 用户（按 current_in_use 倒序，过滤 0）。
  const top = useMemo(() => {
    if (!userConc) return [];
    return Object.values(userConc.user)
      .filter((u) => (u.current_in_use ?? 0) > 0)
      .sort((a, b) => b.current_in_use - a.current_in_use)
      .slice(0, topN);
  }, [userConc, topN]);

  // 跟 user-concurrency 同节奏拉每个 top 用户的 rpm-status. 用 idsKey 做依赖
  // 避免 top 数组身份每秒变化（值没变但引用换了）导致重复触发。
  const idsKey = top.map((u) => u.user_id).join(",");
  useEffect(() => {
    if (siteId == null || !idsKey) {
      setRpmByUser({});
      return;
    }
    let canceled = false;
    fetch(
      `/api/scheduling/${siteId}/user-rpm-status?userIds=${idsKey}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (canceled) return;
        const status = (j.status ?? {}) as Record<string, RpmStatus>;
        // 喂给伪滑动窗口追踪器
        for (const [uid, rpm] of Object.entries(status)) {
          for (const g of rpm.per_group ?? []) {
            recordRolling(`${uid}:${g.group_id}`, g.used);
          }
        }
        setRpmByUser(status);
      })
      .catch(() => {
        // soft-fail; next poll will retry
      });
    return () => {
      canceled = true;
    };
  }, [siteId, idsKey, userConc]);

  if (!userConc) {
    return (
      <div className="mb-5 text-xs text-default-400">加载用户并发中…</div>
    );
  }
  if (!userConc.enabled) {
    return (
      <div className="mb-5 text-xs text-default-400">
        sub2api 未开启实时监控（settings 里打开 realtime monitoring 即可显示用户并发）
      </div>
    );
  }

  const header = (
    <CardHeader className="pb-1 pt-3 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-default-500" />
        <span className="font-semibold text-sm">用户实时并发</span>
        <span className="text-[11px] text-default-400">每 2 秒刷新</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-default-500">用户前</span>
          <Input
            type="number"
            size="sm"
            variant="bordered"
            className="w-16"
            classNames={{ inputWrapper: "h-7 min-h-7" }}
            value={String(topN)}
            min={1}
            max={20}
            onValueChange={(s) => {
              const n = Math.max(1, Math.min(20, Number(s) || 1));
              persistTopN(n);
            }}
          />
          <span className="text-[11px] text-default-500">个</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-default-500">每人显示</span>
          <Input
            type="number"
            size="sm"
            variant="bordered"
            className="w-16"
            classNames={{ inputWrapper: "h-7 min-h-7" }}
            value={String(topGroups)}
            min={1}
            max={20}
            onValueChange={(s) => {
              const n = Math.max(1, Math.min(20, Number(s) || 1));
              persistTopGroups(n);
            }}
          />
          <span className="text-[11px] text-default-500">个分组</span>
        </div>
      </div>
    </CardHeader>
  );

  if (top.length === 0) {
    return (
      <Card className="mb-5 bg-content1 border border-divider/50 shadow-none">
        {header}
        <CardBody className="pt-1 pb-3 text-xs text-default-500">
          当前没有用户有 in-flight 请求
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="mb-5 bg-content1 border border-divider/50 shadow-none">
      {header}
      <CardBody className="pt-1 pb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {top.map((u) => {
            const name = u.username || u.user_email || `用户 #${u.user_id}`;
            const cap = u.max_capacity ?? 0;
            const concPct =
              cap > 0
                ? Math.min(100, Math.round((u.current_in_use / cap) * 100))
                : 0;
            const concBar =
              concPct >= 90 ? "bg-danger" : concPct >= 70 ? "bg-warning" : "bg-primary";
            const rpm = rpmByUser[String(u.user_id)];
            // 用伪滑动后的值排序+展示。整点边界附近不会跳到 0。
            const perGroup = [...(rpm?.per_group ?? [])]
              .map((g) => ({
                ...g,
                slidingUsed: getSlidingValue(`${u.user_id}:${g.group_id}`, g.used),
              }))
              .sort(
                (a, b) =>
                  b.slidingUsed - a.slidingUsed ||
                  (b.limit ?? 0) - (a.limit ?? 0) ||
                  a.group_id - b.group_id,
              )
              .slice(0, topGroups);
            return (
              <div
                key={u.user_id}
                className="rounded-md border border-divider/60 bg-content2/30 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-sm font-medium truncate"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-xs tabular-nums shrink-0">
                    {u.current_in_use}
                    {cap > 0 && (
                      <span className="text-default-400"> / {cap}</span>
                    )}
                  </span>
                </div>
                {cap > 0 && (
                  <div className="mt-1 h-1.5 rounded bg-default-100 overflow-hidden">
                    <div
                      className={`h-full ${concBar}`}
                      style={{ width: `${concPct}%` }}
                    />
                  </div>
                )}
                <div className="mt-2 flex flex-col gap-0.5">
                  {perGroup.length === 0 ? (
                    <span className="text-[11px] text-default-400">
                      {rpm ? "该用户暂无分组配置" : "加载中…"}
                    </span>
                  ) : (
                    perGroup.map((g) => (
                      <div
                        key={g.group_id}
                        className="flex items-center justify-between text-[11px]"
                      >
                        <span
                          className="truncate"
                          title={g.group_name || `#${g.group_id}`}
                        >
                          {g.group_name || `#${g.group_id}`}
                        </span>
                        <span className="tabular-nums text-default-500 shrink-0 ml-2">
                          {g.slidingUsed}
                          {g.limit != null && g.limit > 0 && (
                            <span className="text-default-400"> / {g.limit}</span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
