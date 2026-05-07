"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
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
import { Pin, Settings as SettingsIcon, Wand2 } from "lucide-react";
import Shell from "@/components/Shell";
import { DEFAULT_AZ_CONFIG, type AzConfig } from "@/lib/az";
import { fmtMoneyShort } from "@/lib/format";

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

// Lifted to AzPage so the data persists across tab switches and we can
// poll once for everyone instead of each tab reloading on mount.
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

  // Shared data for the 3 admin tabs (bulk-update / cleanup / stats)
  const [azAccounts, setAzAccounts] = useState<AzAdminAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsRefreshedAt, setAccountsRefreshedAt] = useState<Date | null>(
    null,
  );
  const [statsDays, setStatsDays] = useState(1);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRefreshedAt, setStatsRefreshedAt] = useState<Date | null>(null);

  const cfgDlg = useDisclosure();

  // === Load sites + default ===
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

  // Load preset when siteId changes
  useEffect(() => {
    if (siteId == null) return;
    (async () => {
      const r = await fetch(`/api/az/preset/${siteId}`).then((r) => r.json());
      setConfig({ ...DEFAULT_AZ_CONFIG, ...(r.config || {}) });
      setPresetUpdatedAt(r.updatedAt);
    })();
  }, [siteId]);

  // Account list loader (used by Bulk-update + Cleanup tabs)
  const loadAccounts = useCallback(async () => {
    if (siteId == null) return;
    setAccountsLoading(true);
    try {
      const r = await fetch(`/api/az/${siteId}/accounts`);
      const j = await r.json();
      if (!r.ok) {
        addToast({ title: "加载失败", description: j.error, color: "danger" });
        return;
      }
      setAzAccounts(j.items as AzAdminAccount[]);
      setAccountsRefreshedAt(new Date());
    } finally {
      setAccountsLoading(false);
    }
  }, [siteId]);

  // Stats loader (used by Stats tab)
  const loadStats = useCallback(async () => {
    if (siteId == null) return;
    setStatsLoading(true);
    try {
      const r = await fetch(`/api/az/${siteId}/stats?days=${statsDays}`);
      const j = await r.json();
      if (!r.ok) {
        addToast({ title: "加载失败", description: j.error, color: "danger" });
        return;
      }
      setStats(j as StatsData);
      setStatsRefreshedAt(new Date());
    } finally {
      setStatsLoading(false);
    }
  }, [siteId, statsDays]);

  // Initial fetch + 3-min auto-poll. Also refetch when siteId / statsDays
  // change. Site change clears stale data first so the user doesn't see
  // numbers from the previous site flicker on the new one.
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
      addToast({ title: "已设为默认", color: "success" });
    }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 size={22} className="text-primary" /> az 管理
          </h1>
          <p className="text-sm text-default-500">
            sub2api 上的批量录入 / 改规则 / 清错 / 成本统计
          </p>
        </div>
      </div>

      {/* Site picker */}
      <Card className="bg-content1 border border-divider/50 shadow-none mb-4">
        <CardBody className="flex flex-row flex-wrap items-end gap-3">
          <Select
            label="目标站点（仅 sub2api）"
            placeholder="选择"
            className="max-w-md"
            selectedKeys={siteId ? new Set([String(siteId)]) : new Set()}
            onSelectionChange={(k) =>
              setSiteId(Number(Array.from(k)[0] ?? "") || null)
            }
            isDisabled={loading || sites.length === 0}
          >
            {sites.map((s) => (
              <SelectItem key={String(s.id)} textValue={s.name}>
                {s.name} {s.id === defaultSiteId ? "（默认）" : ""}
              </SelectItem>
            ))}
          </Select>
          {siteId != null && siteId !== defaultSiteId && (
            <Button
              variant="flat"
              startContent={<Pin size={14} />}
              onPress={setAsDefault}
            >
              设为默认
            </Button>
          )}
          <Button
            variant="flat"
            startContent={<SettingsIcon size={14} />}
            onPress={cfgDlg.onOpen}
            isDisabled={siteId == null}
          >
            规则配置
          </Button>
          {presetUpdatedAt && (
            <span className="text-xs text-default-400 self-center">
              规则更新于 {new Date(presetUpdatedAt).toLocaleString("zh-CN")}
            </span>
          )}
        </CardBody>
      </Card>

      {siteId == null ? (
        <Card>
          <CardBody className="text-default-500 text-sm">
            没有 sub2api 类型的本站账号。请先在「本站账号」页创建一个。
          </CardBody>
        </Card>
      ) : (
        <Card className="bg-content1 border border-divider/50 shadow-none">
          <CardBody>
            <Tabs aria-label="az tabs" variant="solid" radius="full"
                  classNames={{
                    tabList: "bg-content2 p-1",
                    cursor: "bg-content1 shadow-sm",
                    tab: "px-4 h-9 data-[selected=true]:text-foreground text-default-500",
                  }}>
              <Tab key="accounts" title="导入账号">
                <ImportAccountsTab siteId={siteId} config={config} />
              </Tab>
              <Tab key="proxies" title="导入代理">
                <ImportProxiesTab siteId={siteId} config={config} />
              </Tab>
              <Tab key="rules" title="批量改规则">
                <BulkUpdateTab
                  siteId={siteId}
                  config={config}
                  accounts={azAccounts}
                  loading={accountsLoading}
                  refreshedAt={accountsRefreshedAt}
                  reload={loadAccounts}
                />
              </Tab>
              <Tab key="cleanup" title="清错">
                <CleanupTab
                  siteId={siteId}
                  allAccounts={azAccounts}
                  loading={accountsLoading}
                  refreshedAt={accountsRefreshedAt}
                  reload={loadAccounts}
                />
              </Tab>
              <Tab key="stats" title="成本统计">
                <StatsTab
                  data={stats}
                  loading={statsLoading}
                  refreshedAt={statsRefreshedAt}
                  days={statsDays}
                  setDays={setStatsDays}
                  reload={loadStats}
                />
              </Tab>
            </Tabs>
          </CardBody>
        </Card>
      )}

      <ConfigModal
        isOpen={cfgDlg.isOpen}
        onClose={cfgDlg.onClose}
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
    // Load proxies when share-proxy is toggled OR alias mode requires it.
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
        addToast({ title: "解析失败", description: j.error, color: "danger" });
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
      // alias mode forces shareProxy: user must pick a single proxy.
      const effectiveShareProxy = shareProxy || aliasMode;
      const singleProxyId =
        effectiveShareProxy && sharedProxyId ? Number(sharedProxyId) : null;
      if (effectiveShareProxy && !singleProxyId) {
        addToast({
          title: aliasMode ? "别称模式下必须指定共用代理" : "请选择共用代理",
          color: "warning",
        });
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
        addToast({ title: "提交失败", description: j.error, color: "danger" });
        return;
      }
      setResults(j.rows);
      addToast({
        title: `录入完成 ${j.ok}/${j.total}`,
        description: j.failed
          ? `${j.failed} 条失败`
          : "全部成功",
        color: j.failed ? "warning" : "success",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <Textarea
        label="粘贴账号列表"
        description="每行一对，base_url 一行 + api_key 一行；或 CSV: base_url,api_key"
        placeholder={`https://xxx.services.ai.azure.com/anthropic
sk-xxxx
https://yyy.services.ai.azure.com/anthropic
sk-yyyy`}
        value={text}
        onValueChange={setText}
        minRows={6}
      />
      <div className="flex gap-2 items-end flex-wrap">
        <Input
          type="number"
          size="sm"
          label="单价成本 (USD)"
          description="每个账号的固定成本，写入本站记账，参与利润计算"
          value={costText}
          onValueChange={setCostText}
          className="w-[200px]"
          min={0}
        />
        <Input
          size="sm"
          label="账号别称（可选）"
          description={
            aliasMode
              ? `账号将命名为 ${config.account_prefix}${alias.trim()}-N · 该模式自动关闭代理自动配对，必须手动指定一个共用代理`
              : `留空则用默认前缀 ${config.account_prefix}N；填写后命名为 ${config.account_prefix}{别称}-N`
          }
          placeholder="例如 o总"
          value={alias}
          onValueChange={setAlias}
          className="w-[220px]"
        />
        <Button color="primary" onPress={parse} isLoading={parsing} isDisabled={!text.trim()}>
          解析 + 预览
        </Button>
        <span className="text-xs text-default-500 self-center">
          应用规则：分组 [{config.group_ids.join(",") || "未配置"}] · 并发{" "}
          {config.concurrency} · 倍率 ×{config.rate_multiplier} ·{" "}
          {aliasMode
            ? "（别称模式 · 共用代理）"
            : config.auto_bind_proxy
              ? "自动绑定代理"
              : "不绑代理"}
        </span>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <Checkbox
          size="sm"
          isSelected={shareProxy || aliasMode}
          isDisabled={aliasMode}
          onValueChange={(v) => {
            setShareProxy(v);
            if (!v) setSharedProxyId("");
          }}
        >
          <span className="text-xs">
            本批共用同一个代理{aliasMode && "（别称模式下强制开启）"}
          </span>
        </Checkbox>
        {(shareProxy || aliasMode) && (
          <Select
            size="sm"
            label="代理"
            placeholder={proxies === null ? "加载中…" : "选择共用代理"}
            isDisabled={proxies === null || proxies.length === 0}
            selectedKeys={sharedProxyId ? new Set([sharedProxyId]) : new Set()}
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0] ?? "";
              setSharedProxyId(v);
            }}
            className="w-[260px]"
          >
            {(proxies ?? []).map((p) => (
              <SelectItem key={String(p.id)}>{`${p.name} (#${p.id})`}</SelectItem>
            ))}
          </Select>
        )}
        {(shareProxy || aliasMode) && (
          <span className="text-xs text-default-500 self-center">
            整批账号都绑这一个代理（自动配对被禁用）
          </span>
        )}
      </div>

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-default-500">
            <Chip size="sm" variant="flat">
              将创建 {preview.rows.length} 个，从{" "}
              {config.account_prefix}
              {preview.nextSequenceStart} 起
            </Chip>
            <Chip size="sm" variant="flat">
              已存在 {preview.existingAccountCount}
            </Chip>
            {config.auto_bind_proxy && (
              <Chip size="sm" variant="flat">
                可绑代理 {preview.unboundProxyCount}
              </Chip>
            )}
            <Button
              size="sm"
              color="success"
              variant="flat"
              onPress={submit}
              isLoading={submitting}
              isDisabled={preview.rows.length === 0}
            >
              提交录入
            </Button>
          </div>
          <Table removeWrapper aria-label="preview" classNames={{ td: "py-2" }}>
            <TableHeader>
              <TableColumn>序号</TableColumn>
              <TableColumn>名称</TableColumn>
              <TableColumn>base_url</TableColumn>
              <TableColumn>api_key</TableColumn>
              <TableColumn>代理</TableColumn>
              <TableColumn>提示</TableColumn>
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
                                  ? "text-success font-medium"
                                  : "text-warning font-medium"
                              }
                            >
                              {r.proxyName}
                            </span>
                            <span className="text-xs text-default-400">
                              #{r.proxyId}
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-default-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-warning">
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
        addToast({ title: "解析失败", description: j.error, color: "danger" });
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
        addToast({ title: "提交失败", description: j.error, color: "danger" });
        return;
      }
      setResults(j.rows);
      addToast({
        title: `录入完成 ${j.ok}/${j.total}`,
        color: j.failed ? "warning" : "success",
      });
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
      <Textarea
        label="粘贴代理列表"
        description="每行一条 host:port:user:pass 或 host,port,user,pass"
        placeholder={`1.2.3.4:1080:alice:pwd
5.6.7.8,1080,bob,pwd`}
        value={text}
        onValueChange={setText}
        minRows={6}
      />
      <div className="flex gap-2 items-center flex-wrap">
        <Button color="primary" onPress={parse} isLoading={parsing} isDisabled={!text.trim()}>
          解析 + 预览
        </Button>
        <span className="text-xs text-default-500">
          协议：{config.proxy_protocol}
        </span>
      </div>

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-default-500">
            <Chip size="sm" variant="flat">
              将创建 {willCreate} 个，从 {config.proxy_prefix}
              {preview.nextSequenceStart} 起
            </Chip>
            <Chip size="sm" variant="flat">
              已存在 {preview.existingProxyCount}
            </Chip>
            <Button
              size="sm"
              color="success"
              variant="flat"
              onPress={submit}
              isLoading={submitting}
              isDisabled={willCreate === 0}
            >
              提交录入
            </Button>
          </div>
          <Table removeWrapper aria-label="proxy preview" classNames={{ td: "py-2" }}>
            <TableHeader>
              <TableColumn>序号</TableColumn>
              <TableColumn>名称</TableColumn>
              <TableColumn>host:port</TableColumn>
              <TableColumn>认证</TableColumn>
              <TableColumn>状态</TableColumn>
            </TableHeader>
            <TableBody>
              {preview.rows.map((r) => (
                <TableRow key={r.index}>
                  <TableCell>{r.index}</TableCell>
                  <TableCell className="font-medium">
                    {r.skip ? (
                      <span className="text-default-400 line-through">
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
                      <span className="text-default-400">跳过</span>
                    ) : r.warnings.length ? (
                      <span className="text-warning">{r.warnings.join("；")}</span>
                    ) : (
                      <span className="text-success">新增</span>
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
    <div className="border border-divider/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Chip size="sm" color="success" variant="flat">
          成功 {ok}
        </Chip>
        {failed > 0 && (
          <Chip size="sm" color="danger" variant="flat">
            失败 {failed}
          </Chip>
        )}
      </div>
      {failed > 0 && (
        <Table removeWrapper aria-label="result errors" classNames={{ td: "py-1.5" }}>
          <TableHeader>
            <TableColumn>名称</TableColumn>
            <TableColumn>错误</TableColumn>
          </TableHeader>
          <TableBody>
            {results
              .filter((r) => !r.ok)
              .map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-xs text-danger">
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
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
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

  // Hold whitelist as raw text — parsing on every keystroke would eat
  // trailing newlines and partial lines, blocking input. We sync from the
  // config object only on modal open, then parse back on save.
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
      // Strip optional "= ..." (legacy mapping format) — keep the key only.
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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      onSaved(j.config, j.updatedAt);
      addToast({ title: "已保存", color: "success" });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>az 规则配置</ModalHeader>
        <ModalBody className="gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              type="number"
              label="并发"
              value={String(c.concurrency)}
              onValueChange={(v) => update("concurrency", Number(v) || 0)}
            />
            <Input
              type="number"
              label="优先级"
              value={String(c.priority)}
              onValueChange={(v) => update("priority", Number(v) || 0)}
            />
            <Input
              type="number"
              step="0.01"
              label="计费倍率"
              value={String(c.rate_multiplier)}
              onValueChange={(v) =>
                update("rate_multiplier", Number(v) || 1)
              }
            />
          </div>
          <Input
            label="所属分组 group_ids"
            description="逗号分隔，例 4,2,5,7。顺序决定 group-priority"
            value={c.group_ids.join(",")}
            onValueChange={(v) =>
              update(
                "group_ids",
                v
                  .split(/[,，]+/)
                  .map((x) => Number(x.trim()))
                  .filter((x) => Number.isFinite(x) && x > 0),
              )
            }
          />
          <Switch
            isSelected={c.confirm_mixed_channel_risk}
            onValueChange={(v) => update("confirm_mixed_channel_risk", v)}
          >
            confirm_mixed_channel_risk（账号在多组时需要 true）
          </Switch>
          <Textarea
            label="模型白名单"
            description="每行一个模型名。只有列在这里的模型才能通过；留空 = 允许所有模型透传"
            placeholder={`claude-opus-4-7
claude-sonnet-4-6
claude-haiku-4-5-20251001`}
            minRows={5}
            value={whitelistText}
            onValueChange={setWhitelistText}
          />
          <hr className="border-divider/50 my-2" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="账号命名前缀"
              value={c.account_prefix}
              onValueChange={(v) => update("account_prefix", v)}
            />
            <Input
              type="number"
              label="账号起始编号"
              value={String(c.account_start_index)}
              onValueChange={(v) =>
                update("account_start_index", Number(v) || 1)
              }
            />
            <Input
              label="代理命名前缀"
              value={c.proxy_prefix}
              onValueChange={(v) => update("proxy_prefix", v)}
            />
            <Input
              type="number"
              label="代理起始编号"
              value={String(c.proxy_start_index)}
              onValueChange={(v) =>
                update("proxy_start_index", Number(v) || 1)
              }
            />
            <Select
              label="代理协议"
              selectedKeys={new Set([c.proxy_protocol])}
              onSelectionChange={(k) =>
                update("proxy_protocol", String(Array.from(k)[0] ?? "socks5"))
              }
            >
              <SelectItem key="socks5">socks5</SelectItem>
              <SelectItem key="socks5h">socks5h</SelectItem>
              <SelectItem key="http">http</SelectItem>
              <SelectItem key="https">https</SelectItem>
            </Select>
            <div className="flex items-end">
              <Switch
                isSelected={c.auto_bind_proxy}
                onValueChange={(v) => update("auto_bind_proxy", v)}
              >
                录入账号时自动绑定空闲代理
              </Switch>
            </div>
          </div>

          <div className="flex flex-col gap-2 p-3 rounded-lg bg-content2/40">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">临时不可调度规则</span>
              <Switch
                size="sm"
                isSelected={c.temp_unschedulable_enabled !== false}
                onValueChange={(v) => update("temp_unschedulable_enabled", v)}
              />
            </div>
            <p className="text-xs text-default-500">
              命中错误码 + 关键词时，临时停用该渠道指定分钟数；过后自动恢复
            </p>
            <div className="flex flex-col gap-2">
              {(c.temp_unschedulable_rules ?? []).map((rule, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-1 items-end"
                >
                  <Input
                    size="sm"
                    type="number"
                    label="错误码"
                    className="col-span-2"
                    value={String(rule.error_code)}
                    onValueChange={(v) => {
                      const next = [...(c.temp_unschedulable_rules ?? [])];
                      next[idx] = {
                        ...rule,
                        error_code: Math.max(0, Math.floor(Number(v) || 0)),
                      };
                      update("temp_unschedulable_rules", next);
                    }}
                  />
                  <Input
                    size="sm"
                    label="关键词（逗号分隔）"
                    className="col-span-5"
                    value={rule.keywords.join(", ")}
                    onValueChange={(v) => {
                      const next = [...(c.temp_unschedulable_rules ?? [])];
                      next[idx] = {
                        ...rule,
                        keywords: v
                          .split(/,\s*/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      };
                      update("temp_unschedulable_rules", next);
                    }}
                  />
                  <Input
                    size="sm"
                    type="number"
                    label="时长（分钟）"
                    className="col-span-2"
                    value={String(rule.duration_minutes)}
                    onValueChange={(v) => {
                      const next = [...(c.temp_unschedulable_rules ?? [])];
                      next[idx] = {
                        ...rule,
                        duration_minutes: Math.max(
                          1,
                          Math.floor(Number(v) || 1),
                        ),
                      };
                      update("temp_unschedulable_rules", next);
                    }}
                  />
                  <Input
                    size="sm"
                    label="说明"
                    className="col-span-2"
                    value={rule.description ?? ""}
                    onValueChange={(v) => {
                      const next = [...(c.temp_unschedulable_rules ?? [])];
                      next[idx] = { ...rule, description: v };
                      update("temp_unschedulable_rules", next);
                    }}
                  />
                  <Button
                    size="sm"
                    isIconOnly
                    color="danger"
                    variant="light"
                    className="col-span-1"
                    onPress={() => {
                      const next = (c.temp_unschedulable_rules ?? []).filter(
                        (_, i) => i !== idx,
                      );
                      update("temp_unschedulable_rules", next);
                    }}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="flat"
                onPress={() => {
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
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={save} isLoading={saving}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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

  // Bulk apply only operates on healthy (status=active) channels — never
  // touch the broken ones. Hidden / non-active accounts can be unblocked
  // from sub2api admin first; they reappear here once back to active.
  const visibleAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.status === "active"),
    [accounts],
  );
  const hiddenCount = (accounts?.length ?? 0) - visibleAccounts.length;

  // When the visible list arrives (or changes), default-select everything
  // IF the list is freshly empty.
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
      addToast({ title: "请至少选一个账号", color: "warning" });
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
        addToast({ title: "提交失败", description: j.error, color: "danger" });
        return;
      }
      const desc = j.ok
        ? `已更新 ${j.targetCount} 个${j.includedWhitelist ? "（含白名单）" : ""}`
        : `失败：${j.error ?? "未知错误"}`;
      addToast({
        title: j.ok ? "批量更新完成" : "批量更新失败",
        description: desc,
        color: j.ok ? "success" : "danger",
      });
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="flat" onPress={reload} isLoading={loading}>
          刷新列表
        </Button>
        {refreshedAt && (
          <span className="text-xs text-default-400">
            上次刷新 {refreshedAt.toLocaleTimeString("zh-CN")}（每 3 分钟自动）
          </span>
        )}
        <span className="text-xs text-default-500">
          已选 {selected.size} / {visibleAccounts.length}（仅显示 status=active
          {hiddenCount > 0 ? `，已隐藏 ${hiddenCount} 个非活跃` : ""}） ·{" "}
          规则：并发 {config.concurrency} · 优先级 {config.priority} · 倍率 ×
          {config.rate_multiplier} · 分组 [{config.group_ids.join(",") || "—"}]
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            size="sm"
            isSelected={updateMapping}
            onValueChange={setUpdateMapping}
          >
            同时更新模型白名单
          </Switch>
          <Button
            size="sm"
            color="primary"
            onPress={submit}
            isLoading={submitting}
            isDisabled={selected.size === 0}
          >
            应用规则
          </Button>
        </div>
      </div>
      {loading ? (
        <Spinner size="sm" />
      ) : visibleAccounts.length === 0 ? (
        <p className="text-default-500 text-sm">
          {(accounts?.length ?? 0) === 0
            ? "没有匹配 az-N 命名的账号"
            : `共 ${accounts?.length ?? 0} 个 az 账号，但当前都不是 active 状态`}
        </p>
      ) : (
        <Table removeWrapper aria-label="bulk-update" classNames={{ td: "py-2" }}>
          <TableHeader>
            <TableColumn>
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
            </TableColumn>
            <TableColumn>名称</TableColumn>
            <TableColumn>状态</TableColumn>
            <TableColumn>并发</TableColumn>
            <TableColumn>优先级</TableColumn>
            <TableColumn>倍率</TableColumn>
            <TableColumn>分组</TableColumn>
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
                  <Chip size="sm" variant="flat" color="success">
                    {a.status}
                  </Chip>
                </TableCell>
                <TableCell>{a.concurrency}</TableCell>
                <TableCell>{a.priority}</TableCell>
                <TableCell>×{a.rate_multiplier}</TableCell>
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
  // Derive error subset from the shared accounts list — no extra fetch.
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
        addToast({ title: "失败", description: j.error, color: "danger" });
        return;
      }
      addToast({
        title: `${verb}完成 ${j.ok}/${j.total}`,
        description: j.failed ? `${j.failed} 个失败` : "全部成功",
        color: j.failed ? "warning" : "success",
      });
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="flat" onPress={reload} isLoading={loading}>
          刷新
        </Button>
        {refreshedAt && (
          <span className="text-xs text-default-400">
            上次刷新 {refreshedAt.toLocaleTimeString("zh-CN")}
          </span>
        )}
        <span className="text-xs text-default-500">
          错误账号 {accounts?.length ?? 0} 个
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            color="warning"
            variant="flat"
            onPress={() => run("clear")}
            isLoading={busy}
            isDisabled={!accounts || accounts.length === 0}
          >
            清错状态（不删）
          </Button>
          <Button
            size="sm"
            color="danger"
            variant="flat"
            onPress={() => run("delete")}
            isLoading={busy}
            isDisabled={!accounts || accounts.length === 0}
          >
            全部删除
          </Button>
        </div>
      </div>
      {loading ? (
        <Spinner size="sm" />
      ) : !accounts || accounts.length === 0 ? (
        <p className="text-success text-sm">✓ 没有错误账号</p>
      ) : (
        <Table removeWrapper aria-label="cleanup" classNames={{ td: "py-2" }}>
          <TableHeader>
            <TableColumn>名称</TableColumn>
            <TableColumn>错误信息</TableColumn>
            <TableColumn>最后使用</TableColumn>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="text-xs text-danger break-all">
                  {a.error_message || "—"}
                </TableCell>
                <TableCell className="text-xs text-default-400">
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
        <span className="text-xs text-default-500">区间</span>
        {[1, 7, 30, 60, 90].map((d) => (
          <Chip
            key={d}
            size="sm"
            variant={days === d ? "solid" : "flat"}
            color={days === d ? "primary" : "default"}
            className="cursor-pointer"
            onClick={() => setDays(d)}
          >
            {d === 1 ? "今日" : `${d} 天`}
          </Chip>
        ))}
        <Button size="sm" variant="flat" onPress={reload} isLoading={loading}>
          刷新
        </Button>
        <Checkbox
          size="sm"
          isSelected={showErrors}
          onValueChange={setShowErrors}
        >
          <span className="text-xs">
            显示 error 账号
            {data && data.errorCount > 0 && (
              <span className="text-danger ml-1">({data.errorCount})</span>
            )}
          </span>
        </Checkbox>
        {refreshedAt && (
          <span className="text-xs text-default-400">
            上次 {refreshedAt.toLocaleTimeString("zh-CN")}（每 3 分钟自动）
          </span>
        )}
        {data && (
          <span className="text-xs text-default-400 ml-auto">
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
            label="1× 消费"
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
        <Spinner size="sm" />
      ) : !data || data.rows.length === 0 ? (
        <p className="text-default-500 text-sm">暂无数据</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-default-500 text-sm">
          全部 {data.rows.length} 个账号均为 error 状态。勾选「显示 error 账号」查看。
        </p>
      ) : (
        <Table removeWrapper aria-label="stats" classNames={{ td: "py-2" }}>
          <TableHeader>
            <TableColumn>名称</TableColumn>
            <TableColumn>状态</TableColumn>
            <TableColumn>成本</TableColumn>
            <TableColumn>1× 消费</TableColumn>
            <TableColumn>实际消费</TableColumn>
            <TableColumn>利润</TableColumn>
            <TableColumn>请求 / token</TableColumn>
            <TableColumn>最后使用</TableColumn>
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => {
              const profitTone =
                r.profit > 0
                  ? "text-success font-medium"
                  : r.profit < 0
                    ? "text-danger font-medium"
                    : "text-default-500";
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.error && (
                      <span
                        className="ml-1 text-xs text-danger"
                        title={r.error}
                      >
                        ⚠
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={
                        r.status === "active"
                          ? "success"
                          : r.status === "error"
                            ? "danger"
                            : "default"
                      }
                    >
                      {r.status}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span>${fmtMoneyShort(r.cost)}</span>
                      {r.fixedCost != null && (
                        <span className="text-xs text-default-400">固定</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-default-500">
                    ${fmtMoneyShort(r.costBase)}
                  </TableCell>
                  <TableCell>${fmtMoneyShort(r.actualCost)}</TableCell>
                  <TableCell className={profitTone}>
                    ${fmtMoneyShort(r.profit)}
                  </TableCell>
                  <TableCell className="text-xs text-default-500">
                    {r.requests} · {fmtTokens(r.tokens)}
                  </TableCell>
                  <TableCell className="text-xs text-default-400">
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
        ? "text-danger"
        : "text-foreground";
  return (
    <div className="rounded-lg bg-content2 p-3">
      <p className="text-xs text-default-500">{label}</p>
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
