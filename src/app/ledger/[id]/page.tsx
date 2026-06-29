"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import {
  ArrowLeft, Plus, Server, Building2, Trash2,
  TrendingDown, DollarSign, Users, Calendar, Pencil, Check, Loader2, X, Search,
} from "lucide-react";
import Link from "next/link";
import { fmtMoney, fmtMoneyShort, fmtDateShort } from "@/lib/format";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

/* ─────────── Types ─────────── */

interface KeyLinkInfo {
  id: number; multiplier: number;
  upstreamKey: { id: number; name: string; groupName: string; upstreamAccountId: number; upstreamAccount: { name: string } };
}
interface UserLinkInfo {
  id: number; multiplier: number;
  siteUser: { id: number; remoteUserId: number; email: string; username: string; alias: string | null; siteAccountId: number };
}
interface LedgerDetail {
  id: number; name: string; revenueMultiplier: number;
  upstreamLinks: { id: number; upstreamAccount: { id: number; name: string } }[];
  siteLinks: { id: number; siteAccount: { id: number; name: string } }[];
  keyLinks: KeyLinkInfo[];
  userLinks: UserLinkInfo[];
  categories: { id: number; name: string; fixedCosts: unknown[] }[];
  fixedCosts: { id: number; amount: number; note: string | null; startDate: string | null; endDate: string | null; createdAt: string; category: { id: number; name: string } }[];
}
interface UpKeyRow {
  keyId: number; name: string; todayActualCost: number;
  multiplier: number; cost: number; accountName: string; lastSyncAt: string | null;
}
interface SiteUserRow {
  userId: number; siteUserId: number; email: string; username: string; alias: string | null;
  todayCost: number; totalConsumed: number; totalRevenue: number;
  multiplier: number; revenue: number; accountName: string; lastSyncAt: string | null;
}
interface FixedIncomeRow {
  id: number; amount: number; note: string | null; createdAt: string;
}
interface Summary {
  today: { date: string; cost: number; revenue: number; profit: number };
  total: { cost: number; revenue: number; profit: number; fixedCost: number; fixedIncome: number };
  upstreamKeys: UpKeyRow[];
  siteUsers: SiteUserRow[];
  fixedCostDetails: { id: number; category: string; amount: number; note: string | null; createdAt: string }[];
  fixedIncomeDetails: FixedIncomeRow[];
  dailyData: { date: string; cost: number }[];
}
interface Option { id: number; name: string }
interface UpKeyOption { id: number; name: string; groupName: string }
interface SiteUserOption { id: number; remoteUserId: number; email: string; username: string; alias: string | null }

/* ─────────── SearchableList (替代 Autocomplete) ─────────── */

function SearchableList<T extends { id: number }>({
  placeholder, items, renderItem, filterFn, onSelect,
}: {
  placeholder: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  filterFn: (item: T, query: string) => boolean;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query ? items.filter((i) => filterFn(i, query.toLowerCase())) : items;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8 text-sm" />
      </div>
      {filtered.length > 0 && (
        <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {filtered.slice(0, 30).map((item) => (
            <button key={item.id} className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-sm"
              onClick={() => { onSelect(item.id); setQuery(""); }}>
              {renderItem(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Page ─────────── */

export default function LedgerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ledger, setLedger] = useState<LedgerDetail | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [upstreamOptions, setUpstreamOptions] = useState<Option[]>([]);
  const [siteOptions, setSiteOptions] = useState<Option[]>([]);
  const [activeTab, setActiveTab] = useState("overview");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [lr, sr] = await Promise.all([
        fetch(`/api/ledger/${id}`).then((r) => r.json()),
        fetch(`/api/ledger/${id}/summary`).then((r) => r.json()),
      ]);
      setLedger(lr); setSummary(sr);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 5 * 60 * 1000);
    Promise.all([
      fetch("/api/upstream?hidden=0").then((r) => r.json()),
      fetch("/api/site?hidden=0").then((r) => r.json()),
    ]).then(([up, site]) => {
      const upList = Array.isArray(up) ? up : up.items ?? [];
      const siteList = Array.isArray(site) ? site : site.items ?? [];
      setUpstreamOptions(upList.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name })));
      setSiteOptions(siteList.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })));
    });
    return () => clearInterval(timer);
  }, [loadAll]);

  if (loading || !ledger || !summary) return <Shell><div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin" /></div></Shell>;

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-6">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link href="/ledger"><ArrowLeft size={18} /></Link>
        </Button>
        <h1 className="text-xl font-bold">{ledger.name}</h1>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
        </TabsList>
      </Tabs>
      {activeTab === "overview" && (
        <OverviewTab ledger={ledger} summary={summary} upstreamOptions={upstreamOptions} siteOptions={siteOptions} onUpdate={loadAll} />
      )}
      {activeTab === "config" && (
        <ConfigTab ledger={ledger} upstreamOptions={upstreamOptions} siteOptions={siteOptions} onUpdate={loadAll} />
      )}
    </Shell>
  );
}

