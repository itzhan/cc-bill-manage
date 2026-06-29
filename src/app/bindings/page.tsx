"use client";
import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

interface Option {
  id: number;
  label: string;
  name?: string; // raw account/key name (without parent prefix)
  todayActualCost?: number; // upstream key
  todayCost?: number; // site bound account
  upstreamAccountId?: number; // upstream key parent
  upstreamAccountName?: string;
  siteAccountId?: number; // site bound account parent
  siteAccountName?: string;
}
interface BindingItem {
  id: number;
  maxConcurrency: number | null;
  upstreamKey: {
    id: number;
    name: string;
    keyMasked: string;
    groupName: string;
    groupRateMultiplier: number;
    effectiveRateMultiplier: number;
    hasExclusiveRate: boolean;
    upstreamAccountId: number;
    upstreamAccount: { id: number; name: string };
  };
  siteBoundAccount: {
    id: number;
    name: string;
    rateMultiplier: number;
    siteAccount: { name: string };
  };
}

export default function BindingsPage() {
  const [items, setItems] = useState<BindingItem[]>([]);
  const [opts, setOpts] = useState<{
    upstreamKeys: Option[];
    siteBoundAccounts: Option[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [showBoundSite, setShowBoundSite] = useState(false);
  const [showAzAccounts, setShowAzAccounts] = useState(false);
  const [parentSiteIds, setParentSiteIds] = useState<Set<string>>(new Set());
  const [parentUpstreamIds, setParentUpstreamIds] = useState<Set<string>>(
    new Set(),
  );
  const [siteIds, setSiteIds] = useState<Set<string>>(new Set());
  const [keyIds, setKeyIds] = useState<Set<string>>(new Set());
  const [newMaxConcurrency, setNewMaxConcurrency] = useState<string>("");
  // Card-level fold state: ids of expanded channel cards (default = collapsed).
  const [expandedChannels, setExpandedChannels] = useState<Set<number>>(
    new Set(),
  );
  // Multi-select popover open states
  const [sitePopoverOpen, setSitePopoverOpen] = useState(false);
  const [keyPopoverOpen, setKeyPopoverOpen] = useState(false);

  function toggleChannel(id: number) {
    setExpandedChannels((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function openAddForChannel(channelId: number) {
    // Pre-pick the channel in the parent-filter chips so users don't have
    // to scroll to find their channel; key/site selects start empty.
    setParentUpstreamIds(new Set([String(channelId)]));
    setParentSiteIds(new Set());
    setSiteIds(new Set());
    setKeyIds(new Set());
    setNewMaxConcurrency("");
    setDlgOpen(true);
  }
  const [editDlgOpen, setEditDlgOpen] = useState(false);
  const [editing, setEditing] = useState<BindingItem | null>(null);
  const [editMax, setEditMax] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/bindings", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/bindings/options", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setItems(a.items || []);
      setOpts({
        upstreamKeys: b.upstreamKeys || [],
        siteBoundAccounts: b.siteBoundAccounts || [],
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const sIds = Array.from(siteIds);
    const kIds = Array.from(keyIds);
    if (sIds.length === 0 || kIds.length === 0) {
      toast.warning("请至少选一个本站账号和一个上游 Key");
      return;
    }
    const maxNum = Number(newMaxConcurrency);
    const res = await fetch("/api/bindings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteBoundAccountIds: sIds.map(Number),
        upstreamKeyIds: kIds.map(Number),
        maxConcurrency:
          Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error("添加失败", { description: j.error });
      return;
    }
    const j = (await res.json()) as {
      created: number;
      skipped: number;
      errors: {
        siteBoundAccountId: number;
        upstreamKeyId: number;
        error: string;
      }[];
    };
    setDlgOpen(false);
    setSiteIds(new Set());
    setKeyIds(new Set());
    const summary = `新增 ${j.created}${j.skipped ? `，跳过已存在 ${j.skipped}` : ""}${j.errors.length ? `，失败 ${j.errors.length}` : ""}`;
    if (j.errors.length) {
      toast.warning(summary, {
        description: j.errors
          .map(
            (e) =>
              `#site${e.siteBoundAccountId}×key${e.upstreamKeyId}: ${e.error}`,
          )
          .join("; "),
      });
    } else {
      toast.success(summary);
    }
    await load();
  }

  async function remove(id: number) {
    if (!confirm("确定删除该绑定？")) return;
    const res = await fetch(`/api/bindings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error("删除失败", { description: j.error });
      return;
    }
    toast.success("已删除");
    await load();
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">绑定</h1>
          <p className="text-sm text-muted-foreground">
            本站账号 ↔ 上游 Key（多对多），用于成本对账与差异检测
          </p>
        </div>
        <Button onClick={() => setDlgOpen(true)}>
          + 新增绑定
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-muted-foreground text-sm">暂无绑定</p>
          </CardContent>
        </Card>
      ) : (() => {
        // Two-level grouping:
        //   Outer card  = 渠道 (upstreamAccount) — many keys per channel
        //   Inner block = upstream key — many site bindings per key
        type ChannelGroup = {
          accountId: number;
          accountName: string;
          keys: Map<
            number,
            { key: BindingItem["upstreamKey"]; rows: BindingItem[] }
          >;
          totalBindings: number;
        };
        const channels = new Map<number, ChannelGroup>();
        for (const b of items) {
          const accId =
            b.upstreamKey.upstreamAccountId ??
            b.upstreamKey.upstreamAccount?.id ??
            0;
          const accName = b.upstreamKey.upstreamAccount?.name ?? "(unknown)";
          let ch = channels.get(accId);
          if (!ch) {
            ch = {
              accountId: accId,
              accountName: accName,
              keys: new Map(),
              totalBindings: 0,
            };
            channels.set(accId, ch);
          }
          ch.totalBindings++;
          const k = ch.keys.get(b.upstreamKey.id);
          if (k) k.rows.push(b);
          else
            ch.keys.set(b.upstreamKey.id, {
              key: b.upstreamKey,
              rows: [b],
            });
        }
        const channelList = [...channels.values()].sort(
          (a, b) => b.totalBindings - a.totalBindings,
        );
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {channelList.map((ch) => {
              const open = expandedChannels.has(ch.accountId);
              return (
              <Card
                key={ch.accountId}
                className="bg-card border border-border/50"
              >
                <CardHeader
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-stop-toggle]"))
                      return;
                    toggleChannel(ch.accountId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleChannel(ch.accountId);
                    }
                  }}
                  className="flex-row items-center justify-between gap-2 flex-wrap cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <ChevronRight
                      size={14}
                      className={cn(
                        "text-muted-foreground transition-transform shrink-0",
                        open && "rotate-90",
                      )}
                    />
                    <h3 className="font-semibold text-base truncate">
                      {ch.accountName}
                    </h3>
                    <Badge
                      variant="secondary"
                      className="h-5 text-[11px] px-1.5 py-0"
                    >
                      {ch.keys.size} keys
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="h-5 text-[11px] px-1.5 py-0"
                    >
                      {ch.totalBindings} 个绑定
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 min-w-0 px-2"
                    data-stop-toggle
                    onClick={() => openAddForChannel(ch.accountId)}
                  >
                    + 添加绑定
                  </Button>
                </CardHeader>
                {open && (
                <CardContent className="pt-0 space-y-2">
                  {[...ch.keys.values()]
                    .sort((a, b) => b.rows.length - a.rows.length)
                    .map((g) => (
                      <div
                        key={g.key.id}
                        className="rounded-md border border-border/40 overflow-hidden text-xs"
                      >
                        <div className="flex justify-between items-start gap-2 px-2.5 py-1.5 bg-muted/30 flex-wrap">
                          <div className="flex flex-col leading-tight min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {g.key.name}
                              </span>
                              <Badge
                                variant="secondary"
                                className="h-5 text-[11px] px-1.5 py-0"
                              >
                                {g.key.groupName}
                              </Badge>
                              {g.key.hasExclusiveRate ? (
                                <Badge
                                  variant="default"
                                  className="h-5 text-[11px] px-1.5 py-0"
                                >
                                  专属 &times;{g.key.effectiveRateMultiplier}
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">
                                  &times;{g.key.groupRateMultiplier}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {g.key.keyMasked}
                            </span>
                          </div>
                          <Badge
                            variant="secondary"
                            className="h-5 text-[11px] px-1.5 py-0"
                          >
                            {g.rows.length} 绑定
                          </Badge>
                        </div>
                        <div>
                          {g.rows.map((b, idx) => (
                            <div
                              key={b.id}
                              className={cn(
                                "flex items-center justify-between gap-2 px-2.5 py-1.5",
                                idx > 0 && "border-t border-border/30",
                              )}
                            >
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="font-medium truncate">
                                  {b.siteBoundAccount.siteAccount.name}
                                </span>
                                <span className="text-muted-foreground">/</span>
                                <span className="truncate">
                                  {b.siteBoundAccount.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-[11px] px-1.5 py-0"
                                >
                                  &times;{b.siteBoundAccount.rateMultiplier}
                                </Badge>
                                {b.maxConcurrency != null && (
                                  <Badge
                                    variant="default"
                                    className="h-5 text-[11px] px-1.5 py-0"
                                  >
                                    max {b.maxConcurrency}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 min-w-0 px-2"
                                  onClick={() => {
                                    setEditing(b);
                                    setEditMax(
                                      b.maxConcurrency != null
                                        ? String(b.maxConcurrency)
                                        : "",
                                    );
                                    setEditDlgOpen(true);
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 min-w-0 px-2 text-destructive hover:text-destructive"
                                  onClick={() => remove(b.id)}
                                >
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </CardContent>
                )}
              </Card>
              );
            })}
          </div>
        );
      })()}

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>新增绑定</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!opts ||
            opts.siteBoundAccounts.length === 0 ||
            opts.upstreamKeys.length === 0 ? (
              <p className="text-muted-foreground">
                请先在「上游账号」「本站账号」页面创建并同步，才能在这里绑定。
              </p>
            ) : (() => {
              const boundSiteIds = new Set(
                items.map((b) => b.siteBoundAccount.id),
              );
              // Parent-account filter dropdowns: empty = no filter (all).
              const siteParents = new Map<number, string>();
              for (const o of opts.siteBoundAccounts) {
                if (o.siteAccountId != null) {
                  siteParents.set(o.siteAccountId, o.siteAccountName ?? "?");
                }
              }
              const upParents = new Map<number, string>();
              for (const o of opts.upstreamKeys) {
                if (o.upstreamAccountId != null) {
                  upParents.set(
                    o.upstreamAccountId,
                    o.upstreamAccountName ?? "?",
                  );
                }
              }
              const filterAndSort = (
                arr: Option[],
                key: "todayActualCost" | "todayCost",
              ) => {
                const base = showZero
                  ? arr
                  : arr.filter((o) => (o[key] ?? 0) > 0);
                return [...base].sort(
                  (x, y) => (y[key] ?? 0) - (x[key] ?? 0),
                );
              };
              // 1) parent filter
              const siteAfterParent = parentSiteIds.size
                ? opts.siteBoundAccounts.filter(
                    (o) =>
                      o.siteAccountId != null &&
                      parentSiteIds.has(String(o.siteAccountId)),
                  )
                : opts.siteBoundAccounts;
              const upAfterParent = parentUpstreamIds.size
                ? opts.upstreamKeys.filter(
                    (o) =>
                      o.upstreamAccountId != null &&
                      parentUpstreamIds.has(String(o.upstreamAccountId)),
                  )
                : opts.upstreamKeys;
              // 2) zero-cost filter + sort
              const allSiteList = filterAndSort(siteAfterParent, "todayCost");
              // 3) az-prefix filter (default hide; az 站点账号 cluttering the
              // picker even though they're rarely the binding target)
              const isAzAccount = (o: Option) =>
                (o.name ?? "").toLowerCase().startsWith("az-");
              const siteListAfterAz = showAzAccounts
                ? allSiteList
                : allSiteList.filter((o) => !isAzAccount(o));
              const azHidden = allSiteList.length - siteListAfterAz.length;
              // 4) already-bound filter
              const siteList = showBoundSite
                ? siteListAfterAz
                : siteListAfterAz.filter((o) => !boundSiteIds.has(o.id));
              const keyList = filterAndSort(upAfterParent, "todayActualCost");
              const siteHidden = siteAfterParent.length - allSiteList.length;
              const siteBoundHidden = siteListAfterAz.length - siteList.length;
              const keyHidden = upAfterParent.length - keyList.length;
              return (
                <>
                  <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground mt-1 w-16 shrink-0">
                        本站站点
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Badge
                          variant={parentSiteIds.size === 0 ? "default" : "secondary"}
                          className="cursor-pointer"
                          onClick={() => setParentSiteIds(new Set())}
                        >
                          全部
                        </Badge>
                        {[...siteParents.entries()].map(([id, name]) => {
                          const sel = parentSiteIds.has(String(id));
                          return (
                            <Badge
                              key={id}
                              variant={sel ? "default" : "secondary"}
                              className="cursor-pointer"
                              onClick={() => {
                                const next = new Set(parentSiteIds);
                                if (sel) next.delete(String(id));
                                else next.add(String(id));
                                setParentSiteIds(next);
                              }}
                            >
                              {name}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground mt-1 w-16 shrink-0">
                        上游账号
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Badge
                          variant={
                            parentUpstreamIds.size === 0 ? "default" : "secondary"
                          }
                          className="cursor-pointer"
                          onClick={() => setParentUpstreamIds(new Set())}
                        >
                          全部
                        </Badge>
                        {[...upParents.entries()].map(([id, name]) => {
                          const sel = parentUpstreamIds.has(String(id));
                          return (
                            <Badge
                              key={id}
                              variant={sel ? "default" : "secondary"}
                              className="cursor-pointer"
                              onClick={() => {
                                const next = new Set(parentUpstreamIds);
                                if (sel) next.delete(String(id));
                                else next.add(String(id));
                                setParentUpstreamIds(next);
                              }}
                            >
                              {name}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-4 flex-wrap">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={showBoundSite}
                          onCheckedChange={(v) => setShowBoundSite(!!v)}
                        />
                        显示已绑定的本站账号
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={showZero}
                          onCheckedChange={(v) => setShowZero(!!v)}
                        />
                        显示今日 0 消费的账号 / Key
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={showAzAccounts}
                          onCheckedChange={(v) => setShowAzAccounts(!!v)}
                        />
                        显示 az 账号
                      </label>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {!showBoundSite && siteBoundHidden > 0 && (
                        <>已隐藏 {siteBoundHidden} 个已绑定 · </>
                      )}
                      {!showAzAccounts && azHidden > 0 && (
                        <>{azHidden} 个 az 账号 · </>
                      )}
                      {!showZero && (siteHidden > 0 || keyHidden > 0) && (
                        <>0 消费 {siteHidden} 个账号 / {keyHidden} 个 Key</>
                      )}
                    </span>
                  </div>
                  {/* 本站账号 multi-select */}
                  <div className="space-y-1">
                    <Label>本站账号</Label>
                    <Popover open={sitePopoverOpen} onOpenChange={setSitePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start font-normal h-auto min-h-9 py-2"
                        >
                          {siteIds.size === 0 ? (
                            <span className="text-muted-foreground">可多选</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Array.from(siteIds).map((sid) => {
                                const o = siteList.find((x) => String(x.id) === sid);
                                if (!o) return null;
                                const showShort =
                                  parentSiteIds.size === 1 && !!o.siteAccountName;
                                const prefix = `${o.siteAccountName} / `;
                                const display =
                                  showShort && o.label.startsWith(prefix)
                                    ? o.label.slice(prefix.length)
                                    : o.label;
                                return (
                                  <Badge key={sid} variant="secondary" className="text-xs">
                                    {display}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-h-60 overflow-y-auto p-2">
                        {siteList.map((o) => {
                          const showShort =
                            parentSiteIds.size === 1 && !!o.siteAccountName;
                          const prefix = `${o.siteAccountName} / `;
                          const display =
                            showShort && o.label.startsWith(prefix)
                              ? o.label.slice(prefix.length)
                              : o.label;
                          const id = String(o.id);
                          return (
                            <label
                              key={id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={siteIds.has(id)}
                                onCheckedChange={() => {
                                  const next = new Set(siteIds);
                                  if (next.has(id)) next.delete(id);
                                  else next.add(id);
                                  setSiteIds(next);
                                }}
                              />
                              <span>{display}</span>
                            </label>
                          );
                        })}
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      已选 {siteIds.size} 个 · 候选 {siteList.length}
                    </p>
                  </div>
                  {/* 上游 Key multi-select */}
                  <div className="space-y-1">
                    <Label>上游 Key</Label>
                    <Popover open={keyPopoverOpen} onOpenChange={setKeyPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start font-normal h-auto min-h-9 py-2"
                        >
                          {keyIds.size === 0 ? (
                            <span className="text-muted-foreground">可多选</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Array.from(keyIds).map((kid) => {
                                const o = keyList.find((x) => String(x.id) === kid);
                                if (!o) return null;
                                const showShort =
                                  parentUpstreamIds.size === 1 &&
                                  !!o.upstreamAccountName;
                                const prefix = `${o.upstreamAccountName} / `;
                                const display =
                                  showShort && o.label.startsWith(prefix)
                                    ? o.label.slice(prefix.length)
                                    : o.label;
                                return (
                                  <Badge key={kid} variant="secondary" className="text-xs">
                                    {display}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-h-60 overflow-y-auto p-2">
                        {keyList.map((o) => {
                          const showShort =
                            parentUpstreamIds.size === 1 && !!o.upstreamAccountName;
                          const prefix = `${o.upstreamAccountName} / `;
                          const display =
                            showShort && o.label.startsWith(prefix)
                              ? o.label.slice(prefix.length)
                              : o.label;
                          const id = String(o.id);
                          return (
                            <label
                              key={id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={keyIds.has(id)}
                                onCheckedChange={() => {
                                  const next = new Set(keyIds);
                                  if (next.has(id)) next.delete(id);
                                  else next.add(id);
                                  setKeyIds(next);
                                }}
                              />
                              <span>{display}</span>
                            </label>
                          );
                        })}
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      已选 {keyIds.size} 个 · 候选 {keyList.length} · 将创建{" "}
                      {siteIds.size * keyIds.size} 条绑定
                    </p>
                  </div>
                </>
              );
            })()}
            <div className="space-y-1">
              <Label>上游 key 最大并发（可选）</Label>
              <Input
                type="number"
                placeholder="例如 600"
                value={newMaxConcurrency}
                onChange={(e) => setNewMaxConcurrency(e.target.value)}
                min={0}
              />
              <p className="text-xs text-muted-foreground">
                每条新建的绑定都会写入这个值，用于资源调度页的容量提示。留空表示不设上限。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDlgOpen(false)}>
              取消
            </Button>
            <Button onClick={add}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDlgOpen} onOpenChange={setEditDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑绑定</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editing && (
              <>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  本站账号：
                  <span className="font-medium text-foreground">
                    {editing.siteBoundAccount.siteAccount.name} /{" "}
                    {editing.siteBoundAccount.name}
                  </span>
                  <br />
                  上游 Key：
                  <span className="font-medium text-foreground">
                    {editing.upstreamKey.upstreamAccount.name} /{" "}
                    {editing.upstreamKey.name}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label>最大并发</Label>
                  <Input
                    type="number"
                    placeholder="留空清除上限"
                    value={editMax}
                    onChange={(e) => setEditMax(e.target.value)}
                    min={0}
                  />
                  <p className="text-xs text-muted-foreground">留空清除上限</p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditDlgOpen(false)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!editing) return;
                const n = Number(editMax);
                const v =
                  editMax.trim() === ""
                    ? null
                    : Number.isFinite(n) && n > 0
                      ? Math.floor(n)
                      : null;
                const r = await fetch(`/api/bindings/${editing.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ maxConcurrency: v }),
                });
                if (!r.ok) {
                  toast.error("保存失败");
                  return;
                }
                toast.success("已保存");
                setEditDlgOpen(false);
                await load();
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
