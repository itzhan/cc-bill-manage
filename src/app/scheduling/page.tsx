"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Layers } from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtMoneyShort } from "@/lib/format";

import type {
  SiteRow,
  GroupRow,
  AccountRow,
  ConcurrencyState,
  BindingInfo,
  GroupUsersRow,
  CustomGroupRow,
  GroupedEntry,
} from "./_types";
import { isErrored } from "./_types";
import { useDisclosure } from "./_hooks/use-disclosure";

import { SchedulingHeader } from "./_components/scheduling-header";
import { TopUsersPanel } from "./_components/top-users-panel";
import { GroupCard } from "./_components/group-card";
import { CustomGroupCard } from "./_components/custom-group-card";
import GroupUsersView from "./_components/group-users-view";
import ErrorRankingView from "./_components/error-ranking-view";

import { EditChannelDialog } from "./_modals/edit-channel-dialog";
import { NewChannelDialog } from "./_modals/new-channel-dialog";
import { TemplatesDialog } from "./_modals/templates-dialog";
import { FilterPrefixesDialog } from "./_modals/filter-prefixes-dialog";
import { CustomGroupsDialog } from "./_modals/custom-groups-dialog";
import { SmartDispatchDialog } from "./_modals/smart-dispatch-dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 2000;
const STRUCTURE_MS = 60_000;
const BINDINGS_MS = 60_000;
const ACCOUNT_STATS_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SchedulingPage() {
  // ── Core data state ──
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [defaultSiteId, setDefaultSiteId] = useState<number | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [concurrency, setConcurrency] = useState<ConcurrencyState>({});
  const [siteRate, setSiteRate] = useState<{
    rpm: number;
    tpm: number;
  } | null>(null);
  const [userConc, setUserConc] = useState<{
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
  } | null>(null);
  const [bindings, setBindings] = useState<Record<string, BindingInfo[]>>({});
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
  const [customGroups, setCustomGroups] = useState<CustomGroupRow[]>([]);

  // ── View / UI state ──
  const [view, setView] = useState<"channels" | "users" | "errors">(
    "channels",
  );
  const [structureLoading, setStructureLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAcc, setBusyAcc] = useState<number | null>(null);

  // ── Edit-channel modal state ──
  const [editAcc, setEditAcc] = useState<AccountRow | null>(null);
  const [editConcurrency, setEditConcurrency] = useState<string>("");
  const [editPriority, setEditPriority] = useState<string>("");
  const [editActive, setEditActive] = useState(true);
  const [editSchedulable, setEditSchedulable] = useState(true);
  const [editGroupIds, setEditGroupIds] = useState<Set<string>>(new Set());
  const [editNotes, setEditNotes] = useState<string>("");
  const [editModels, setEditModels] = useState<string[]>([]);
  const [editModelsInitial, setEditModelsInitial] = useState<string[]>([]);
  const [editModelsLoading, setEditModelsLoading] = useState(false);
  const [editModelInput, setEditModelInput] = useState<string>("");
  const [editTestModel, setEditTestModel] = useState<string>(
    "claude-opus-4-6",
  );
  const [editCreds, setEditCreds] = useState<{
    baseUrl: string;
    apiKey: string;
  } | null>(null);
  const [editCredsLoading, setEditCredsLoading] = useState(false);
  const [editKeyRevealed, setEditKeyRevealed] = useState(false);

  // ── Filters ──
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [excludePrefixes, setExcludePrefixes] = useState<string>("");
  const [prefixDraft, setPrefixDraft] = useState<string>("");
  const [savingPrefixes, setSavingPrefixes] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  // ── Smart dispatch scope ──
  const [smartScope, setSmartScope] = useState<{
    groupIds: number[];
    label: string;
  } | null>(null);

  // ── Dialog open/close ──
  const newDlg = useDisclosure();
  const tplDlg = useDisclosure();
  const editDlg = useDisclosure();
  const filterDlg = useDisclosure();
  const cgrpDlg = useDisclosure();
  const smartDlg = useDisclosure();

  // ── Cache stamp ──
  const [cacheStamp, setCacheStamp] = useState<string | null>(null);

  // =========================================================================
  // Init: read statusFilter from localStorage, excludePrefixes from server
  // =========================================================================
  useEffect(() => {
    try {
      const sf = localStorage.getItem("scheduling.statusFilter");
      if (sf === "all" || sf === "active" || sf === "inactive")
        setStatusFilter(sf);
    } catch {
      // ignore
    }
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const ep =
          (j.settings?.schedulingExcludePrefixes as string | null | undefined) ??
          "";
        setExcludePrefixes(ep);
        setPrefixDraft(ep);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem("scheduling.showUnscheduled");
      if (v === "1") setShowUnscheduled(true);
    } catch {
      // ignore
    }
  }, []);

  // =========================================================================
  // Persist helpers
  // =========================================================================
  function persistStatus(v: "all" | "active" | "inactive") {
    setStatusFilter(v);
    try {
      localStorage.setItem("scheduling.statusFilter", v);
    } catch {}
  }

  function persistShowUnscheduled(v: boolean) {
    setShowUnscheduled(v);
    try {
      localStorage.setItem("scheduling.showUnscheduled", v ? "1" : "0");
    } catch {}
  }

  async function persistPrefixes(v: string): Promise<boolean> {
    setSavingPrefixes(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedulingExcludePrefixes: v || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return false;
      }
      setExcludePrefixes(v);
      toast.success("已保存（对所有人生效）");
      return true;
    } catch (e) {
      toast.error("保存失败", {
        description: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      setSavingPrefixes(false);
    }
  }

  // =========================================================================
  // localStorage cache helpers (instant hydrate on page entry)
  // =========================================================================
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
      } catch {}
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId],
  );

  // =========================================================================
  // Data loaders
  // =========================================================================

  // Load sites once
  useEffect(() => {
    fetch("/api/scheduling/sites", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const items = (j.items || []) as SiteRow[];
        setSites(items);
        setDefaultSiteId(j.defaultSiteId ?? null);
        if (items.length && siteId == null) {
          const defId = j.defaultSiteId;
          const hasDefault = defId && items.some((s) => s.id === defId);
          setSiteId(hasDefault ? defId : items[0].id);
        }
      });
  }, [siteId]);

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
    } catch {}
  }, [siteId]);

  const loadConcurrency = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/concurrency`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) setConcurrency(j);
    } catch {}
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
    } catch {}
  }, [siteId]);

  const loadUserConc = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/user-concurrency`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        setUserConc({ enabled: j.enabled !== false, user: j.user ?? {} });
      }
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
  }, [siteId, cacheSet]);

  // =========================================================================
  // Refresh-all: global flag prevents concurrent 2s poll from clobbering UI
  // =========================================================================
  const refreshingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    if (siteId == null) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
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
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
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

  // =========================================================================
  // Cache hydrate on site change
  // =========================================================================
  useEffect(() => {
    if (siteId == null) return;
    const cachedStruct = cacheGet<{
      groups: GroupRow[];
      accounts: AccountRow[];
    }>("structure");
    const cachedBindings =
      cacheGet<Record<string, BindingInfo[]>>("bindings");
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
    if (cachedUsers) setGroupUsers(cachedUsers);
    if (cachedStats) setAccountStats(cachedStats);
    if (cachedStamp) setCacheStamp(cachedStamp);
    if (!hasAny) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // =========================================================================
  // Polling effects
  // =========================================================================

  // Concurrency + site RPM/TPM + per-user concurrency: 2s poll (channels tab)
  useEffect(() => {
    if (siteId == null) return;
    if (view !== "channels") return;
    const fireAll = () => {
      loadConcurrency();
      loadSiteRate();
      loadUserConc();
    };
    fireAll();
    const tick = () => {
      if (!visibleRef.current) return;
      if (refreshingRef.current) return;
      fireAll();
    };
    const t = setInterval(tick, POLL_MS);
    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (!document.hidden && !refreshingRef.current) fireAll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [siteId, view, loadConcurrency, loadSiteRate, loadUserConc]);

  // Group-users: load on first switch if cache empty
  useEffect(() => {
    if (siteId == null || view !== "users") return;
    if (groupUsers.length === 0) loadGroupUsers();
  }, [siteId, view, groupUsers.length, loadGroupUsers]);

  // Account stats: 2-minute auto-poll
  useEffect(() => {
    if (siteId == null) return;
    const tick = () => {
      if (!visibleRef.current) return;
      loadAccountStats();
    };
    const t = setInterval(tick, ACCOUNT_STATS_MS);
    return () => clearInterval(t);
  }, [siteId, loadAccountStats]);

  // =========================================================================
  // Computed: filtered & grouped accounts
  // =========================================================================
  const excludeList = useMemo(
    () =>
      excludePrefixes
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#")),
    [excludePrefixes],
  );

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (!showUnscheduled && a.schedulable === false) return false;
      if (statusFilter === "active" && a.status !== "active") return false;
      if (statusFilter === "inactive" && a.status === "active") return false;
      if (
        excludeList.some((p) =>
          (a.name ?? "").toLowerCase().startsWith(p.toLowerCase()),
        )
      )
        return false;
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

  const grouped: GroupedEntry[] = useMemo(() => {
    const byGroup = new Map<
      number,
      {
        group: GroupRow;
        accounts: AccountRow[];
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
        const inflight =
          concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
        slot.inFlight += inflight;
        if (a.status === "active") slot.active++;
        else slot.inactive++;
      }
    }
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
    arr.sort((a, b) => b.todayCost - a.todayCost || b.inFlight - a.inFlight);
    return arr;
  }, [groups, filteredAccounts, accounts, concurrency, groupUsage, excludeList]);

  const hiddenCount = accounts.length - filteredAccounts.length;

  // =========================================================================
  // Actions: patchAccount, testAccount
  // =========================================================================
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
        toast.error("更新失败", { description: j.error });
        return;
      }
      toast.success("已更新");
      await loadStructure();
    } finally {
      setBusyAcc(null);
    }
  }

  async function testAccount(accId: number, modelId?: string) {
    if (siteId == null) return;
    toast("测试中…");
    const r = await fetch(
      `/api/scheduling/${siteId}/channels/${accId}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelId ? { model_id: modelId } : {}),
      },
    );
    const j = await r.json();
    if (j.ok) {
      toast.success("测试成功");
    } else {
      toast.error("测试失败", {
        description: (j.output || "").slice(0, 200),
      });
    }
  }

  // =========================================================================
  // Open edit-channel dialog handler
  // =========================================================================
  function handleEditAccount(a: AccountRow) {
    setEditAcc(a);
    setEditConcurrency(String(a.concurrency ?? 0));
    setEditPriority(String(a.priority ?? 0));
    setEditActive(a.status === "active");
    setEditSchedulable(a.schedulable !== false);
    setEditGroupIds(new Set((a.group_ids ?? []).map(String)));
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
      fetch(`/api/scheduling/${siteId}/channels/${a.id}/models`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((j) => {
          const ids = ((j.items ?? []) as { id: string }[]).map((m) => m.id);
          setEditModels(ids);
          setEditModelsInitial(ids);
        })
        .catch(() => {})
        .finally(() => setEditModelsLoading(false));
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
  }

  function handleSmartDispatch(ids: number[], label: string) {
    setSmartScope({ groupIds: ids, label });
    smartDlg.onOpen();
  }

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <Shell>
      <SchedulingHeader
        sites={sites}
        siteId={siteId}
        setSiteId={setSiteId}
        defaultSiteId={defaultSiteId}
        onSetDefault={async () => {
          await fetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedulingDefaultSiteId: siteId }),
          });
          setDefaultSiteId(siteId);
          toast.success("已设为默认站点");
        }}
        refreshing={refreshing}
        structureLoading={structureLoading}
        onRefresh={refreshAll}
        onOpenTemplates={tplDlg.onOpen}
        onOpenCustomGroups={cgrpDlg.onOpen}
        onOpenNewChannel={newDlg.onOpen}
        cacheStamp={cacheStamp}
        statusFilter={statusFilter}
        onStatusFilterChange={persistStatus}
        showUnscheduled={showUnscheduled}
        onShowUnscheduledChange={persistShowUnscheduled}
        unscheduledHiddenCount={unscheduledHiddenCount}
        excludeListCount={excludeList.length}
        onOpenFilterPrefixes={() => {
          setPrefixDraft(excludePrefixes);
          filterDlg.onOpen();
        }}
        hiddenCount={hiddenCount}
      />

      {/* RPM / TPM stat cards */}
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

      {/* Top users real-time concurrency */}
      <TopUsersPanel userConc={userConc} siteId={siteId} />

      {/* Error banner */}
      {error && (
        <Card className="mb-4 bg-destructive/10 border border-destructive/20 shadow-none rounded-lg">
          <CardContent className="p-4 text-destructive text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {/* View tabs */}
      <Tabs
        value={view}
        onValueChange={(v) =>
          setView(v as "channels" | "users" | "errors")
        }
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="channels">渠道调度</TabsTrigger>
          <TabsTrigger value="users">分组使用</TabsTrigger>
          <TabsTrigger value="errors">错误排行</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Tab content */}
      {view === "errors" ? (
        <ErrorRankingView siteId={siteId} />
      ) : view === "users" ? (
        <GroupUsersView rows={groupUsers} excludeList={excludeList} />
      ) : grouped.length === 0 && !structureLoading ? (
        <Card className="rounded-lg border border-border shadow-none">
          <CardContent className="p-4 text-muted-foreground text-sm">
            没有可显示的分组（或站点尚未拉取结构）。
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Custom groups */}
          {customGroups.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
                <Layers size={14} className="text-primary" />
                自定义分组
                <span className="text-xs text-muted-foreground/70 font-normal">
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
                    onSmartDispatch={handleSmartDispatch}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Group cards */}
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
                onEditAccount={handleEditAccount}
                onSmartDispatch={handleSmartDispatch}
                onChanged={loadStructure}
                siteId={siteId}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Dialogs ── */}

      <SmartDispatchDialog
        open={smartDlg.isOpen}
        onOpenChange={(v) => {
          if (!v) {
            smartDlg.onClose();
            setSmartScope(null);
          }
        }}
        siteId={siteId}
        scope={smartScope}
        excludeList={excludeList}
        onChanged={() => {
          void loadStructure();
        }}
      />

      <CustomGroupsDialog
        open={cgrpDlg.isOpen}
        onOpenChange={cgrpDlg.onOpenChange}
        siteId={siteId}
        groups={groups}
        items={customGroups}
        onChanged={loadCustomGroups}
      />

      <FilterPrefixesDialog
        open={filterDlg.isOpen}
        onOpenChange={filterDlg.onOpenChange}
        draft={prefixDraft}
        setDraft={setPrefixDraft}
        saving={savingPrefixes}
        onSave={async () => {
          const ok = await persistPrefixes(prefixDraft);
          if (ok) filterDlg.onClose();
        }}
      />

      <EditChannelDialog
        open={editDlg.isOpen}
        onOpenChange={editDlg.onOpenChange}
        editAcc={editAcc}
        editCreds={editCreds}
        editCredsLoading={editCredsLoading}
        editKeyRevealed={editKeyRevealed}
        setEditKeyRevealed={setEditKeyRevealed}
        editActive={editActive}
        setEditActive={setEditActive}
        editSchedulable={editSchedulable}
        setEditSchedulable={setEditSchedulable}
        editConcurrency={editConcurrency}
        setEditConcurrency={setEditConcurrency}
        editPriority={editPriority}
        setEditPriority={setEditPriority}
        editGroupIds={editGroupIds}
        setEditGroupIds={setEditGroupIds}
        editNotes={editNotes}
        setEditNotes={setEditNotes}
        editModels={editModels}
        setEditModels={setEditModels}
        editModelsLoading={editModelsLoading}
        editModelsInitial={editModelsInitial}
        editModelInput={editModelInput}
        setEditModelInput={setEditModelInput}
        editTestModel={editTestModel}
        setEditTestModel={setEditTestModel}
        groups={groups}
        concurrency={concurrency}
        siteId={siteId}
        busyAcc={busyAcc}
        patchAccount={patchAccount}
        testAccount={testAccount}
      />

      <NewChannelDialog
        open={newDlg.isOpen}
        onOpenChange={newDlg.onOpenChange}
        siteId={siteId}
        groups={groups}
        onCreated={async () => {
          newDlg.onClose();
          await loadStructure();
        }}
      />

      <TemplatesDialog
        open={tplDlg.isOpen}
        onOpenChange={tplDlg.onOpenChange}
      />
    </Shell>
  );
}
