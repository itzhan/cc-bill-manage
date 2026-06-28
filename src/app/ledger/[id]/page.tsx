"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Button, Card, CardBody, CardHeader, Chip, Input,
  Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Spinner, Tab, Tabs,
  Table, TableBody, TableCell, TableColumn, TableHeader, TableRow,
  Autocomplete, AutocompleteItem, useDisclosure, addToast,
} from "@heroui/react";
import Shell from "@/components/Shell";
import {
  ArrowLeft, Plus, Server, Building2, Trash2,
  TrendingDown, DollarSign, Users, Calendar, Pencil, Check,
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
  todayCost: number; multiplier: number; revenue: number; accountName: string; lastSyncAt: string | null;
}
interface Summary {
  today: { date: string; cost: number; revenue: number; profit: number };
  total: { cost: number; revenue: number; profit: number; fixedCost: number };
  upstreamKeys: UpKeyRow[];
  siteUsers: SiteUserRow[];
  fixedCostDetails: { id: number; category: string; amount: number; note: string | null; createdAt: string }[];
  dailyData: { date: string; cost: number }[];
}
interface Option { id: number; name: string }
interface UpKeyOption { id: number; name: string; groupName: string }
interface SiteUserOption { id: number; remoteUserId: number; email: string; username: string; alias: string | null }

/* ─────────── Page ─────────── */

export default function LedgerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ledger, setLedger] = useState<LedgerDetail | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [upstreamOptions, setUpstreamOptions] = useState<Option[]>([]);
  const [siteOptions, setSiteOptions] = useState<Option[]>([]);

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

  if (loading || !ledger || !summary) return <Shell><div className="flex justify-center py-20"><Spinner /></div></Shell>;

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-6">
        <Button as={Link} href="/ledger" variant="light" isIconOnly size="sm"><ArrowLeft size={18} /></Button>
        <h1 className="text-xl font-bold">{ledger.name}</h1>
      </div>
      <Tabs aria-label="tabs" variant="underlined" classNames={{ tabList: "mb-4" }}>
        <Tab key="overview" title="概览">
          <OverviewTab ledger={ledger} summary={summary} upstreamOptions={upstreamOptions} siteOptions={siteOptions} onUpdate={loadAll} />
        </Tab>
        <Tab key="config" title="配置">
          <ConfigTab ledger={ledger} upstreamOptions={upstreamOptions} siteOptions={siteOptions} onUpdate={loadAll} />
        </Tab>
      </Tabs>
    </Shell>
  );
}

/* ─────────── StatCard ─────────── */

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: number; icon: React.ReactNode; color: string; sub?: string;
}) {
  return (
    <Card shadow="none" className="bg-content2/60 border border-divider/30">
      <CardBody className="py-3.5 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-default-400 font-medium">{label}</span>
          <span className="text-default-300">{icon}</span>
        </div>
        <p className={`text-xl font-bold tracking-tight ${color}`}>{fmtMoneyShort(value)}</p>
        {sub && <p className="text-[11px] text-default-400 mt-0.5">{sub}</p>}
      </CardBody>
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
        <Input size="sm" type="number" className="w-[70px]" classNames={{ input: "text-center" }}
          value={draft} onValueChange={setDraft} step="0.1" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
        <Button size="sm" isIconOnly variant="flat" color="primary" onPress={commit}><Check size={12} /></Button>
      </div>
    );
  }
  return (
    <button className="flex items-center gap-1 justify-center w-full text-sm hover:text-primary transition-colors"
      onClick={() => { setDraft(String(value)); setEditing(true); }}>
      ×{value}<Pencil size={11} className="text-default-300" />
    </button>
  );
}

/* ═══════════ 概览 Tab ═══════════ */

