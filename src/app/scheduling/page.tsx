"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  Tabs,
  Textarea,
  addToast,
  useDisclosure,
} from "@heroui/react";
import {
  Activity,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  TestTube2,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatCard from "@/components/StatCard";
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
  const [bindings, setBindings] = useState<
    Record<string, BindingInfo[]>
  >({});
  const [groupUsage, setGroupUsage] = useState<
    Record<string, { cost: number; actualCost: number; requests: number }>
  >({});
  const [groupUsers, setGroupUsers] = useState<GroupUsersRow[]>([]);
  const [view, setView] = useState<"channels" | "users">("channels");
  const [structureLoading, setStructureLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAcc, setBusyAcc] = useState<number | null>(null);
  const [editAcc, setEditAcc] = useState<AccountRow | null>(null);
  const [editConcurrency, setEditConcurrency] = useState<string>("");
  const [editPriority, setEditPriority] = useState<string>("");
  const [editActive, setEditActive] = useState(true);
  const [editSchedulable, setEditSchedulable] = useState(true);
  const [editGroupIds, setEditGroupIds] = useState<Set<string>>(new Set());
  // Filters (persisted to localStorage)
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [excludePrefixes, setExcludePrefixes] = useState<string>("");
  const [prefixDraft, setPrefixDraft] = useState<string>("");

  useEffect(() => {
    try {
      const sf = localStorage.getItem("scheduling.statusFilter");
      const ep = localStorage.getItem("scheduling.excludePrefixes");
      if (sf === "all" || sf === "active" || sf === "inactive")
        setStatusFilter(sf);
      if (ep != null) {
        setExcludePrefixes(ep);
        setPrefixDraft(ep);
      }
    } catch {
      // ignore
    }
  }, []);

  function persistStatus(v: "all" | "active" | "inactive") {
    setStatusFilter(v);
    try {
      localStorage.setItem("scheduling.statusFilter", v);
    } catch {
      // ignore
    }
  }
  function persistPrefixes(v: string) {
    setExcludePrefixes(v);
    try {
      localStorage.setItem("scheduling.excludePrefixes", v);
    } catch {
      // ignore
    }
  }

  const newDlg = useDisclosure();
  const tplDlg = useDisclosure();
  const editDlg = useDisclosure();
  const filterDlg = useDisclosure();

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
      setGroups(j.groups || []);
      setAccounts(j.accounts || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setStructureLoading(false);
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

  const loadBindings = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/bindings`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) setBindings(j.byRemoteAccountId || {});
    } catch {
      // ignore
    }
  }, [siteId]);

  const loadGroupUsage = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/group-usage`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) setGroupUsage(j.byGroup || {});
    } catch {
      // ignore
    }
  }, [siteId]);

  const loadGroupUsers = useCallback(async () => {
    if (siteId == null) return;
    try {
      const r = await fetch(`/api/scheduling/${siteId}/group-users`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) setGroupUsers(j.groups || []);
    } catch {
      // ignore
    }
  }, [siteId]);

  // Drive loaders.
  // structure + bindings: 60s. concurrency: 2s. all paused when tab hidden.
  const visibleRef = useRef<boolean>(
    typeof document === "undefined" ? true : !document.hidden,
  );
  useEffect(() => {
    if (siteId == null) return;
    loadStructure();
    loadBindings();
    loadConcurrency();
    loadGroupUsage();
    const tick = () => {
      if (!visibleRef.current) return;
      loadConcurrency();
    };
    const tickStruct = () => {
      if (!visibleRef.current) return;
      loadStructure();
    };
    const tickBind = () => {
      if (!visibleRef.current) return;
      loadBindings();
    };
    const tickUsage = () => {
      if (!visibleRef.current) return;
      loadGroupUsage();
    };
    const t1 = setInterval(tick, POLL_MS);
    const t2 = setInterval(tickStruct, STRUCTURE_MS);
    const t3 = setInterval(tickBind, BINDINGS_MS);
    const t4 = setInterval(tickUsage, STRUCTURE_MS);
    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (!document.hidden) {
        loadConcurrency();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearInterval(t4);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [siteId, loadConcurrency, loadStructure, loadBindings, loadGroupUsage]);

  // Group-users view: load on demand + slow refresh (60s) while active.
  useEffect(() => {
    if (siteId == null || view !== "users") return;
    loadGroupUsers();
    const t = setInterval(() => {
      if (!visibleRef.current) return;
      loadGroupUsers();
    }, STRUCTURE_MS);
    return () => clearInterval(t);
  }, [siteId, view, loadGroupUsers]);

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
    const arr = [...byGroup.values()]
      .filter((g) => g.accounts.length > 0)
      .map((g) => ({
        ...g,
        todayCost: groupUsage[String(g.group.id)]?.actualCost ?? 0,
      }));
    // Primary: today's actual cost desc. Tiebreak: in-flight desc.
    arr.sort((a, b) => b.todayCost - a.todayCost || b.inFlight - a.inFlight);
    return arr;
  }, [groups, filteredAccounts, concurrency, groupUsage]);

  const hiddenCount = accounts.length - filteredAccounts.length;

  const stats = useMemo(() => {
    const totalInFlight = grouped.reduce((s, g) => s + g.inFlight, 0);
    const totalCap = grouped.reduce((s, g) => s + g.capacity, 0);
    const totalAcc = filteredAccounts.length;
    const errCount = filteredAccounts.filter(isErrored).length;
    // "Active and healthy" — exclude accounts with error_message even when
    // sub2api still reports status=active.
    const activeCount = filteredAccounts.filter(
      (a) => a.status === "active" && !isErrored(a),
    ).length;
    return { totalInFlight, totalCap, totalAcc, errCount, activeCount };
  }, [grouped, filteredAccounts]);

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
            按分组聚合 · in-flight 每 2 秒刷新 · 站点结构每 60 秒刷新
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            label="站点"
            className="w-[200px]"
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
            onPress={() => {
              loadStructure();
              loadConcurrency();
              loadBindings();
            }}
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="当前总并发"
          value={`${stats.totalInFlight} / ${stats.totalCap}`}
          icon={Activity}
          accent="primary"
        />
        <StatCard
          label="渠道（active）"
          value={`${stats.activeCount} / ${stats.totalAcc}`}
          accent="success"
        />
        <StatCard
          label="异常渠道"
          value={String(stats.errCount)}
          accent={stats.errCount > 0 ? "danger" : "default"}
        />
        <StatCard
          label="分组数"
          value={String(grouped.length)}
          accent="default"
        />
      </div>

      {error && (
        <Card className="mb-4 bg-danger-50 border border-danger-200 shadow-none">
          <CardBody className="text-danger text-sm">{error}</CardBody>
        </Card>
      )}

      <Tabs
        selectedKey={view}
        onSelectionChange={(k) => setView(String(k) as "channels" | "users")}
        variant="underlined"
        className="mb-4"
        classNames={{ tabList: "px-0" }}
      >
        <Tab key="channels" title="渠道调度" />
        <Tab key="users" title="分组使用" />
      </Tabs>

      {view === "users" ? (
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {grouped.map((g) => (
            <GroupCard
              key={g.group.id}
              group={g.group}
              accounts={g.accounts}
              inFlight={g.inFlight}
              capacity={g.capacity}
              todayCost={g.todayCost}
              concurrency={concurrency}
              bindings={bindings}
              onEditAccount={(a) => {
                setEditAcc(a);
                setEditConcurrency(String(a.concurrency ?? 0));
                setEditPriority(String(a.priority ?? 0));
                setEditActive(a.status === "active");
                setEditSchedulable(a.schedulable !== false);
                setEditGroupIds(
                  new Set((a.group_ids ?? []).map(String)),
                );
                editDlg.onOpen();
              }}
              onAddChannel={() => {
                newDlg.onOpen();
              }}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={filterDlg.isOpen}
        onClose={filterDlg.onClose}
        size="md"
      >
        <ModalContent>
          <ModalHeader>排除前缀</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-xs text-default-500">
              名字以下面任一前缀开头的账号将不显示在这里。每行一个；
              空行和以 # 开头的注释行会被忽略。大小写不敏感。
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
              onPress={() => {
                persistPrefixes(prefixDraft);
                filterDlg.onClose();
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
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<TestTube2 size={14} />}
                  onPress={() => testAccount(editAcc.id)}
                >
                  测试此渠道
                </Button>
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
                });
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
  inFlight,
  capacity,
  todayCost,
  concurrency,
  bindings,
  onEditAccount,
  onAddChannel,
}: {
  group: GroupRow;
  accounts: AccountRow[];
  inFlight: number;
  capacity: number;
  todayCost: number;
  concurrency: ConcurrencyState;
  bindings: Record<string, BindingInfo[]>;
  onEditAccount: (a: AccountRow) => void;
  onAddChannel: () => void;
}) {
  const pct =
    capacity > 0 ? Math.min(100, Math.round((inFlight / capacity) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary";
  const sortedAccounts = [...accounts].sort((a, b) => {
    const ai = concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
    const bi = concurrency.account?.[String(b.id)]?.current_in_use ?? 0;
    return bi - ai;
  });
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
                <div className="font-medium truncate">{a.name}</div>
                <div className="flex items-center gap-1 leading-tight">
                  {a.schedulable === false && (
                    <span className="text-[10px] text-warning">未调度</span>
                  )}
                  {bind.length > 0 && bind[0].maxConcurrency != null && (
                    <span className="text-[10px] text-primary">
                      绑 max {bind[0].maxConcurrency}
                    </span>
                  )}
                  {errored && a.error_message && (
                    <span className="text-[10px] text-danger truncate">
                      {a.error_message}
                    </span>
                  )}
                </div>
              </div>
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
        <button
          className="mt-2 text-xs text-primary hover:underline"
          onClick={onAddChannel}
        >
          + 新增渠道到该分组
        </button>
      </CardBody>
    </Card>
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
