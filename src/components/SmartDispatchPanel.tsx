"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  PlayCircle,
  Power,
  Search,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MODEL_PRESETS = [
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

interface Group {
  id: number;
  name: string;
  rate_multiplier: number;
  status: string;
}

interface Account {
  id: number;
  name: string;
  status?: string;
  schedulable?: boolean;
  group_ids?: number[];
  error_message?: string | null;
  notes?: string | null;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "fail"; output: string };

type ViewFilter = "passed" | "failed" | "all";

const TEST_CONCURRENCY = 5;

function classifyProblem(a: Account): string[] {
  const tags: string[] = [];
  if (a.status && a.status !== "active") tags.push(`status=${a.status}`);
  if (a.schedulable === false) tags.push("未调度");
  if (a.error_message && a.error_message.trim()) tags.push("有错误");
  return tags;
}

export interface SmartDispatchPanelProps {
  siteId: number | null;
  groupIds: number[];
  excludeList?: string[];
  onChanged?: () => void;
}

export default function SmartDispatchPanel({
  siteId,
  groupIds,
  excludeList = [],
  onChanged,
}: SmartDispatchPanelProps) {
  const groupIdSet = useMemo(() => new Set(groupIds), [groupIds]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberGroupNames, setMemberGroupNames] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [hiddenByExclude, setHiddenByExclude] = useState(0);
  const [tests, setTests] = useState<Record<number, TestState>>({});
  const [view, setView] = useState<ViewFilter>("passed");
  const [enabling, setEnabling] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [q, setQ] = useState("");
  const [testModel, setTestModel] = useState<string>("claude-opus-4-6");

  async function load() {
    if (!siteId || groupIdSet.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/scheduling/${siteId}/structure`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(j.error || `${r.status}`);
      }
      const allGroups = (j.groups || []) as Group[];
      const memberGroups = allGroups.filter((x) => groupIdSet.has(x.id));
      setMemberGroupNames(memberGroups.map((g) => g.name));

      const all = (j.accounts || []) as Account[];
      const seen = new Set<number>();
      const inScope: Account[] = [];
      for (const a of all) {
        const matches = (a.group_ids || []).some((id) => groupIdSet.has(id));
        if (!matches || seen.has(a.id)) continue;
        seen.add(a.id);
        inScope.push(a);
      }
      const probAll = inScope.filter((a) => classifyProblem(a).length > 0);
      const excluders = excludeList
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const prob = probAll.filter((a) => {
        const n = (a.name || "").toLowerCase();
        return !excluders.some((p) => n.startsWith(p));
      });
      setAccounts(prob);
      setHiddenByExclude(probAll.length - prob.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTests({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, JSON.stringify(groupIds), JSON.stringify(excludeList)]);

  async function testOne(id: number): Promise<TestState> {
    try {
      const m = testModel.trim();
      const r = await fetch(
        `/api/scheduling/${siteId}/channels/${id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(m ? { model_id: m } : {}),
        },
      );
      const j = await r.json();
      if (j.ok) return { kind: "ok" };
      return { kind: "fail", output: String(j.output || "").slice(0, 800) };
    } catch (e) {
      return {
        kind: "fail",
        output: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async function testRow(a: Account) {
    setTests((prev) => ({ ...prev, [a.id]: { kind: "testing" } }));
    const res = await testOne(a.id);
    setTests((prev) => ({ ...prev, [a.id]: res }));
  }

  async function testAll() {
    if (running) return;
    setRunning(true);
    setTests((prev) => {
      const next = { ...prev };
      for (const a of accounts) next[a.id] = { kind: "testing" };
      return next;
    });
    const queue = [...accounts];
    async function worker() {
      while (queue.length > 0) {
        const a = queue.shift();
        if (!a) break;
        const res = await testOne(a.id);
        setTests((prev) => ({ ...prev, [a.id]: res }));
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(TEST_CONCURRENCY, accounts.length) },
        () => worker(),
      ),
    );
    setRunning(false);
    toast.success("检测完成");
  }

  async function enable(a: Account) {
    setEnabling((s) => new Set(s).add(a.id));
    try {
      const putRes = await fetch(`/api/scheduling/${siteId}/channels/${a.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!putRes.ok) {
        const j = await putRes.json().catch(() => ({}));
        throw new Error(j.error || `status update ${putRes.status}`);
      }
      if (a.schedulable === false) {
        const sRes = await fetch(
          `/api/scheduling/${siteId}/channels/${a.id}/schedulable`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedulable: true }),
          },
        );
        if (!sRes.ok) {
          const j = await sRes.json().catch(() => ({}));
          throw new Error(j.error || `schedulable ${sRes.status}`);
        }
      }
      if (a.error_message && a.error_message.trim()) {
        await fetch(`/api/scheduling/${siteId}/channels/clear-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_ids: [a.id] }),
        }).catch(() => {});
      }
      toast.success(`已启用 ${a.name}`);
      setAccounts((prev) => prev.filter((x) => x.id !== a.id));
      onChanged?.();
    } catch (e) {
      toast.error(`启用失败 ${a.name}`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEnabling((s) => {
        const next = new Set(s);
        next.delete(a.id);
        return next;
      });
    }
  }

  const counts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let pending = 0;
    for (const a of accounts) {
      const t = tests[a.id]?.kind;
      if (t === "ok") passed++;
      else if (t === "fail") failed++;
      else pending++;
    }
    return { passed, failed, pending };
  }, [accounts, tests]);

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (lc && !a.name.toLowerCase().includes(lc)) return false;
      const t = tests[a.id]?.kind ?? "idle";
      if (view === "passed") return t === "ok";
      if (view === "failed") return t === "fail";
      return true;
    });
  }, [accounts, tests, view, q]);

  if (!siteId || groupIdSet.size === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-destructive text-sm">
          缺少 siteId 或 groupIds 参数
        </CardContent>
      </Card>
    );
  }

  const viewOptions: { v: ViewFilter; label: string; activeClass: string }[] = [
    { v: "passed", label: `仅通过 (${counts.passed})`, activeClass: "bg-emerald-600 text-white" },
    { v: "failed", label: `仅失败 (${counts.failed})`, activeClass: "bg-destructive text-destructive-foreground" },
    { v: "all", label: `全部 (${accounts.length})`, activeClass: "bg-primary text-primary-foreground" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {memberGroupNames.length > 1 && (
        <div className="text-xs text-muted-foreground break-all">
          覆盖分组：{memberGroupNames.join("、")}
        </div>
      )}

      <Card className="shadow-none">
        <CardContent className="py-3 space-y-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="font-semibold text-sm">需要审核的渠道</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                未启用 / 未调度 / 有错误的渠道。一键检测后通过的可一键启用。
              </div>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Input
                  className="w-56 h-8 text-xs"
                  placeholder="测试模型（留空用默认）"
                  value={testModel}
                  onChange={(e) => setTestModel(e.target.value)}
                  list="model-presets"
                />
                <datalist id="model-presets">
                  {MODEL_PRESETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <Button
                size="sm"
                onClick={testAll}
                disabled={running || accounts.length === 0}
              >
                {running && <Loader2 className="h-4 w-4 animate-spin" />}
                <PlayCircle className="h-4 w-4" />
                一键检测（{accounts.length}）
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {viewOptions.map((opt) => (
              <button
                key={opt.v}
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                  view === opt.v
                    ? opt.activeClass
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
                onClick={() => setView(opt.v)}
              >
                {opt.label}
              </button>
            ))}
            {counts.pending > 0 && (
              <span className="text-xs text-muted-foreground/70 ml-1">
                未测试 {counts.pending}
              </span>
            )}
            {hiddenByExclude > 0 && (
              <span className="text-xs text-muted-foreground/70">
                已按"排除前缀"过滤掉 {hiddenByExclude}
              </span>
            )}
            <div className="ml-auto w-full sm:w-64 relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="搜索账号名…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-4 text-destructive text-sm">{error}</CardContent>
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-muted-foreground text-sm">
            该范围下没有需要处理的渠道。
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-muted-foreground text-sm">
            当前筛选下没有符合条件的渠道。
            {view === "passed" &&
              counts.pending > 0 &&
              " 先点单条「测试」或上方「一键检测」，或者切到「全部」直接启用。"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((a) => {
            const t = tests[a.id] ?? { kind: "idle" };
            const tags = classifyProblem(a);
            const testing = t.kind === "testing";
            const enableVariant: "default" | "secondary" | "outline" =
              t.kind === "ok" ? "default" : t.kind === "fail" ? "secondary" : "default";
            const enableLabel = t.kind === "fail" ? "仍要启用" : "启用";
            return (
              <Card key={a.id} className="shadow-none">
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium truncate text-sm">{a.name}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="warning" className="text-[11px] px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <TestPill state={t} />
                  </div>
                  {a.error_message && (
                    <div className="text-xs text-destructive break-all line-clamp-2">
                      {a.error_message}
                    </div>
                  )}
                  {t.kind === "fail" && (
                    <div className="text-xs text-muted-foreground break-all line-clamp-3">
                      {t.output}
                    </div>
                  )}
                  <div className="flex justify-end gap-1 mt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testRow(a)}
                      disabled={testing || running}
                    >
                      {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <PlayCircle className="h-3.5 w-3.5" />
                      {t.kind === "ok" || t.kind === "fail" ? "重测" : "测试"}
                    </Button>
                    <Button
                      size="sm"
                      variant={enableVariant}
                      onClick={() => enable(a)}
                      disabled={enabling.has(a.id)}
                    >
                      {enabling.has(a.id) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <Power className="h-3.5 w-3.5" />
                      {enableLabel}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TestPill({ state }: { state: TestState }) {
  if (state.kind === "idle")
    return <Badge variant="secondary">未测试</Badge>;
  if (state.kind === "testing")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        测试中…
      </Badge>
    );
  if (state.kind === "ok")
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        通过
      </Badge>
    );
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      失败
    </Badge>
  );
}