function OverviewTab({ ledger, summary, upstreamOptions, siteOptions, onUpdate }: {
  ledger: LedgerDetail; summary: Summary; upstreamOptions: Option[]; siteOptions: Option[]; onUpdate: () => void;
}) {
  const costModal = useDisclosure();
  const keyModal = useDisclosure();
  const userModal = useDisclosure();
  const [costForm, setCostForm] = useState({ categoryId: "", amount: "", note: "" });

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
    addToast({ title: "已添加 Key", color: "success" });
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
    addToast({ title: "已添加用户", color: "success" });
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

  // ── 固定成本 ──
  async function quickAddCost() {
    const catId = Number(costForm.categoryId);
    const amount = Number(costForm.amount);
    if (!catId || isNaN(amount) || amount <= 0) return;
    await fetch(`/api/ledger/${ledger.id}/fixed-costs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: catId, amount, note: costForm.note || undefined }),
    });
    addToast({ title: "已添加成本", color: "success" });
    setCostForm({ categoryId: "", amount: "", note: "" });
    costModal.onClose(); onUpdate();
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
        <StatCard label="总成本" value={summary.total.cost} icon={<TrendingDown size={15} />} color="text-danger"
          sub={summary.total.fixedCost > 0 ? `含自建 ¥${fmtMoneyShort(summary.total.fixedCost)}` : undefined} />
        <StatCard label="总利润" value={summary.total.profit} icon={<DollarSign size={15} />}
          color={summary.total.profit >= 0 ? "text-success" : "text-danger"}
          sub={`收入 ¥${fmtMoneyShort(summary.total.revenue)}`} />
        <StatCard label="今日利润" value={summary.today.profit} icon={<DollarSign size={15} />}
          color={summary.today.profit >= 0 ? "text-success" : "text-danger"}
          sub={`成本 ¥${fmtMoneyShort(summary.today.cost)} · 收入 ¥${fmtMoneyShort(summary.today.revenue)}`} />
      </div>

      {/* ── 成本明细（Key 级） ── */}
      <Card shadow="none" className="border border-divider/30">
        <CardHeader className="flex justify-between pb-2">
          <span className="text-sm font-semibold flex items-center gap-2"><Server size={14} className="text-danger" /> 成本明细</span>
          <div className="flex gap-2">
            <Button size="sm" variant="flat" color="primary" startContent={<Plus size={14} />}
              onPress={costModal.onOpen} isDisabled={ledger.categories.length === 0}>自建成本</Button>
            <Button size="sm" variant="flat" color="warning" startContent={<Plus size={14} />}
              onPress={keyModal.onOpen} isDisabled={ledger.upstreamLinks.length === 0}>添加 Key</Button>
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          {summary.upstreamKeys.length === 0 && summary.fixedCostDetails.length === 0 ? (
            <p className="text-sm text-default-400 py-4 text-center">
              {ledger.upstreamLinks.length === 0 ? "请先在配置中关联上游渠道" : "请添加要监控的 Key 或自建成本"}
            </p>
          ) : (
            <Table aria-label="成本" removeWrapper classNames={{ th: "text-[11px] uppercase", td: "py-2" }}>
              <TableHeader>
                <TableColumn>类型</TableColumn>
                <TableColumn>名称</TableColumn>
                <TableColumn align="end">今日消费</TableColumn>
                <TableColumn align="center" width={100}>倍率</TableColumn>
                <TableColumn align="end">成本</TableColumn>
                <TableColumn>同步</TableColumn>
                <TableColumn align="center" width={50}>{""}</TableColumn>
              </TableHeader>
              <TableBody>
                {[
                  ...summary.upstreamKeys.map((k) => (
                    <TableRow key={`k-${k.keyId}`}>
                      <TableCell><Chip size="sm" variant="flat" color="warning">渠道</Chip></TableCell>
                      <TableCell><span className="text-sm">{k.accountName} / {k.name}</span></TableCell>
                      <TableCell><span className="text-sm">¥{fmtMoney(k.todayActualCost, 2)}</span></TableCell>
                      <TableCell>
                        <InlineMultiplier value={k.multiplier} onSave={(v) => saveKeyMultiplier(k.keyId, v)} />
                      </TableCell>
                      <TableCell><span className="text-sm text-danger font-medium">¥{fmtMoney(k.cost, 2)}</span></TableCell>
                      <TableCell><span className="text-xs text-default-400">{k.lastSyncAt ? fmtDateShort(k.lastSyncAt) : "-"}</span></TableCell>
                      <TableCell><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => removeKey(k.keyId)}><Trash2 size={13} /></Button></TableCell>
                    </TableRow>
                  )),
                  ...summary.fixedCostDetails.map((fc) => (
                    <TableRow key={`fc-${fc.id}`}>
                      <TableCell><Chip size="sm" variant="flat" color="secondary">{fc.category}</Chip></TableCell>
                      <TableCell><span className="text-sm">{fc.note || "固定成本"}</span></TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell><span className="text-sm text-danger font-medium">¥{fmtMoney(fc.amount, 2)}</span></TableCell>
                      <TableCell><span className="text-xs text-default-400">{fmtDateShort(fc.createdAt)}</span></TableCell>
                      <TableCell><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteCost(fc.id)}><Trash2 size={13} /></Button></TableCell>
                    </TableRow>
                  )),
                ]}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* ── 收入明细（用户级） ── */}
      <Card shadow="none" className="border border-divider/30">
        <CardHeader className="flex justify-between pb-2">
          <span className="text-sm font-semibold flex items-center gap-2"><Users size={14} className="text-success" /> 收入明细</span>
          <Button size="sm" variant="flat" color="success" startContent={<Plus size={14} />}
            onPress={userModal.onOpen} isDisabled={ledger.siteLinks.length === 0}>添加用户</Button>
        </CardHeader>
        <CardBody className="pt-0">
          {summary.siteUsers.length === 0 && ledger.userLinks.length === 0 ? (
            <p className="text-sm text-default-400 py-4 text-center">
              {ledger.siteLinks.length === 0 ? "请先在配置中关联本站账号" : "请添加要监控的用户"}
            </p>
          ) : (
            <Table aria-label="收入" removeWrapper classNames={{ th: "text-[11px] uppercase", td: "py-2" }}>
              <TableHeader>
                <TableColumn>用户</TableColumn>
                <TableColumn>站点</TableColumn>
                <TableColumn align="end">今日消费</TableColumn>
                <TableColumn align="center" width={100}>倍率</TableColumn>
                <TableColumn align="end">收入</TableColumn>
                <TableColumn>同步</TableColumn>
                <TableColumn align="center" width={50}>{""}</TableColumn>
              </TableHeader>
              <TableBody>
                {summary.siteUsers.map((u) => (
                  <TableRow key={u.siteUserId}>
                    <TableCell><span className="text-sm">{u.alias || u.username || u.email}</span></TableCell>
                    <TableCell><span className="text-xs text-default-400">{u.accountName}</span></TableCell>
                    <TableCell><span className="text-sm">¥{fmtMoney(u.todayCost, 2)}</span></TableCell>
                    <TableCell>
                      <InlineMultiplier value={u.multiplier} onSave={(v) => saveUserMultiplier(u.siteUserId, v)} />
                    </TableCell>
                    <TableCell><span className="text-sm text-success font-medium">¥{fmtMoney(u.revenue, 2)}</span></TableCell>
                    <TableCell><span className="text-xs text-default-400">{u.lastSyncAt ? fmtDateShort(u.lastSyncAt) : "-"}</span></TableCell>
                    <TableCell><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => removeUser(u.siteUserId)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* ── 成本趋势 ── */}
      {chartData.length > 1 && (
        <Card shadow="none" className="border border-divider/30">
          <CardHeader className="pb-0">
            <span className="text-sm font-semibold flex items-center gap-2"><Calendar size={14} className="text-primary" /> 成本趋势</span>
          </CardHeader>
          <CardBody className="pt-2">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-divider))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Line type="monotone" dataKey="成本" stroke="#f5a524" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* ── 添加自建成本 Modal ── */}
      <Modal isOpen={costModal.isOpen} onClose={costModal.onClose}>
        <ModalContent>
          <ModalHeader>添加自建成本</ModalHeader>
          <ModalBody className="gap-4">
            <Select label="分类" selectedKeys={costForm.categoryId ? [costForm.categoryId] : []}
              onChange={(e) => setCostForm((f) => ({ ...f, categoryId: e.target.value }))}>
              {ledger.categories.map((c) => <SelectItem key={c.id}>{c.name}</SelectItem>)}
            </Select>
            <Input label="金额 (¥)" type="number" placeholder="0.00" value={costForm.amount}
              onValueChange={(v) => setCostForm((f) => ({ ...f, amount: v }))} />
            <Input label="备注" placeholder="可选" value={costForm.note}
              onValueChange={(v) => setCostForm((f) => ({ ...f, note: v }))} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={costModal.onClose}>取消</Button>
            <Button color="primary" onPress={quickAddCost} isDisabled={!costForm.categoryId || !costForm.amount}>添加</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── 添加 Key Modal：先选渠道再搜索 Key ── */}
      <Modal isOpen={keyModal.isOpen} onClose={() => { keyModal.onClose(); setPickUpId(null); setKeyOptions([]); }} size="lg">
        <ModalContent>
          <ModalHeader>添加监控 Key</ModalHeader>
          <ModalBody className="gap-4">
            <Select label="选择渠道" selectedKeys={pickUpId ? [String(pickUpId)] : []}
              onChange={(e) => { const v = Number(e.target.value); if (v) loadKeys(v); }}>
              {ledger.upstreamLinks.map((l) => <SelectItem key={String(l.upstreamAccount.id)}>{l.upstreamAccount.name}</SelectItem>)}
            </Select>
            {pickUpId && (
              loadingKeys ? <div className="flex justify-center py-4"><Spinner size="sm" /></div>
              : availableKeys.length === 0 ? (
                <p className="text-sm text-default-400 text-center py-2">
                  {keyOptions.length === 0 ? "该渠道暂无 Key，请先同步" : "所有 Key 已添加"}
                </p>
              ) : (
                <Autocomplete label="搜索 Key" placeholder="输入 Key 名称"
                  onSelectionChange={(key) => { const v = Number(key); if (v) addKey(v); }}>
                  {availableKeys.map((k) => (
                    <AutocompleteItem key={k.id} textValue={`${k.name} ${k.groupName}`}>
                      <div className="flex flex-col">
                        <span className="text-sm">{k.name}</span>
                        <span className="text-xs text-default-400">{k.groupName}</span>
                      </div>
                    </AutocompleteItem>
                  ))}
                </Autocomplete>
              )
            )}
            {ledger.keyLinks.length > 0 && (
              <div>
                <p className="text-xs text-default-400 mb-2">已添加 {ledger.keyLinks.length} 个 Key</p>
                <div className="flex flex-wrap gap-1.5">
                  {ledger.keyLinks.map((l) => (
                    <Chip key={l.id} size="sm" variant="flat" onClose={() => removeKey(l.upstreamKey.id)}>
                      {l.upstreamKey.upstreamAccount.name} / {l.upstreamKey.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { keyModal.onClose(); setPickUpId(null); setKeyOptions([]); }}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── 添加用户 Modal ── */}
      <Modal isOpen={userModal.isOpen} onClose={() => { userModal.onClose(); setPickSiteId(null); setSiteUserOptions([]); }} size="lg">
        <ModalContent>
          <ModalHeader>添加监控用户</ModalHeader>
          <ModalBody className="gap-4">
            <Select label="选择站点" selectedKeys={pickSiteId ? [String(pickSiteId)] : []}
              onChange={(e) => { const v = Number(e.target.value); if (v) loadSiteUsers(v); }}>
              {ledger.siteLinks.map((l) => <SelectItem key={String(l.siteAccount.id)}>{l.siteAccount.name}</SelectItem>)}
            </Select>
            {pickSiteId && (
              loadingUsers ? <div className="flex justify-center py-4"><Spinner size="sm" /></div>
              : availableSiteUsers.length === 0 ? (
                <p className="text-sm text-default-400 text-center py-2">
                  {siteUserOptions.length === 0 ? "该站点暂无用户，请先同步" : "所有用户已添加"}
                </p>
              ) : (
                <Autocomplete label="搜索用户" placeholder="输入邮箱或用户名"
                  onSelectionChange={(key) => { const v = Number(key); if (v) addUser(v); }}>
                  {availableSiteUsers.map((u) => (
                    <AutocompleteItem key={u.id} textValue={`${u.alias || ""} ${u.username} ${u.email}`}>
                      <div className="flex flex-col">
                        <span className="text-sm">{u.alias || u.username || u.email}</span>
                        {u.username && u.username !== u.email && <span className="text-xs text-default-400">{u.email}</span>}
                      </div>
                    </AutocompleteItem>
                  ))}
                </Autocomplete>
              )
            )}
            {ledger.userLinks.length > 0 && (
              <div>
                <p className="text-xs text-default-400 mb-2">已添加 {ledger.userLinks.length} 个用户</p>
                <div className="flex flex-wrap gap-1.5">
                  {ledger.userLinks.map((l) => (
                    <Chip key={l.id} size="sm" variant="flat" onClose={() => removeUser(l.siteUser.id)}>
                      {l.siteUser.alias || l.siteUser.username || l.siteUser.email}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { userModal.onClose(); setPickSiteId(null); setSiteUserOptions([]); }}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ═══════════ 配置 Tab ═══════════ */

function ConfigTab({ ledger, upstreamOptions, siteOptions, onUpdate }: {
  ledger: LedgerDetail; upstreamOptions: Option[]; siteOptions: Option[]; onUpdate: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const catModal = useDisclosure();
  const costModal = useDisclosure();
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
    if (!r.ok) { addToast({ title: "分类已存在", color: "warning" }); return; }
    setCatName(""); catModal.onClose(); onUpdate();
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
    setCostForm({ categoryId: "", amount: "", note: "" }); costModal.onClose(); onUpdate();
  }

  async function deleteFixedCost(costId: number) {
    await fetch(`/api/ledger/${ledger.id}/fixed-costs/${costId}`, { method: "DELETE" });
    onUpdate();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card shadow="none" className="border border-divider/30">
          <CardHeader><span className="text-sm font-semibold flex items-center gap-2"><Server size={16} /> 关联上游渠道</span></CardHeader>
          <CardBody className="pt-0 space-y-3">
            {ledger.upstreamLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-default-100 rounded-lg px-3 py-2">
                <span className="text-sm">{l.upstreamAccount.name}</span>
                <Button isIconOnly size="sm" variant="light" color="danger" isLoading={saving}
                  onPress={() => updateLinks("upstreamAccountIds", [...linkedUpIds].filter((x) => x !== l.upstreamAccount.id))}><Trash2 size={14} /></Button>
              </div>
            ))}
            {availableUp.length > 0 && (
              <Autocomplete label="搜索并添加渠道" size="sm" isLoading={saving}
                onSelectionChange={(key) => { const v = Number(key); if (v) updateLinks("upstreamAccountIds", [...linkedUpIds, v]); }}>
                {availableUp.map((o) => <AutocompleteItem key={o.id}>{o.name}</AutocompleteItem>)}
              </Autocomplete>
            )}
          </CardBody>
        </Card>
        <Card shadow="none" className="border border-divider/30">
          <CardHeader><span className="text-sm font-semibold flex items-center gap-2"><Building2 size={16} /> 关联本站账号</span></CardHeader>
          <CardBody className="pt-0 space-y-3">
            {ledger.siteLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-default-100 rounded-lg px-3 py-2">
                <span className="text-sm">{l.siteAccount.name}</span>
                <Button isIconOnly size="sm" variant="light" color="danger" isLoading={saving}
                  onPress={() => updateLinks("siteAccountIds", [...linkedSiteIds].filter((x) => x !== l.siteAccount.id))}><Trash2 size={14} /></Button>
              </div>
            ))}
            {availableSite.length > 0 && (
              <Autocomplete label="搜索并添加站点" size="sm" isLoading={saving}
                onSelectionChange={(key) => { const v = Number(key); if (v) updateLinks("siteAccountIds", [...linkedSiteIds, v]); }}>
                {availableSite.map((o) => <AutocompleteItem key={o.id}>{o.name}</AutocompleteItem>)}
              </Autocomplete>
            )}
          </CardBody>
        </Card>
      </div>

      <Card shadow="none" className="border border-divider/30">
        <CardHeader className="flex justify-between">
          <span className="text-sm font-semibold">自建成本分类</span>
          <div className="flex gap-2">
            <Button size="sm" variant="flat" startContent={<Plus size={14} />} onPress={catModal.onOpen}>添加分类</Button>
            <Button size="sm" color="primary" variant="flat" startContent={<Plus size={14} />}
              onPress={costModal.onOpen} isDisabled={ledger.categories.length === 0}>添加成本</Button>
          </div>
        </CardHeader>
        <CardBody className="pt-0 space-y-4">
          {ledger.categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ledger.categories.map((c) => <Chip key={c.id} variant="flat" onClose={() => deleteCategory(c.id)}>{c.name}</Chip>)}
            </div>
          )}
          {ledger.categories.length === 0 && <p className="text-sm text-default-400">请先添加分类（如：邮箱、IP、服务器）</p>}
          {ledger.fixedCosts.length > 0 && (
            <Table aria-label="固定成本" removeWrapper classNames={{ th: "text-[11px] uppercase", td: "py-2" }}>
              <TableHeader>
                <TableColumn>分类</TableColumn><TableColumn>备注</TableColumn>
                <TableColumn align="end">金额</TableColumn><TableColumn>创建时间</TableColumn>
                <TableColumn align="center" width={50}>{""}</TableColumn>
              </TableHeader>
              <TableBody>
                {ledger.fixedCosts.map((fc) => (
                  <TableRow key={fc.id}>
                    <TableCell><Chip size="sm" variant="flat" color="primary">{fc.category.name}</Chip></TableCell>
                    <TableCell><span className="text-sm">{fc.note || "-"}</span></TableCell>
                    <TableCell><span className="text-sm font-medium">¥{fmtMoney(fc.amount, 2)}</span></TableCell>
                    <TableCell><span className="text-xs text-default-400">{fmtDateShort(fc.createdAt)}</span></TableCell>
                    <TableCell><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteFixedCost(fc.id)}><Trash2 size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={catModal.isOpen} onClose={catModal.onClose}>
        <ModalContent>
          <ModalHeader>添加成本分类</ModalHeader>
          <ModalBody><Input label="分类名称" placeholder="如：邮箱、IP、服务器" value={catName} onValueChange={setCatName} autoFocus
            onKeyDown={(e) => e.key === "Enter" && addCategory()} /></ModalBody>
          <ModalFooter><Button variant="flat" onPress={catModal.onClose}>取消</Button><Button color="primary" onPress={addCategory} isDisabled={!catName.trim()}>添加</Button></ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={costModal.isOpen} onClose={costModal.onClose}>
        <ModalContent>
          <ModalHeader>添加固定成本</ModalHeader>
          <ModalBody className="gap-4">
            <Select label="分类" selectedKeys={costForm.categoryId ? [costForm.categoryId] : []}
              onChange={(e) => setCostForm((f) => ({ ...f, categoryId: e.target.value }))}>
              {ledger.categories.map((c) => <SelectItem key={c.id}>{c.name}</SelectItem>)}
            </Select>
            <Input label="金额 (¥)" type="number" placeholder="0.00" value={costForm.amount}
              onValueChange={(v) => setCostForm((f) => ({ ...f, amount: v }))} />
            <Input label="备注" placeholder="可选" value={costForm.note}
              onValueChange={(v) => setCostForm((f) => ({ ...f, note: v }))} />
          </ModalBody>
          <ModalFooter><Button variant="flat" onPress={costModal.onClose}>取消</Button>
            <Button color="primary" onPress={addFixedCost} isDisabled={!costForm.categoryId || !costForm.amount}>添加</Button></ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
