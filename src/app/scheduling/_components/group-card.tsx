"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Settings as SettingsIcon, Sparkles, TestTube2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtMoneyShort } from "@/lib/format";
import {
  type AccountRow,
  type GroupRow,
  type ConcurrencyState,
  type BindingInfo,
  isErrored,
} from "../_types";
import { BulkEditDialog } from "../_modals/bulk-edit-dialog";
import { AutoTestDialog } from "../_modals/auto-test-dialog";

// ---------------------------------------------------------------------------
// Helper sub-components (BindingRateChip, TestResultChip)
// ---------------------------------------------------------------------------

function BindingRateChip({ bind }: { bind: BindingInfo[] }) {
  if (bind.length === 0) {
    return (
      <span
        className="text-[10px] text-muted-foreground/70 italic"
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
  const r = first.upstreamEffectiveRateMultiplier;
  const colorClass =
    r < 1
      ? "text-emerald-600 dark:text-emerald-400"
      : r > 1
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <span
      className={`text-[10px] ${colorClass} font-medium`}
      title={tooltip}
    >
      上游 {first.upstreamGroupName} ×{r}
      {first.upstreamHasExclusiveRate ? " 专属" : ""}
      {sorted.length > 1 && (
        <span className="text-muted-foreground/70 font-normal">
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
        <Loader2 className="h-3 w-3 animate-spin" /> 测试中
      </span>
    );
  }
  const sec = (result.latencyMs / 1000).toFixed(2) + "s";
  if (result.kind === "ok") {
    const colorClass =
      result.latencyMs < 5000
        ? "text-emerald-600 dark:text-emerald-400"
        : result.latencyMs < 15000
          ? "text-foreground"
          : "text-amber-600 dark:text-amber-400";
    return (
      <span className={`text-[10px] font-medium ${colorClass}`}>
        ✓ {sec}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] text-destructive font-medium"
      title={result.output}
    >
      ✗ {sec}
    </span>
  );
}

// ---------------------------------------------------------------------------
// GroupCard
// ---------------------------------------------------------------------------

interface GroupCardProps {
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
}

export function GroupCard({
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
}: GroupCardProps) {
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

  // ── 批量编辑 state ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ── 自动测试 ──
  const AUTO_TEST_MIN_MINUTES = 1;
  const AUTO_TEST_KEY = `scheduling.autoTestV2.${siteId ?? "x"}.${group.id}`;
  const DEFAULT_TEST_MODEL = "claude-opus-4-6";
  const [autoTestEnabled, setAutoTestEnabled] = useState(false);
  const [autoTestIntervalMin, setAutoTestIntervalMin] = useState(5);
  const [autoTestModel, setAutoTestModel] = useState<string>(DEFAULT_TEST_MODEL);
  const [autoTestModalOpen, setAutoTestModalOpen] = useState(false);

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

  // ── Derived data ──
  const baseList = mode === "scheduled" ? accounts : unscheduled;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? baseList.filter((a) => (a.name ?? "").toLowerCase().includes(q))
    : baseList;
  const pct =
    capacity > 0 ? Math.min(100, Math.round((inFlight / capacity) * 100)) : 0;
  const barColor =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
        ? "bg-amber-500"
        : "bg-primary";

  const sortedAccounts = [...filtered].sort((a, b) => {
    const ac = accountStats[String(a.id)]?.user_cost ?? 0;
    const bc = accountStats[String(b.id)]?.user_cost ?? 0;
    if (bc !== ac) return bc - ac;
    const ai = concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
    const bi = concurrency.account?.[String(b.id)]?.current_in_use ?? 0;
    return bi - ai;
  });

  // ── Test group ──
  async function testGroup() {
    if (groupTesting || siteId == null) return;
    setGroupTesting(true);
    setGroupTestResults(() => {
      const next: typeof groupTestResults = {};
      for (const a of sortedAccounts) next[a.id] = { kind: "pending" };
      return next;
    });
    const queue = [...sortedAccounts];
    const m = autoTestModel.trim();
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
    await Promise.all(
      Array.from({ length: Math.min(5, sortedAccounts.length) }, () => worker()),
    );
    setGroupTesting(false);

    // Alert when ALL accounts fail
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
          // ignore
        }
      }
    }
  }

  // ── Bulk edit ──
  async function applyBulk(patch: Record<string, unknown>) {
    if (siteId == null || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await fetch(
        `/api/scheduling/${siteId}/channels/bulk-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountIds: Array.from(selectedIds),
            patch,
          }),
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error("批量更新失败", {
          description: String(j.error || r.status),
        });
        return;
      }
      toast.success(`已批量更新 ${selectedIds.size} 个账号`);
      setSelectedIds(new Set());
      setBulkEditOpen(false);
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Auto-test interval ──
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
      if (groupTesting) return;
      testGroupRef.current().catch(() => {});
    };
    tick();
    const t = setInterval(tick, interval);
    return () => {
      canceled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTestEnabled, autoTestIntervalMin, sortedAccounts.length]);

  // ── Test stats summary ──
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

  // ── Render ──
  return (
    <Card className="rounded-lg border border-border shadow-none">
      <CardHeader className="flex flex-col items-stretch gap-2 pb-2">
        {/* Row 1: group name + badges + cost + channel count */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{group.name}</h3>
            <Badge variant="secondary" className="text-[11px] px-1.5 py-0">
              ×{group.rate_multiplier}
            </Badge>
            <Badge
              variant={group.status === "active" ? "secondary" : "warning"}
              className="text-[11px] px-1.5 py-0"
            >
              {group.status}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            {todayCost > 0 && (
              <span className="text-foreground font-medium">
                ${fmtMoneyShort(todayCost)}
              </span>
            )}
            {accounts.length} 渠道
            {unscheduled.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setMode((m) =>
                    m === "scheduled" ? "unscheduled" : "scheduled",
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0 text-[11px] h-5 font-semibold transition-colors cursor-pointer",
                  mode === "unscheduled"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {mode === "unscheduled"
                  ? `回到调度中`
                  : `未调度 ${unscheduled.length}`}
              </button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="min-w-0 w-7 h-7"
              title={
                autoTestEnabled
                  ? `自动测试已开启 · 每 ${autoTestIntervalMin} 分钟`
                  : "可用性自动检测设置"
              }
              onClick={() => setAutoTestModalOpen(true)}
            >
              <SettingsIcon
                size={14}
                className={autoTestEnabled ? "text-emerald-600 dark:text-emerald-400" : ""}
              />
            </Button>
          </span>
        </div>

        {/* Row 2: concurrency bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-foreground">
            {inFlight} / {capacity || "∞"}
          </span>
        </div>

        {/* Row 3: search */}
        <Input
          className="h-7"
          placeholder="搜索账号名…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Row 4: action buttons + test stats */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={testGroup}
            disabled={groupTesting || sortedAccounts.length === 0}
          >
            {groupTesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube2 size={14} />
            )}
            一键测试（{sortedAccounts.length}）
          </Button>
          <span
            className="text-[11px] text-muted-foreground self-center font-mono"
            title="可在右上角齿轮里修改"
          >
            模型: {autoTestModel}
          </span>
          {autoTestEnabled && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 self-center">
              自动测试 · 每 {autoTestIntervalMin} 分钟
            </span>
          )}
          {(testStats.ok > 0 || testStats.fail > 0) && (
            <span className="text-[11px] text-muted-foreground self-center">
              {testStats.ok} 通过
              {testStats.fail > 0 && (
                <span className="text-destructive"> · {testStats.fail} 失败</span>
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

      <CardContent className="pt-0 gap-1 flex flex-col">
        {/* Bulk toolbar */}
        {sortedAccounts.length > 0 && (
          <div className="flex items-center gap-1.5 px-1 py-1 mb-1 flex-wrap text-[11px]">
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={
                  selectedIds.size > 0 &&
                  sortedAccounts.every((a) => selectedIds.has(a.id))
                    ? true
                    : selectedIds.size > 0
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedIds(new Set(sortedAccounts.map((a) => a.id)));
                  } else {
                    setSelectedIds(new Set());
                  }
                }}
              />
              <span className="text-[11px]">
                {selectedIds.size > 0
                  ? `已选 ${selectedIds.size}`
                  : "全选"}
              </span>
            </div>
            {selectedIds.size > 0 && (
              <>
                <span className="text-border">|</span>
                <Button
                  variant="secondary"
                  className="h-6 px-2 min-w-0 text-[11px]"
                  onClick={() => setBulkEditOpen(true)}
                  disabled={bulkBusy}
                >
                  批量编辑
                </Button>
                <Button
                  variant="ghost"
                  className="h-6 px-2 min-w-0 text-[11px]"
                  onClick={() => setSelectedIds(new Set())}
                >
                  取消选择
                </Button>
              </>
            )}
          </div>
        )}

        {/* Account rows */}
        {sortedAccounts.map((a) => {
          const inflightVal =
            concurrency.account?.[String(a.id)]?.current_in_use ?? 0;
          const lim = a.concurrency ?? 0;
          const full = lim > 0 && inflightVal >= lim;
          const off = a.status !== "active";
          const bind = bindings[String(a.id)] ?? [];
          const errored = isErrored(a);
          const selected = selectedIds.has(a.id);
          return (
            <div
              key={a.id}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors",
                selected
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : "bg-muted/40 hover:bg-accent/50",
              )}
              title={errored && a.error_message ? a.error_message : undefined}
            >
              <Checkbox
                className="shrink-0"
                checked={selected}
                onCheckedChange={() => toggleSelect(a.id)}
              />
              <span className="shrink-0 w-3 text-center">
                {errored ? (
                  <span className="text-destructive">⚠</span>
                ) : a.status === "active" ? (
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                ) : (
                  <span className="text-muted-foreground/70">·</span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{a.name}</span>
                  <span className="text-[10px] text-muted-foreground/70 font-normal shrink-0">
                    P{a.priority ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-1 leading-tight flex-wrap">
                  {a.schedulable === false && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      未调度
                    </span>
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
                      className="text-[10px] text-muted-foreground truncate"
                      title={a.notes}
                    >
                      📝 {a.notes}
                    </span>
                  )}
                  {errored && a.error_message && (
                    <span className="text-[10px] text-destructive truncate">
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
                    className="font-mono shrink-0 text-muted-foreground"
                    title={`今日 cost ${s?.cost ?? 0} · user_cost ${userCost} · req ${s?.requests ?? 0}`}
                  >
                    ${fmtMoneyShort(userCost)}
                  </span>
                );
              })()}
              <span
                className={cn(
                  "font-mono shrink-0",
                  off
                    ? "text-muted-foreground/70"
                    : full
                      ? "text-destructive font-semibold"
                      : "text-foreground",
                )}
              >
                {inflightVal}/{lim || "∞"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 min-w-0 h-7 px-2"
                onClick={() => onEditAccount(a)}
              >
                编辑
              </Button>
            </div>
          );
        })}

        {/* Smart dispatch link */}
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
      </CardContent>

      {/* Bulk edit dialog */}
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedCount={selectedIds.size}
        onApply={applyBulk}
        busy={bulkBusy}
      />

      {/* Auto-test settings dialog */}
      <AutoTestDialog
        open={autoTestModalOpen}
        onOpenChange={setAutoTestModalOpen}
        groupName={group.name}
        initialEnabled={autoTestEnabled}
        initialIntervalMin={autoTestIntervalMin}
        initialModel={autoTestModel}
        minMinutes={AUTO_TEST_MIN_MINUTES}
        defaultModel={DEFAULT_TEST_MODEL}
        onSave={(enabled, intervalMin, model) => {
          setAutoTestEnabled(enabled);
          setAutoTestIntervalMin(intervalMin);
          setAutoTestModel(model);
          persistAutoTest(enabled, intervalMin, model);
        }}
      />
    </Card>
  );
}
