"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pin, Settings as SettingsIcon, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { DEFAULT_AZ_CONFIG, type AzConfig } from "@/lib/az";
import { fmtMoneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SiteAccountLite {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
}

interface AccountPreviewRow {
  index: number;
  proposedName: string;
  base_url: string;
  api_key: string;
  warnings: string[];
  proxyId: number | null;
  proxyName: string | null;
}

interface ProxyPreviewRow {
  index: number;
  proposedName: string;
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: string;
  warnings: string[];
  skip: boolean;
}

interface ResultRow {
  name: string;
  ok: boolean;
  id?: number;
  error?: string;
}

interface AzAdminAccount {
  id: number;
  name: string;
  status: string;
  concurrency: number;
  priority: number;
  rate_multiplier: number;
  group_ids?: number[];
  error_message?: string | null;
  last_used_at?: string | null;
}

interface StatsData {
  days: number;
  startDate: string;
  endDate: string;
  total: number;
  cost: number;
  costBase: number;
  actualCost: number;
  profit: number;
  tokens: number;
  requests: number;
  errorCount: number;
  rows: Array<{
    id: number;
    name: string;
    status: string;
    last_used_at?: string | null;
    cost: number;
    costBase: number;
    actualCost: number;
    profit: number;
    requests: number;
    tokens: number;
    fixedCost: number | null;
    error?: string;
  }>;
}

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 min

export default function AzPage() {
  const [sites, setSites] = useState<SiteAccountLite[]>([]);
  const [defaultSiteId, setDefaultSiteId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [config, setConfig] = useState<AzConfig>(DEFAULT_AZ_CONFIG);
  const [presetUpdatedAt, setPresetUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [azAccounts, setAzAccounts] = useState<AzAdminAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsRefreshedAt, setAccountsRefreshedAt] = useState<Date | null>(null);
  const [statsDays, setStatsDays] = useState(1);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRefreshedAt, setStatsRefreshedAt] = useState<Date | null>(null);

  const [cfgOpen, setCfgOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [a, b] = await Promise.all([
          fetch("/api/site").then((r) => r.json()),
          fetch("/api/settings").then((r) => r.json()),
        ]);
        const all: SiteAccountLite[] = (a.items || []).filter(
          (s: SiteAccountLite) => s.type === "sub2api",
        );
        setSites(all);
        const def = b.settings?.defaultAzSiteAccountId ?? null;
        setDefaultSiteId(def);
        const initial = def && all.some((s) => s.id === def) ? def : all[0]?.id ?? null;
        setSiteId(initial);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (siteId == null) return;
    (async () => {
      const r = await fetch(`/api/az/preset/${siteId}`).then((r) => r.json());
      setConfig({ ...DEFAULT_AZ_CONFIG, ...(r.config || {}) });
      setPresetUpdatedAt(r.updatedAt);
    })();
  }, [siteId]);

  const loadAccounts = useCallback(async () => {
    if (siteId == null) return;
    setAccountsLoading(true);
    try {
      const r = await fetch(`/api/az/${siteId}/accounts`);
      const j = await r.json();
      if (!r.ok) {
        toast.error("加载失败", { description: j.error });
        return;
      }
      setAzAccounts(j.items as AzAdminAccount[]);
      setAccountsRefreshedAt(new Date());
    } finally {
      setAccountsLoading(false);
    }
  }, [siteId]);

  const loadStats = useCallback(async () => {
    if (siteId == null) return;
    setStatsLoading(true);
    try {
      const r = await fetch(`/api/az/${siteId}/stats?days=${statsDays}`);
      const j = await r.json();
      if (!r.ok) {
        toast.error("加载失败", { description: j.error });
        return;
      }
      setStats(j as StatsData);
      setStatsRefreshedAt(new Date());
    } finally {
      setStatsLoading(false);
    }
  }, [siteId, statsDays]);

  useEffect(() => {
    if (siteId == null) return;
    setAzAccounts(null);
    setStats(null);
    void loadAccounts();
    void loadStats();
    const t = setInterval(() => {
      void loadAccounts();
      void loadStats();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [siteId, statsDays, loadAccounts, loadStats]);

  async function setAsDefault() {
    if (siteId == null) return;
    const r = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAzSiteAccountId: siteId }),
    });
    if (r.ok) {
      setDefaultSiteId(siteId);
      toast.success("已设为默认");
    }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 size={22} className="text-primary" /> az 管理
          </h1>
          <p className="text-sm text-muted-foreground">
            sub2api 上的批量录入 / 改规则 / 清错 / 成本统计
          </p>
        </div>
      </div>

      {/* Site picker */}
      <Card className="mb-4">
        <CardContent className="flex flex-row flex-wrap items-end gap-3 pt-4">
          <div className="space-y-2 max-w-md">
            <Label>目标站点（仅 sub2api）</Label>
            <Select
              value={siteId ? String(siteId) : undefined}
              onValueChange={(v) => setSiteId(Number(v) || null)}
              disabled={loading || sites.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>
                    {s.name} {s.id === defaultSiteId ? "（默认）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {siteId != null && siteId !== defaultSiteId && (
            <Button
              variant="secondary"
              onClick={setAsDefault}
            >
              <Pin size={14} />
              设为默认
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => setCfgOpen(true)}
            disabled={siteId == null}
          >
            <SettingsIcon size={14} />
            规则配置
          </Button>
          {presetUpdatedAt && (
            <span className="text-xs text-muted-foreground self-center">
              规则更新于 {new Date(presetUpdatedAt).toLocaleString("zh-CN")}
            </span>
          )}
        </CardContent>
      </Card>

      {siteId == null ? (
        <Card>
          <CardContent className="text-muted-foreground text-sm pt-6">
            没有 sub2api 类型的本站账号。请先在「本站账号」页创建一个。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <Tabs defaultValue="accounts">
              <TabsList className="mb-4">
                <TabsTrigger value="accounts">导入账号</TabsTrigger>
                <TabsTrigger value="proxies">导入代理</TabsTrigger>
                <TabsTrigger value="rules">批量改规则</TabsTrigger>
                <TabsTrigger value="cleanup">清错</TabsTrigger>
                <TabsTrigger value="stats">成本统计</TabsTrigger>
              </TabsList>
              <TabsContent value="accounts">
                <ImportAccountsTab siteId={siteId} config={config} />
              </TabsContent>
              <TabsContent value="proxies">
                <ImportProxiesTab siteId={siteId} config={config} />
              </TabsContent>
              <TabsContent value="rules">
                <BulkUpdateTab
                  siteId={siteId}
                  config={config}
                  accounts={azAccounts}
                  loading={accountsLoading}
                  refreshedAt={accountsRefreshedAt}
                  reload={loadAccounts}
                />
              </TabsContent>
              <TabsContent value="cleanup">
                <CleanupTab
                  siteId={siteId}
                  allAccounts={azAccounts}
                  loading={accountsLoading}
                  refreshedAt={accountsRefreshedAt}
                  reload={loadAccounts}
                />
              </TabsContent>
              <TabsContent value="stats">
                <StatsTab
                  data={stats}
                  loading={statsLoading}
                  refreshedAt={statsRefreshedAt}
                  days={statsDays}
                  setDays={setStatsDays}
                  reload={loadStats}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <ConfigModal
        isOpen={cfgOpen}
        onClose={() => setCfgOpen(false)}
        siteId={siteId}
        initial={config}
        onSaved={(c, t) => {
          setConfig(c);
          setPresetUpdatedAt(t);
        }}
      />
    </Shell>
  );
}

// ============================================================
// Tab: 导入账号
// ============================================================
function ImportAccountsTab({
  siteId,
  config,
}: {
  siteId: number;
  config: AzConfig;
}) {
  const [text, setText] = useState("");
  const [costText, setCostText] = useState("500");
  const [alias, setAlias] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{
    rows: AccountPreviewRow[];
    nextSequenceStart: number;
    existingAccountCount: number;
    unboundProxyCount: number;
    aliasMode?: boolean;
    effectivePrefix?: string;
  } | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const aliasMode = alias.trim().length > 0;
  const [shareProxy, setShareProxy] = useState(false);
  const [proxies, setProxies] = useState<
    Array<{ id: number; name: string }> | null
  >(null);
  const [sharedProxyId, setSharedProxyId] = useState<string>("");

  useEffect(() => {
    if (!(shareProxy || aliasMode) || proxies !== null) return;
    let cancelled = false;
    fetch(`/api/az/${siteId}/proxies`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setProxies(j.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setProxies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shareProxy, aliasMode, proxies, siteId]);

  async function parse() {
    setParsing(true);
    setResults(null);
    try {
      const r = await fetch(`/api/az/${siteId}/parse/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, alias: alias.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("解析失败", { description: j.error });
        return;
      }
      setPreview(j);
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const rows = preview.rows.map((r) => ({
        base_url: r.base_url,
        api_key: r.api_key,
      }));
      const costNum = Number(costText);
      const cost =
        Number.isFinite(costNum) && costNum >= 0 ? costNum : null;
      const effectiveShareProxy = shareProxy || aliasMode;
      const singleProxyId =
        effectiveShareProxy && sharedProxyId ? Number(sharedProxyId) : null;
      if (effectiveShareProxy && !singleProxyId) {
        toast.warning(aliasMode ? "别称模式下必须指定共用代理" : "请选择共用代理");
        return;
      }
      const r = await fetch(`/api/az/${siteId}/import/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          cost,
          singleProxyId,
          alias: alias.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("提交失败", { description: j.error });
        return;
      }
      setResults(j.rows);
      if (j.failed) {
        toast.warning(`录入完成 ${j.ok}/${j.total}`, { description: `${j.failed} 条失败` });
      } else {
        toast.success(`录入完成 ${j.ok}/${j.total}`, { description: "全部成功" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label>粘贴账号列表</Label>
        <Textarea
          placeholder={`https://xxx.services.ai.azure.com/anthropic\nsk-xxxx\nhttps://yyy.services.ai.azure.com/anthropic\nsk-yyyy`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />
        <p className="text-xs text-muted-foreground">每行一对，base_url 一行 + api_key 一行；或 CSV: base_url,api_key</p>
      </div>
      <div className="flex gap-2 items-end flex-wrap">
        <div className="space-y-2 w-[200px]">
          <Label>单价成本 (USD)</Label>
          <Input
            type="number"
            className="h-8"
            value={costText}
            onChange={(e) => setCostText(e.target.value)}
            min={0}
          />
          <p className="text-xs text-muted-foreground">每个账号的固定成本，写入本站记账，参与利润计算</p>
        </div>
        <div className="space-y-2 w-[220px]">
          <Label>账号别称（可选）</Label>
          <Input
            className="h-8"
            placeholder="例如 o总"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {aliasMode
              ? `账号将命名为 ${config.account_prefix}${alias.trim()}-N · 该模式自动关闭代理自动配对，必须手动指定一个共用代理`
              : `留空则用默认前缀 ${config.account_prefix}N；填写后命名为 ${config.account_prefix}{别称}-N`}
          </p>
        </div>
        <Button onClick={parse} disabled={parsing || !text.trim()}>
          {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
          解析 + 预览
        </Button>
        <span className="text-xs text-muted-foreground self-center">
          应用规则：分组 [{config.group_ids.join(",") || "未配置"}] · 并发{" "}
          {config.concurrency} · 倍率 x{config.rate_multiplier} ·{" "}
          {aliasMode
            ? "（别称模式 · 共用代理）"
            : config.auto_bind_proxy
              ? "自动绑定代理"
              : "不绑代理"}
        </span>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={shareProxy || aliasMode}
            disabled={aliasMode}
            onCheckedChange={(v) => {
              setShareProxy(!!v);
              if (!v) setSharedProxyId("");
            }}
          />
          <span className="text-xs">
            本批共用同一个代理{aliasMode && "（别称模式下强制开启）"}
          </span>
        </div>
        {(shareProxy || aliasMode) && (
          <div className="space-y-2 w-[260px]">
            <Label>代理</Label>
            <Select
              value={sharedProxyId || undefined}
              onValueChange={(v) => setSharedProxyId(v)}
              disabled={proxies === null || proxies.length === 0}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder={proxies === null ? "加载中..." : "选择共用代理"} />
              </SelectTrigger>
              <SelectContent>
                {(proxies ?? []).map((p) => (
                  <SelectItem key={String(p.id)} value={String(p.id)}>
                    {`${p.name} (#${p.id})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {(shareProxy || aliasMode) && (
          <span className="text-xs text-muted-foreground self-center">
            整批账号都绑这一个代理（自动配对被禁用）
          </span>
        )}
      </div>

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary">
              将创建 {preview.rows.length} 个，从{" "}
              {config.account_prefix}
              {preview.nextSequenceStart} 起
            </Badge>
            <Badge variant="secondary">
              已存在 {preview.existingAccountCount}
            </Badge>
            {config.auto_bind_proxy && (
              <Badge variant="secondary">
                可绑代理 {preview.unboundProxyCount}
              </Badge>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={submit}
              disabled={submitting || preview.rows.length === 0}
              className="text-emerald-600 dark:text-emerald-400"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              提交录入
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>序号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>base_url</TableHead>
                <TableHead>api_key</TableHead>
                <TableHead>代理</TableHead>
                <TableHead>提示</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((r) => (
                <TableRow key={r.index}>
                  <TableCell>{r.index}</TableCell>
                  <TableCell className="font-medium">{r.proposedName}</TableCell>
                  <TableCell className="text-xs font-mono break-all">
                    {r.base_url}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {maskKey(r.api_key)}
                  </TableCell>
                  <TableCell>
                    {r.proxyName != null ? (
                      (() => {
                        const accNum = r.proposedName.match(/(\d+)$/)?.[1];
                        const proxyNum = r.proxyName.match(/(\d+)$/)?.[1];
                        const matched = accNum && proxyNum && accNum === proxyNum;
                        return (
                          <div className="flex flex-col leading-tight">
                            <span
                              className={
                                matched
                                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                                  : "text-amber-600 dark:text-amber-400 font-medium"
                              }
                            >
                              {r.proxyName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              #{r.proxyId}
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-amber-600 dark:text-amber-400">
                    {r.warnings.join("；")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {results && <ResultPanel results={results} />}
    </div>
  );
}

// ============================================================
// Tab: 导入代理
// ============================================================
function ImportProxiesTab({
  siteId,
  config,
}: {
  siteId: number;
  config: AzConfig;
}) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{
    rows: ProxyPreviewRow[];
    nextSequenceStart: number;
    existingProxyCount: number;
  } | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);

  async function parse() {
    setParsing(true);
    setResults(null);
    try {
      const r = await fetch(`/api/az/${siteId}/parse/proxies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("解析失败", { description: j.error });
        return;
      }
      setPreview(j);
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/az/${siteId}/import/proxies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: preview.rows }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("提交失败", { description: j.error });
        return;
      }
      setResults(j.rows);
      toast[j.failed ? "warning" : "success"](`录入完成 ${j.ok}/${j.total}`);
    } finally {
      setSubmitting(false);
    }
  }

  const willCreate = useMemo(
    () => (preview?.rows.filter((r) => !r.skip).length) ?? 0,
    [preview],
  );

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label>粘贴代理列表</Label>
        <Textarea
          placeholder={`1.2.3.4:1080:alice:pwd\n5.6.7.8,1080,bob,pwd`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />
        <p className="text-xs text-muted-foreground">每行一条 host:port:user:pass 或 host,port,user,pass</p>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <Button onClick={parse} disabled={parsing || !text.trim()}>
          {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
          解析 + 预览
        </Button>
        <span className="text-xs text-muted-foreground">
          协议：{config.proxy_protocol}
        </span>
      </div>

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary">
              将创建 {willCreate} 个，从 {config.proxy_prefix}
              {preview.nextSequenceStart} 起
            </Badge>
            <Badge variant="secondary">
              已存在 {preview.existingProxyCount}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={submit}
              disabled={submitting || willCreate === 0}
              className="text-emerald-600 dark:text-emerald-400"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              提交录入
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>序号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>host:port</TableHead>
                <TableHead>认证</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((r) => (
                <TableRow key={r.index}>
                  <TableCell>{r.index}</TableCell>
                  <TableCell className="font-medium">
                    {r.skip ? (
                      <span className="text-muted-foreground line-through">
                        {r.proposedName}
                      </span>
                    ) : (
                      r.proposedName
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.host}:{r.port}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.username
                      ? `${r.username}:${r.password ? "***" : ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.skip ? (
                      <span className="text-muted-foreground">跳过</span>
                    ) : r.warnings.length ? (
                      <span className="text-amber-600 dark:text-amber-400">{r.warnings.join("；")}</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">新增</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {results && <ResultPanel results={results} />}
    </div>
  );
}

function ResultPanel({ results }: { results: ResultRow[] }) {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="success">
          成功 {ok}
        </Badge>
        {failed > 0 && (
          <Badge variant="destructive">
            失败 {failed}
          </Badge>
        )}
      </div>
      {failed > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results
              .filter((r) => !r.ok)
              .map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-xs text-destructive">
                    {r.error}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 12) return k;
  return `${k.slice(0, 6)}...${k.slice(-4)}`;
}

// ============================================================
// 规则配置弹窗
// ============================================================
function ConfigModal({
  isOpen,
  onClose,
  siteId,
  initial,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  siteId: number | null;
  initial: AzConfig;
  onSaved: (c: AzConfig, t: string) => void;
}) {
  const [c, setC] = useState<AzConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [whitelistText, setWhitelistText] = useState("");

  useEffect(() => {
    if (isOpen) {
      setC(initial);
      setWhitelistText(Object.keys(initial.model_mapping).join("\n"));
    }
  }, [isOpen, initial]);

  function update<K extends keyof AzConfig>(k: K, v: AzConfig[K]) {
    setC((prev) => ({ ...prev, [k]: v }));
  }

  function parseWhitelist(text: string): Record<string, string> {
    const m: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const name = t.split("=")[0].trim();
      if (name) m[name] = name;
    }
    return m;
  }

  async function save() {
    if (siteId == null) return;
    setSaving(true);
    try {
      const finalCfg = { ...c, model_mapping: parseWhitelist(whitelistText) };
      const r = await fetch(`/api/az/preset/${siteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalCfg),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("保存失败", { description: j.error });
        return;
      }
      onSaved(j.config, j.updatedAt);
      toast.success("已保存");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>az 规则配置</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>并发</Label>
              <Input
                type="number"
                value={String(c.concurrency)}
                onChange={(e) => update("concurrency", Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>优先级</Label>
              <Input
                type="number"
                value={String(c.priority)}
                onChange={(e) => update("priority", Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>计费倍率</Label>
              <Input
                type="number"
                step="0.01"
                value={String(c.rate_multiplier)}
                onChange={(e) => update("rate_multiplier", Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>所属分组 group_ids</Label>
            <Input
              value={c.group_ids.join(",")}
              onChange={(e) =>
                update(
                  "group_ids",
                  e.target.value
                    .split(/[,，]+/)
                    .map((x) => Number(x.trim()))
                    .filter((x) => Number.isFinite(x) && x > 0),
                )
              }
            />
            <p className="text-xs text-muted-foreground">逗号分隔，例 4,2,5,7。顺序决定 group-priority</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={c.confirm_mixed_channel_risk}
              onCheckedChange={(v) => update("confirm_mixed_channel_risk", v)}
            />
            <Label>confirm_mixed_channel_risk（账号在多组时需要 true）</Label>
          </div>
          <div className="space-y-2">
            <Label>模型白名单</Label>
            <Textarea
              placeholder={`claude-opus-4-7\nclaude-sonnet-4-6\nclaude-haiku-4-5-20251001`}
              rows={5}
              value={whitelistText}
              onChange={(e) => setWhitelistText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">每行一个模型名。只有列在这里的模型才能通过；留空 = 允许所有模型透传</p>
          </div>
          <hr className="border-border my-2" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>账号命名前缀</Label>
              <Input
                value={c.account_prefix}
                onChange={(e) => update("account_prefix", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>账号起始编号</Label>
              <Input
                type="number"
                value={String(c.account_start_index)}
                onChange={(e) => update("account_start_index", Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>代理命名前缀</Label>
              <Input
                value={c.proxy_prefix}
                onChange={(e) => update("proxy_prefix", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>代理起始编号</Label>
              <Input
                type="number"
                value={String(c.proxy_start_index)}
                onChange={(e) => update("proxy_start_index", Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>代理协议</Label>
              <Select
                value={c.proxy_protocol}
                onValueChange={(v) => update("proxy_protocol", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="socks5">socks5</SelectItem>
                  <SelectItem value="socks5h">socks5h</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="https">https</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.auto_bind_proxy}
                  onCheckedChange={(v) => update("auto_bind_proxy", v)}
                />
                <Label>录入账号时自动绑定空闲代理</Label>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 p-3 rounded-lg bg-card border border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">临时不可调度规则</span>
              <Switch
                checked={c.temp_unschedulable_enabled !== false}
                onCheckedChange={(v) => update("temp_unschedulable_enabled", v)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              命中错误码 + 关键词时，临时停用该渠道指定分钟数；过后自动恢复
            </p>
            <div className="flex flex-col gap-2">
              {(c.temp_unschedulable_rules ?? []).map((rule, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-1 items-end"
                >
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">错误码</Label>
                    <Input
                      className="h-8"
                      type="number"
                      value={String(rule.error_code)}
                      onChange={(e) => {
                        const next = [...(c.temp_unschedulable_rules ?? [])];
                        next[idx] = {
                          ...rule,
                          error_code: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        };
                        update("temp_unschedulable_rules", next);
                      }}
                    />
                  </div>
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">关键词（逗号分隔）</Label>
                    <Input
                      className="h-8"
                      value={rule.keywords.join(", ")}
                      onChange={(e) => {
                        const next = [...(c.temp_unschedulable_rules ?? [])];
                        next[idx] = {
                          ...rule,
                          keywords: e.target.value
                            .split(/,\s*/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        };
                        update("temp_unschedulable_rules", next);
                      }}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">时长（分钟）</Label>
                    <Input
                      className="h-8"
                      type="number"
                      value={String(rule.duration_minutes)}
                      onChange={(e) => {
                        const next = [...(c.temp_unschedulable_rules ?? [])];
                        next[idx] = {
                          ...rule,
                          duration_minutes: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        };
                        update("temp_unschedulable_rules", next);
                      }}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">说明</Label>
                    <Input
                      className="h-8"
                      value={rule.description ?? ""}
                      onChange={(e) => {
                        const next = [...(c.temp_unschedulable_rules ?? [])];
                        next[idx] = { ...rule, description: e.target.value };
                        update("temp_unschedulable_rules", next);
                      }}
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="col-span-1 text-destructive"
                    onClick={() => {
                      const next = (c.temp_unschedulable_rules ?? []).filter(
                        (_, i) => i !== idx,
                      );
                      update("temp_unschedulable_rules", next);
                    }}
                  >
                    x
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = [
                    ...(c.temp_unschedulable_rules ?? []),
                    {
                      error_code: 400,
                      keywords: ["has been blocked"],
                      duration_minutes: 120,
                      description: "",
                    },
                  ];
                  update("temp_unschedulable_rules", next);
                }}
              >
                + 添加规则
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Tab: 批量改规则
// ============================================================
function BulkUpdateTab({
  siteId,
  config,
  accounts,
  loading,
  refreshedAt,
  reload,
}: {
  siteId: number;
  config: AzConfig;
  accounts: AzAdminAccount[] | null;
  loading: boolean;
  refreshedAt: Date | null;
  reload: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [updateMapping, setUpdateMapping] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const visibleAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.status === "active"),
    [accounts],
  );
  const hiddenCount = (accounts?.length ?? 0) - visibleAccounts.length;

  useEffect(() => {
    if (visibleAccounts.length > 0 && selected.size === 0) {
      setSelected(new Set(visibleAccounts.map((a) => a.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAccounts]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function submit() {
    if (selected.size === 0) {
      toast.warning("请至少选一个账号");
      return;
    }
    if (
      !confirm(
        `将对 ${selected.size} 个账号应用当前规则${
          updateMapping ? "（含模型白名单）" : ""
        }，确定吗？`,
      )
    )
      return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/az/${siteId}/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: [...selected],
          updateModelMapping: updateMapping,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("提交失败", { description: j.error });
        return;
      }
      const desc = j.ok
        ? `已更新 ${j.targetCount} 个${j.includedWhitelist ? "（含白名单）" : ""}`
        : `失败：${j.error ?? "未知错误"}`;
      toast[j.ok ? "success" : "error"](j.ok ? "批量更新完成" : "批量更新失败", { description: desc });
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          刷新列表
        </Button>
        {refreshedAt && (
          <span className="text-xs text-muted-foreground">
            上次刷新 {refreshedAt.toLocaleTimeString("zh-CN")}（每 3 分钟自动）
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          已选 {selected.size} / {visibleAccounts.length}（仅显示 status=active
          {hiddenCount > 0 ? `，已隐藏 ${hiddenCount} 个非活跃` : ""}） ·{" "}
          规则：并发 {config.concurrency} · 优先级 {config.priority} · 倍率 x
          {config.rate_multiplier} · 分组 [{config.group_ids.join(",") || "—"}]
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={updateMapping}
              onCheckedChange={setUpdateMapping}
            />
            <Label className="text-sm">同时更新模型白名单</Label>
          </div>
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting || selected.size === 0}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            应用规则
          </Button>
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : visibleAccounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {(accounts?.length ?? 0) === 0
            ? "没有匹配 az-N 命名的账号"
            : `共 ${accounts?.length ?? 0} 个 az 账号，但当前都不是 active 状态`}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <input
                  type="checkbox"
                  checked={
                    selected.size > 0 && selected.size === visibleAccounts.length
                  }
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selected.size > 0 &&
                        selected.size < visibleAccounts.length;
                  }}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(visibleAccounts.map((a) => a.id))
                        : new Set(),
                    )
                  }
                />
              </TableHead>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>并发</TableHead>
              <TableHead>优先级</TableHead>
              <TableHead>倍率</TableHead>
              <TableHead>分组</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleAccounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                </TableCell>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell>
                  <Badge variant="success">
                    {a.status}
                  </Badge>
                </TableCell>
                <TableCell>{a.concurrency}</TableCell>
                <TableCell>{a.priority}</TableCell>
                <TableCell>x{a.rate_multiplier}</TableCell>
                <TableCell className="text-xs">
                  [{(a.group_ids ?? []).join(",")}]
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ============================================================
// Tab: 清错
// ============================================================
function CleanupTab({
  siteId,
  allAccounts,
  loading,
  refreshedAt,
  reload,
}: {
  siteId: number;
  allAccounts: AzAdminAccount[] | null;
  loading: boolean;
  refreshedAt: Date | null;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const accounts = useMemo(
    () => allAccounts?.filter((a) => a.status === "error") ?? null,
    [allAccounts],
  );

  async function run(mode: "delete" | "clear") {
    if (!accounts || accounts.length === 0) return;
    const verb = mode === "delete" ? "删除" : "清错状态";
    if (!confirm(`确定${verb} ${accounts.length} 个错误账号？`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/az/${siteId}/cleanup-errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          account_ids: accounts.map((a) => a.id),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("失败", { description: j.error });
        return;
      }
      if (j.failed) {
        toast.warning(`${verb}完成 ${j.ok}/${j.total}`, { description: `${j.failed} 个失败` });
      } else {
        toast.success(`${verb}完成 ${j.ok}/${j.total}`, { description: "全部成功" });
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          刷新
        </Button>
        {refreshedAt && (
          <span className="text-xs text-muted-foreground">
            上次刷新 {refreshedAt.toLocaleTimeString("zh-CN")}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          错误账号 {accounts?.length ?? 0} 个
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run("clear")}
            disabled={busy || !accounts || accounts.length === 0}
            className="text-amber-600 dark:text-amber-400"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            清错状态（不删）
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => run("delete")}
            disabled={busy || !accounts || accounts.length === 0}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            全部删除
          </Button>
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : !accounts || accounts.length === 0 ? (
        <p className="text-emerald-600 dark:text-emerald-400 text-sm">✓ 没有错误账号</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>错误信息</TableHead>
              <TableHead>最后使用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="text-xs text-destructive break-all">
                  {a.error_message || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.last_used_at
                    ? new Date(a.last_used_at).toLocaleString("zh-CN")
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ============================================================
// Tab: 成本统计
// ============================================================
function StatsTab({
  data,
  loading,
  refreshedAt,
  days,
  setDays,
  reload,
}: {
  data: StatsData | null;
  loading: boolean;
  refreshedAt: Date | null;
  days: number;
  setDays: (n: number) => void;
  reload: () => void;
}) {
  const [showErrors, setShowErrors] = useState(false);
  const visibleRows = useMemo(
    () =>
      data
        ? showErrors
          ? data.rows
          : data.rows.filter((r) => r.status !== "error")
        : [],
    [data, showErrors],
  );
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">区间</span>
        {[1, 7, 30, 60, 90].map((d) => (
          <Badge
            key={d}
            variant={days === d ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setDays(d)}
          >
            {d === 1 ? "今日" : `${d} 天`}
          </Badge>
        ))}
        <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          刷新
        </Button>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={showErrors}
            onCheckedChange={(v) => setShowErrors(!!v)}
          />
          <span className="text-xs">
            显示 error 账号
            {data && data.errorCount > 0 && (
              <span className="text-destructive ml-1">({data.errorCount})</span>
            )}
          </span>
        </div>
        {refreshedAt && (
          <span className="text-xs text-muted-foreground">
            上次 {refreshedAt.toLocaleTimeString("zh-CN")}（每 3 分钟自动）
          </span>
        )}
        {data && (
          <span className="text-xs text-muted-foreground ml-auto">
            {data.startDate} ~ {data.endDate}
          </span>
        )}
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryCell
            label="成本（固定）"
            value={`$${fmtMoneyShort(data.cost)}`}
          />
          <SummaryCell
            label="1x 消费"
            value={`$${fmtMoneyShort(data.costBase)}`}
          />
          <SummaryCell
            label="实际消费"
            value={`$${fmtMoneyShort(data.actualCost)}`}
            accent="primary"
          />
          <SummaryCell
            label="利润"
            value={`$${fmtMoneyShort(data.profit)}`}
            accent={data.profit >= 0 ? "primary" : "danger"}
          />
          <SummaryCell
            label="账号 / 错误"
            value={`${data.total} / ${data.errorCount}`}
            accent={data.errorCount > 0 ? "danger" : "default"}
          />
        </div>
      )}

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : !data || data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无数据</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          全部 {data.rows.length} 个账号均为 error 状态。勾选「显示 error 账号」查看。
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>成本</TableHead>
              <TableHead>1x 消费</TableHead>
              <TableHead>实际消费</TableHead>
              <TableHead>利润</TableHead>
              <TableHead>请求 / token</TableHead>
              <TableHead>最后使用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => {
              const profitTone =
                r.profit > 0
                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                  : r.profit < 0
                    ? "text-destructive font-medium"
                    : "text-muted-foreground";
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.error && (
                      <span
                        className="ml-1 text-xs text-destructive"
                        title={r.error}
                      >
                        ⚠
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "active"
                          ? "success"
                          : r.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span>${fmtMoneyShort(r.cost)}</span>
                      {r.fixedCost != null && (
                        <span className="text-xs text-muted-foreground">固定</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    ${fmtMoneyShort(r.costBase)}
                  </TableCell>
                  <TableCell>${fmtMoneyShort(r.actualCost)}</TableCell>
                  <TableCell className={profitTone}>
                    ${fmtMoneyShort(r.profit)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.requests} · {fmtTokens(r.tokens)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.last_used_at
                      ? new Date(r.last_used_at).toLocaleString("zh-CN")
                      : "—"}
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

function SummaryCell({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string;
  accent?: "default" | "primary" | "danger";
}) {
  const tone =
    accent === "primary"
      ? "text-primary"
      : accent === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "k";
  return n.toFixed(0);
}
