"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  CheckCircle2,
  PlayCircle,
  Power,
  Search,
  XCircle,
} from "lucide-react";

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
  // sub2api group ids in scope. one for a regular group; multiple for a
  // custom group. all accounts in ANY of these groups are unioned/deduped.
  groupIds: number[];
  // name-prefix exclusions reused from the scheduling page filter so the
  // user doesn't see channels they've already opted out of.
  excludeList?: string[];
  // Notify parent (e.g. close modal) so it can re-pull structure if needed.
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
      // Apply name-prefix excludeList from the parent scheduling filter.
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
      const r = await fetch(
        `/api/scheduling/${siteId}/channels/${id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
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
    addToast({ title: "检测完成", color: "success" });
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
      addToast({ title: `已启用 ${a.name}`, color: "success" });
      setAccounts((prev) => prev.filter((x) => x.id !== a.id));
      onChanged?.();
    } catch (e) {
      addToast({
        title: `启用失败 ${a.name}`,
        description: e instanceof Error ? e.message : String(e),
        color: "danger",
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
        <CardBody className="text-danger text-sm">
          缺少 siteId 或 groupIds 参数
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Compact header strip — title is supplied by the wrapping context
          (page Shell or Modal header), this just shows scope subtitle. */}
      {memberGroupNames.length > 0 && memberGroupNames.length > 1 && (
        <div className="text-xs text-default-500 break-all">
          覆盖分组：{memberGroupNames.join("、")}
        </div>
      )}

      <Card className="bg-content1 border border-divider/50 shadow-none">
        <CardBody className="gap-3 py-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <div className="font-semibold text-sm">需要审核的渠道</div>
              <div className="text-xs text-default-500 mt-0.5">
                未启用 / 未调度 / 有错误的渠道。一键检测后通过的可一键启用。
              </div>
            </div>
            <Button
              color="primary"
              size="sm"
              startContent={<PlayCircle size={14} />}
              onPress={testAll}
              isLoading={running}
              isDisabled={accounts.length === 0}
            >
              一键检测（{accounts.length}）
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                {
                  v: "passed",
                  label: `仅通过 (${counts.passed})`,
                  color: "success" as const,
                },
                {
                  v: "failed",
                  label: `仅失败 (${counts.failed})`,
                  color: "danger" as const,
                },
                {
                  v: "all",
                  label: `全部 (${accounts.length})`,
                  color: "default" as const,
                },
              ] as const
            ).map((opt) => (
              <Chip
                key={opt.v}
                size="sm"
                variant={view === opt.v ? "solid" : "flat"}
                color={view === opt.v ? opt.color : "default"}
                className="cursor-pointer"
                onClick={() => setView(opt.v)}
              >
                {opt.label}
              </Chip>
            ))}
            {counts.pending > 0 && (
              <span className="text-xs text-default-400 ml-1">
                未测试 {counts.pending}
              </span>
            )}
            {hiddenByExclude > 0 && (
              <span className="text-xs text-default-400">
                已按"排除前缀"过滤掉 {hiddenByExclude}
              </span>
            )}
            <div className="ml-auto w-full sm:w-64">
              <Input
                size="sm"
                placeholder="搜索账号名…"
                startContent={<Search size={14} />}
                value={q}
                onValueChange={setQ}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : error ? (
        <Card>
          <CardBody className="text-danger text-sm">{error}</CardBody>
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <CardBody className="text-default-500 text-sm">
            该范围下没有需要处理的渠道。
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="text-default-500 text-sm">
            当前筛选下没有符合条件的渠道。
            {view === "passed" &&
              counts.pending > 0 &&
              " 先点上方「一键检测」。"}
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((a) => {
            const t = tests[a.id] ?? { kind: "idle" };
            const tags = classifyProblem(a);
            const canEnable = t.kind === "ok";
            return (
              <Card
                key={a.id}
                className="bg-content1 border border-divider/50 shadow-none"
              >
                <CardBody className="gap-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map((tag) => (
                          <Chip
                            key={tag}
                            size="sm"
                            variant="flat"
                            color="warning"
                            classNames={{
                              base: "h-5",
                              content: "text-[11px] px-1.5",
                            }}
                          >
                            {tag}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    <TestPill state={t} />
                  </div>
                  {a.error_message && (
                    <div className="text-xs text-danger break-all line-clamp-2">
                      {a.error_message}
                    </div>
                  )}
                  {t.kind === "fail" && (
                    <div className="text-xs text-default-500 break-all line-clamp-3">
                      {t.output}
                    </div>
                  )}
                  <div className="flex justify-end mt-1">
                    <Button
                      size="sm"
                      color="success"
                      variant="flat"
                      startContent={<Power size={14} />}
                      onPress={() => enable(a)}
                      isLoading={enabling.has(a.id)}
                      isDisabled={!canEnable}
                    >
                      启用
                    </Button>
                  </div>
                </CardBody>
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
    return (
      <Chip size="sm" variant="flat" color="default">
        未测试
      </Chip>
    );
  if (state.kind === "testing")
    return (
      <Chip size="sm" variant="flat" color="primary">
        测试中…
      </Chip>
    );
  if (state.kind === "ok")
    return (
      <Chip
        size="sm"
        variant="flat"
        color="success"
        startContent={<CheckCircle2 size={12} className="ml-1" />}
      >
        通过
      </Chip>
    );
  return (
    <Chip
      size="sm"
      variant="flat"
      color="danger"
      startContent={<XCircle size={12} className="ml-1" />}
    >
      失败
    </Chip>
  );
}