/* ─────────── StatCard ─────────── */

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: number; icon: React.ReactNode; color: string; sub?: string;
}) {
  return (
    <Card className="rounded-xl bg-card border border-border shadow-sm">
      <CardContent className="py-3.5 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground/70 font-medium">{label}</span>
          <span className="text-muted-foreground/40">{icon}</span>
        </div>
        <p className={`text-xl font-bold tracking-tight ${color}`}>{fmtMoneyShort(value)}</p>
        {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────── 行内倍率编辑 ─────────── */

function InlineMultiplier({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const v = Number(draft);
    if (!isNaN(v) && v > 0) { onSave(v); setEditing(false); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-center">
        <Input type="number" className="h-7 w-[70px] text-center text-sm" value={draft}
          onChange={(e) => setDraft(e.target.value)} step="0.1" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
        <Button size="icon" variant="secondary" className="h-7 w-7" onClick={commit}><Check size={12} /></Button>
      </div>
    );
  }
  return (
    <button className="flex items-center gap-1 justify-center w-full text-sm hover:text-blue-600 transition-colors"
      onClick={() => { setDraft(String(value)); setEditing(true); }}>
      ×{value}<Pencil size={11} className="text-muted-foreground/40" />
    </button>
  );
}

/* ═══════════ 概览 Tab ═══════════ */

function OverviewTab({ ledger, summary, upstreamOptions, siteOptions, onUpdate }: {
  ledger: LedgerDetail; summary: Summary; upstreamOptions: Option[]; siteOptions: Option[]; onUpdate: () => void;
}) {
  const [costOpen, setCostOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [costForm, setCostForm] = useState({ categoryId: "", amount: "", note: "" });
  const [incomeForm, setIncomeForm] = useState({ amount: "", note: "" });

  // ── Key 选择 ──
  const [pickUpId, setPickUpId] = useState<number | null>(null);
  const [keyOptions, setKeyOptions] = useState<UpKeyOption[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const linkedKeyIds = new Set(ledger.keyLinks.map((l) => l.upstreamKey.id));

  async function loadKeys(upId: number) {
    setPickUpId(upId);
    setLoadingKeys(true);
    try {
      const r = await fetch(`/api/upstream/${upId}`);
      const j = await r.json();
      setKeyOptions((j.item?.keys || []).map((k: { id: number; name: string; groupName: string }) => ({
        id: k.id, name: k.name, groupName: k.groupName,
      })));
    } finally { setLoadingKeys(false); }
  }

  async function addKey(keyId: number) {
    const newIds = [...linkedKeyIds, keyId];
    await fetch(`/api/ledger/${ledger.id}/keys`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upstreamKeyIds: [...newIds] }),
    });
    toast.success("已添加 Key");
    onUpdate();
  }

  async function removeKey(keyId: number) {
    const newIds = [...linkedKeyIds].filter((x) => x !== keyId);
    await fetch(`/api/ledger/${ledger.id}/keys`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upstreamKeyIds: newIds }),
    });
    onUpdate();
  }

  async function saveKeyMultiplier(keyId: number, multiplier: number) {
    await fetch(`/api/ledger/${ledger.id}/keys`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upstreamKeyId: keyId, multiplier }),
    });
    onUpdate();
  }

  // ── 用户选择 ──
  const [pickSiteId, setPickSiteId] = useState<number | null>(null);
  const [siteUserOptions, setSiteUserOptions] = useState<SiteUserOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const linkedUserIds = new Set(ledger.userLinks.map((l) => l.siteUser.id));

  async function loadSiteUsers(siteId: number) {
    setPickSiteId(siteId);
    setLoadingUsers(true);
    try {
      const r = await fetch(`/api/site/${siteId}/users`);
      const j = await r.json();
      setSiteUserOptions((j.items || []).map((u: SiteUserOption & { id: number }) => ({
        id: u.id, remoteUserId: u.remoteUserId, email: u.email, username: u.username, alias: u.alias,
      })));
    } finally { setLoadingUsers(false); }
  }

  async function addUser(siteUserId: number) {
    const newIds = [...linkedUserIds, siteUserId];
    await fetch(`/api/ledger/${ledger.id}/users`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUserIds: [...newIds] }),
    });
    toast.success("已添加用户");
    onUpdate();
  }

  async function removeUser(siteUserId: number) {
    const newIds = [...linkedUserIds].filter((x) => x !== siteUserId);
    await fetch(`/api/ledger/${ledger.id}/users`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUserIds: newIds }),
    });
    onUpdate();
  }

  async function saveUserMultiplier(siteUserId: number, multiplier: number) {
    await fetch(`/api/ledger/${ledger.id}/users`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUserId, multiplier }),
    });
    onUpdate();
  }

  // ── 自定义收入 ──
  async function addIncome() {
    const amount = Number(incomeForm.amount);
    if (isNaN(amount) || amount <= 0) return;
    await fetch(`/api/ledger/${ledger.id}/fixed-incomes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note: incomeForm.note || undefined }),
    });
    toast.success("已添加收入");
    setIncomeForm({ amount: "", note: "" });
    setIncomeOpen(false); onUpdate();
  }

  async function deleteIncome(incomeId: number) {
    await fetch(`/api/ledger/${ledger.id}/fixed-incomes/${incomeId}`, { method: "DELETE" });
    onUpdate();
  }

  // ── 固定成本 ──
  async function quickAddCost() {
    const catId = Number(costForm.categoryId);
    const amount = Number(costForm.amount);
    if (!catId || isNaN(amount) || amount <= 0) return;
    await fetch(`/api/ledger/${ledger.id}/fixed-costs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: catId, amount, note: costForm.note || undefined }),
    });
    toast.success("已添加成本");
    setCostForm({ categoryId: "", amount: "", note: "" });
    setCostOpen(false); onUpdate();
  }

  async function deleteCost(costId: number) {
    await fetch(`/api/ledger/${ledger.id}/fixed-costs/${costId}`, { method: "DELETE" });
    onUpdate();
  }

  const chartData = [...summary.dailyData].reverse().map((d) => ({
    date: d.date.slice(5), 成本: +d.cost.toFixed(2),
  }));

  const availableKeys = keyOptions.filter((k) => !linkedKeyIds.has(k.id));
  const availableSiteUsers = siteUserOptions.filter((u) => !linkedUserIds.has(u.id));

  return (
    <div className="space-y-6">
      {/* ── 3 卡片 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="今日利润" value={summary.today.profit} icon={<DollarSign size={15} />}
          color={summary.today.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
          sub={`成本 ¥${fmtMoneyShort(summary.today.cost)} · 收入 ¥${fmtMoneyShort(summary.today.revenue)}`} />
        <StatCard label="总利润" value={summary.total.profit} icon={<DollarSign size={15} />}
          color={summary.total.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
          sub={`收入 ¥${fmtMoneyShort(summary.total.revenue)}${summary.total.fixedIncome > 0 ? ` (含自定义 ¥${fmtMoneyShort(summary.total.fixedIncome)})` : ""}`} />
        <StatCard label="总成本" value={summary.total.cost} icon={<TrendingDown size={15} />} color="text-destructive"
          sub={summary.total.fixedCost > 0 ? `含自建 ¥${fmtMoneyShort(summary.total.fixedCost)}` : undefined} />
      </div>

      {/* ── 成本明细（Key 级） ── */}
      <Card className="rounded-xl border border-border/30">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <span className="text-sm font-semibold flex items-center gap-2"><Server size={14} className="text-destructive" /> 成本明细</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="rounded-lg"
              onClick={() => setCostOpen(true)} disabled={ledger.categories.length === 0}>
              <Plus size={14} /> 自建成本
            </Button>
            <Button size="sm" variant="secondary" className="rounded-lg text-amber-600 dark:text-amber-400"
              onClick={() => setKeyOpen(true)} disabled={ledger.upstreamLinks.length === 0}>
              <Plus size={14} /> 添加 Key
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {summary.upstreamKeys.length === 0 && summary.fixedCostDetails.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 py-4 text-center">
              {ledger.upstreamLinks.length === 0 ? "请先在配置中关联上游渠道" : "请添加要监控的 Key 或自建成本"}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] uppercase">类型</TableHead>
                  <TableHead className="text-[11px] uppercase">名称</TableHead>
                  <TableHead className="text-[11px] uppercase text-right">今日消费</TableHead>
                  <TableHead className="text-[11px] uppercase text-center w-[100px]">倍率</TableHead>
                  <TableHead className="text-[11px] uppercase text-right">成本</TableHead>
                  <TableHead className="text-[11px] uppercase">同步</TableHead>
                  <TableHead className="text-[11px] uppercase text-center w-[50px]">{""}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.upstreamKeys.map((k) => (
                  <TableRow key={`k-${k.keyId}`}>
                    <TableCell className="py-2"><Badge variant="warning" className="rounded-full">渠道</Badge></TableCell>
                    <TableCell className="py-2"><span className="text-sm">{k.accountName} / {k.name}</span></TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm">¥{fmtMoney(k.todayActualCost, 2)}</span></TableCell>
                    <TableCell className="py-2">
                      <InlineMultiplier value={k.multiplier} onSave={(v) => saveKeyMultiplier(k.keyId, v)} />
                    </TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm text-destructive font-medium">¥{fmtMoney(k.cost, 2)}</span></TableCell>
                    <TableCell className="py-2"><span className="text-xs text-muted-foreground/70">{k.lastSyncAt ? fmtDateShort(k.lastSyncAt) : "-"}</span></TableCell>
                    <TableCell className="py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeKey(k.keyId)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
                {summary.fixedCostDetails.map((fc) => (
                  <TableRow key={`fc-${fc.id}`}>
                    <TableCell className="py-2"><Badge variant="secondary" className="rounded-full">{fc.category}</Badge></TableCell>
                    <TableCell className="py-2"><span className="text-sm">{fc.note || "固定成本"}</span></TableCell>
                    <TableCell className="py-2">{""}</TableCell>
                    <TableCell className="py-2">{""}</TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm text-destructive font-medium">¥{fmtMoney(fc.amount, 2)}</span></TableCell>
                    <TableCell className="py-2"><span className="text-xs text-muted-foreground/70">{fmtDateShort(fc.createdAt)}</span></TableCell>
                    <TableCell className="py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteCost(fc.id)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── 收入明细（用户级 + 自定义收入） ── */}
      <Card className="rounded-xl border border-border/30">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <span className="text-sm font-semibold flex items-center gap-2"><Users size={14} className="text-emerald-600 dark:text-emerald-400" /> 收入明细</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="rounded-lg"
              onClick={() => setIncomeOpen(true)}>
              <Plus size={14} /> 自定义收入
            </Button>
            <Button size="sm" variant="secondary" className="rounded-lg text-emerald-600 dark:text-emerald-400"
              onClick={() => setUserOpen(true)} disabled={ledger.siteLinks.length === 0}>
              <Plus size={14} /> 添加用户
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {summary.siteUsers.length === 0 && summary.fixedIncomeDetails.length === 0 && ledger.userLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 py-4 text-center">
              {ledger.siteLinks.length === 0 ? "请先在配置中关联本站账号，或添加自定义收入" : "请添加要监控的用户或自定义收入"}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] uppercase">类型</TableHead>
                  <TableHead className="text-[11px] uppercase">名称</TableHead>
                  <TableHead className="text-[11px] uppercase text-center w-[100px]">倍率</TableHead>
                  <TableHead className="text-[11px] uppercase text-right">今日收入</TableHead>
                  <TableHead className="text-[11px] uppercase text-right">总收入</TableHead>
                  <TableHead className="text-[11px] uppercase">时间</TableHead>
                  <TableHead className="text-[11px] uppercase text-center w-[50px]">{""}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.siteUsers.map((u) => (
                  <TableRow key={`u-${u.siteUserId}`}>
                    <TableCell className="py-2"><Badge variant="default" className="rounded-full">用户</Badge></TableCell>
                    <TableCell className="py-2">
                      <span className="text-sm">{u.alias || u.username || u.email}</span>
                      <span className="text-xs text-muted-foreground/70 ml-1.5">{u.accountName}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <InlineMultiplier value={u.multiplier} onSave={(v) => saveUserMultiplier(u.siteUserId, v)} />
                    </TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">¥{fmtMoney(u.revenue, 2)}</span></TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">¥{fmtMoney(u.totalRevenue, 2)}</span></TableCell>
                    <TableCell className="py-2"><span className="text-xs text-muted-foreground/70">{u.lastSyncAt ? fmtDateShort(u.lastSyncAt) : "-"}</span></TableCell>
                    <TableCell className="py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeUser(u.siteUserId)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
                {summary.fixedIncomeDetails.map((fi) => (
                  <TableRow key={`fi-${fi.id}`}>
                    <TableCell className="py-2"><Badge variant="secondary" className="rounded-full">自定义</Badge></TableCell>
                    <TableCell className="py-2"><span className="text-sm">{fi.note || "自定义收入"}</span></TableCell>
                    <TableCell className="py-2">{""}</TableCell>
                    <TableCell className="py-2">{""}</TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">¥{fmtMoney(fi.amount, 2)}</span></TableCell>
                    <TableCell className="py-2"><span className="text-xs text-muted-foreground/70">{fmtDateShort(fi.createdAt)}</span></TableCell>
                    <TableCell className="py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteIncome(fi.id)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── 成本趋势 ── */}
      {chartData.length > 1 && (
        <Card className="rounded-xl border border-border/30">
          <CardHeader className="pb-0">
            <span className="text-sm font-semibold flex items-center gap-2"><Calendar size={14} className="text-blue-600" /> 成本趋势</span>
          </CardHeader>
          <CardContent className="pt-2">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Line type="monotone" dataKey="成本" stroke="#f5a524" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── 添加自建成本 Dialog ── */}
      <Dialog open={costOpen} onOpenChange={setCostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自建成本</DialogTitle>
            <DialogDescription className="sr-only">添加一项自建成本</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>分类</Label>
              <Select value={costForm.categoryId} onValueChange={(v) => setCostForm((f) => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  {ledger.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>金额 (¥)</Label>
              <Input type="number" placeholder="0.00" value={costForm.amount}
                onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input placeholder="可选" value={costForm.note}
                onChange={(e) => setCostForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCostOpen(false)}>取消</Button>
            <Button onClick={quickAddCost} disabled={!costForm.categoryId || !costForm.amount}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 添加 Key Dialog：先选渠道再搜索 Key ── */}
      <Dialog open={keyOpen} onOpenChange={(v) => { if (!v) { setPickUpId(null); setKeyOptions([]); } setKeyOpen(v); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加监控 Key</DialogTitle>
            <DialogDescription className="sr-only">选择渠道并添加 Key</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择渠道</Label>
              <Select value={pickUpId ? String(pickUpId) : ""} onValueChange={(v) => { const n = Number(v); if (n) loadKeys(n); }}>
                <SelectTrigger><SelectValue placeholder="选择渠道" /></SelectTrigger>
                <SelectContent>
                  {ledger.upstreamLinks.map((l) => <SelectItem key={l.upstreamAccount.id} value={String(l.upstreamAccount.id)}>{l.upstreamAccount.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {pickUpId && (
              loadingKeys ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
              : availableKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground/70 text-center py-2">
                  {keyOptions.length === 0 ? "该渠道暂无 Key，请先同步" : "所有 Key 已添加"}
                </p>
              ) : (
                <SearchableList
                  placeholder="输入 Key 名称"
                  items={availableKeys}
                  filterFn={(k, q) => k.name.toLowerCase().includes(q) || k.groupName.toLowerCase().includes(q)}
                  renderItem={(k) => (
                    <div className="flex flex-col">
                      <span className="text-sm">{k.name}</span>
                      <span className="text-xs text-muted-foreground/70">{k.groupName}</span>
                    </div>
                  )}
                  onSelect={(id) => addKey(id)}
                />
              )
            )}
            {ledger.keyLinks.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground/70 mb-2">已添加 {ledger.keyLinks.length} 个 Key</p>
                <div className="flex flex-wrap gap-1.5">
                  {ledger.keyLinks.map((l) => (
                    <Badge key={l.id} variant="secondary" className="rounded-full gap-1 pr-1">
                      {l.upstreamKey.upstreamAccount.name} / {l.upstreamKey.name}
                      <button onClick={() => removeKey(l.upstreamKey.id)} className="ml-1 hover:text-destructive transition-colors">
                        <X size={12} />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setKeyOpen(false); setPickUpId(null); setKeyOptions([]); }}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 添加自定义收入 Dialog ── */}
      <Dialog open={incomeOpen} onOpenChange={setIncomeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义收入</DialogTitle>
            <DialogDescription className="sr-only">添加一笔自定义收入</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>金额 (¥)</Label>
              <Input type="number" placeholder="0.00" value={incomeForm.amount}
                onChange={(e) => setIncomeForm((f) => ({ ...f, amount: e.target.value }))} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input placeholder="如：XX渠道收入、退款等" value={incomeForm.note}
                onChange={(e) => setIncomeForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIncomeOpen(false)}>取消</Button>
            <Button onClick={addIncome} disabled={!incomeForm.amount}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 添加用户 Dialog ── */}
      <Dialog open={userOpen} onOpenChange={(v) => { if (!v) { setPickSiteId(null); setSiteUserOptions([]); } setUserOpen(v); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加监控用户</DialogTitle>
            <DialogDescription className="sr-only">选择站点并添加用户</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择站点</Label>
              <Select value={pickSiteId ? String(pickSiteId) : ""} onValueChange={(v) => { const n = Number(v); if (n) loadSiteUsers(n); }}>
                <SelectTrigger><SelectValue placeholder="选择站点" /></SelectTrigger>
                <SelectContent>
                  {ledger.siteLinks.map((l) => <SelectItem key={l.siteAccount.id} value={String(l.siteAccount.id)}>{l.siteAccount.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {pickSiteId && (
              loadingUsers ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
              : availableSiteUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground/70 text-center py-2">
                  {siteUserOptions.length === 0 ? "该站点暂无用户，请先同步" : "所有用户已添加"}
                </p>
              ) : (
                <SearchableList
                  placeholder="输入邮箱或用户名"
                  items={availableSiteUsers}
                  filterFn={(u, q) =>
                    (u.alias || "").toLowerCase().includes(q) ||
                    u.username.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q)
                  }
                  renderItem={(u) => (
                    <div className="flex flex-col">
                      <span className="text-sm">{u.alias || u.username || u.email}</span>
                      {u.username && u.username !== u.email && <span className="text-xs text-muted-foreground/70">{u.email}</span>}
                    </div>
                  )}
                  onSelect={(id) => addUser(id)}
                />
              )
            )}
            {ledger.userLinks.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground/70 mb-2">已添加 {ledger.userLinks.length} 个用户</p>
                <div className="flex flex-wrap gap-1.5">
                  {ledger.userLinks.map((l) => (
                    <Badge key={l.id} variant="secondary" className="rounded-full gap-1 pr-1">
                      {l.siteUser.alias || l.siteUser.username || l.siteUser.email}
                      <button onClick={() => removeUser(l.siteUser.id)} className="ml-1 hover:text-destructive transition-colors">
                        <X size={12} />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setUserOpen(false); setPickSiteId(null); setSiteUserOptions([]); }}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════ 配置 Tab ═══════════ */

function ConfigTab({ ledger, upstreamOptions, siteOptions, onUpdate }: {
  ledger: LedgerDetail; upstreamOptions: Option[]; siteOptions: Option[]; onUpdate: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [costForm, setCostForm] = useState({ categoryId: "", amount: "", note: "" });

  const linkedUpIds = new Set(ledger.upstreamLinks.map((l) => l.upstreamAccount.id));
  const linkedSiteIds = new Set(ledger.siteLinks.map((l) => l.siteAccount.id));
  const availableUp = upstreamOptions.filter((o) => !linkedUpIds.has(o.id));
  const availableSite = siteOptions.filter((o) => !linkedSiteIds.has(o.id));

  async function updateLinks(field: "upstreamAccountIds" | "siteAccountIds", ids: number[]) {
    setSaving(true);
    try {
      await fetch(`/api/ledger/${ledger.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: ids }),
      });
      onUpdate();
    } finally { setSaving(false); }
  }

  async function addCategory() {
    if (!catName.trim()) return;
    const r = await fetch(`/api/ledger/${ledger.id}/categories`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: catName.trim() }),
    });
    if (!r.ok) { toast.warning("分类已存在"); return; }
    setCatName(""); setCatOpen(false); onUpdate();
  }

  async function deleteCategory(catId: number) {
    if (!confirm("删除此分类？")) return;
    await fetch(`/api/ledger/${ledger.id}/categories/${catId}`, { method: "DELETE" });
    onUpdate();
  }

  async function addFixedCost() {
    const catId = Number(costForm.categoryId);
    const amount = Number(costForm.amount);
    if (!catId || isNaN(amount)) return;
    await fetch(`/api/ledger/${ledger.id}/fixed-costs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: catId, amount, note: costForm.note || undefined }),
    });
    setCostForm({ categoryId: "", amount: "", note: "" }); setCostOpen(false); onUpdate();
  }

  async function deleteFixedCost(costId: number) {
    await fetch(`/api/ledger/${ledger.id}/fixed-costs/${costId}`, { method: "DELETE" });
    onUpdate();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-xl border border-border/30">
          <CardHeader><span className="text-sm font-semibold flex items-center gap-2"><Server size={16} /> 关联上游渠道</span></CardHeader>
          <CardContent className="pt-0 space-y-3">
            {ledger.upstreamLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                <span className="text-sm">{l.upstreamAccount.name}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={saving}
                  onClick={() => updateLinks("upstreamAccountIds", [...linkedUpIds].filter((x) => x !== l.upstreamAccount.id))}><Trash2 size={14} /></Button>
              </div>
            ))}
            {availableUp.length > 0 && (
              <SearchableList
                placeholder="搜索并添加渠道"
                items={availableUp}
                filterFn={(o, q) => o.name.toLowerCase().includes(q)}
                renderItem={(o) => <span>{o.name}</span>}
                onSelect={(id) => updateLinks("upstreamAccountIds", [...linkedUpIds, id])}
              />
            )}
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/30">
          <CardHeader><span className="text-sm font-semibold flex items-center gap-2"><Building2 size={16} /> 关联本站账号</span></CardHeader>
          <CardContent className="pt-0 space-y-3">
            {ledger.siteLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                <span className="text-sm">{l.siteAccount.name}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={saving}
                  onClick={() => updateLinks("siteAccountIds", [...linkedSiteIds].filter((x) => x !== l.siteAccount.id))}><Trash2 size={14} /></Button>
              </div>
            ))}
            {availableSite.length > 0 && (
              <SearchableList
                placeholder="搜索并添加站点"
                items={availableSite}
                filterFn={(o, q) => o.name.toLowerCase().includes(q)}
                renderItem={(o) => <span>{o.name}</span>}
                onSelect={(id) => updateLinks("siteAccountIds", [...linkedSiteIds, id])}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl border border-border/30">
        <CardHeader className="flex flex-row items-center justify-between">
          <span className="text-sm font-semibold">自建成本分类</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => setCatOpen(true)}>
              <Plus size={14} /> 添加分类
            </Button>
            <Button size="sm" variant="secondary" className="rounded-lg"
              onClick={() => setCostOpen(true)} disabled={ledger.categories.length === 0}>
              <Plus size={14} /> 添加成本
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {ledger.categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ledger.categories.map((c) => (
                <Badge key={c.id} variant="secondary" className="rounded-full gap-1 pr-1">
                  {c.name}
                  <button onClick={() => deleteCategory(c.id)} className="ml-1 hover:text-destructive transition-colors">
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {ledger.categories.length === 0 && <p className="text-sm text-muted-foreground/70">请先添加分类（如：邮箱、IP、服务器）</p>}
          {ledger.fixedCosts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] uppercase">分类</TableHead>
                  <TableHead className="text-[11px] uppercase">备注</TableHead>
                  <TableHead className="text-[11px] uppercase text-right">金额</TableHead>
                  <TableHead className="text-[11px] uppercase">创建时间</TableHead>
                  <TableHead className="text-[11px] uppercase text-center w-[50px]">{""}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.fixedCosts.map((fc) => (
                  <TableRow key={fc.id}>
                    <TableCell className="py-2"><Badge variant="default" className="rounded-full">{fc.category.name}</Badge></TableCell>
                    <TableCell className="py-2"><span className="text-sm">{fc.note || "-"}</span></TableCell>
                    <TableCell className="py-2 text-right"><span className="text-sm font-medium">¥{fmtMoney(fc.amount, 2)}</span></TableCell>
                    <TableCell className="py-2"><span className="text-xs text-muted-foreground/70">{fmtDateShort(fc.createdAt)}</span></TableCell>
                    <TableCell className="py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteFixedCost(fc.id)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加成本分类</DialogTitle>
            <DialogDescription className="sr-only">添加一个新的成本分类</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>分类名称</Label>
            <Input placeholder="如：邮箱、IP、服务器" value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && addCategory()} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCatOpen(false)}>取消</Button>
            <Button onClick={addCategory} disabled={!catName.trim()}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={costOpen} onOpenChange={setCostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加固定成本</DialogTitle>
            <DialogDescription className="sr-only">添加一项固定成本</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>分类</Label>
              <Select value={costForm.categoryId} onValueChange={(v) => setCostForm((f) => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  {ledger.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>金额 (¥)</Label>
              <Input type="number" placeholder="0.00" value={costForm.amount}
                onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input placeholder="可选" value={costForm.note}
                onChange={(e) => setCostForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCostOpen(false)}>取消</Button>
            <Button onClick={addFixedCost} disabled={!costForm.categoryId || !costForm.amount}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
