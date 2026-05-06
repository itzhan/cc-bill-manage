"use client";
import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
  useDisclosure,
} from "@heroui/react";
import Shell from "@/components/Shell";

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
  const dlg = useDisclosure();
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
  const editDlg = useDisclosure();
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
      addToast({
        title: "请至少选一个本站账号和一个上游 Key",
        color: "warning",
      });
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
      addToast({ title: "添加失败", description: j.error, color: "danger" });
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
    dlg.onClose();
    setSiteIds(new Set());
    setKeyIds(new Set());
    const summary = `新增 ${j.created}${j.skipped ? `，跳过已存在 ${j.skipped}` : ""}${j.errors.length ? `，失败 ${j.errors.length}` : ""}`;
    addToast({
      title: summary,
      description: j.errors.length
        ? j.errors
            .map(
              (e) =>
                `#site${e.siteBoundAccountId}×key${e.upstreamKeyId}: ${e.error}`,
            )
            .join("; ")
        : undefined,
      color: j.errors.length ? "warning" : "success",
    });
    await load();
  }

  async function remove(id: number) {
    if (!confirm("确定删除该绑定？")) return;
    const res = await fetch(`/api/bindings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      addToast({ title: "删除失败", description: j.error, color: "danger" });
      return;
    }
    addToast({ title: "已删除", color: "success" });
    await load();
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">绑定</h1>
          <p className="text-sm text-default-500">
            本站账号 ↔ 上游 Key（多对多），用于成本对账与差异检测
          </p>
        </div>
        <Button color="primary" onPress={dlg.onOpen}>
          + 新增绑定
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-default-500 text-sm">暂无绑定</p>
          </CardBody>
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
          <div className="space-y-4">
            {channelList.map((ch) => (
              <Card
                key={ch.accountId}
                className="bg-content1 border border-divider/50 shadow-none"
              >
                <CardHeader className="flex justify-between items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-base">
                      {ch.accountName}
                    </h3>
                    <Chip size="sm" variant="flat">
                      {ch.keys.size} keys
                    </Chip>
                    <Chip size="sm" variant="flat" color="default">
                      {ch.totalBindings} 个绑定
                    </Chip>
                  </div>
                </CardHeader>
                <CardBody className="pt-0 gap-3">
                  {[...ch.keys.values()]
                    .sort((a, b) => b.rows.length - a.rows.length)
                    .map((g) => (
                      <div
                        key={g.key.id}
                        className="rounded-lg border border-divider/40 overflow-hidden"
                      >
                        <div className="flex justify-between items-start gap-2 px-3 py-2 bg-content2/30 flex-wrap">
                          <div className="flex flex-col leading-tight min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {g.key.name}
                              </span>
                              <Chip
                                size="sm"
                                variant="flat"
                                classNames={{
                                  base: "h-5",
                                  content: "text-[11px] px-1.5",
                                }}
                              >
                                {g.key.groupName}
                              </Chip>
                              {g.key.hasExclusiveRate ? (
                                <Chip
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  classNames={{
                                    base: "h-5",
                                    content: "text-[11px] px-1.5",
                                  }}
                                >
                                  专属 ×{g.key.effectiveRateMultiplier}
                                </Chip>
                              ) : (
                                <span className="text-[11px] text-default-500">
                                  ×{g.key.groupRateMultiplier}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-default-400 font-mono mt-0.5">
                              {g.key.keyMasked}
                            </span>
                          </div>
                          <Chip
                            size="sm"
                            variant="flat"
                            classNames={{
                              base: "h-5",
                              content: "text-[11px] px-1.5",
                            }}
                          >
                            {g.rows.length} 绑定
                          </Chip>
                        </div>
                        <div>
                          {g.rows.map((b, idx) => (
                            <div
                              key={b.id}
                              className={`flex items-center justify-between gap-2 px-3 py-2 ${
                                idx > 0
                                  ? "border-t border-divider/30"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="text-sm font-medium truncate">
                                  {b.siteBoundAccount.siteAccount.name}
                                </span>
                                <span className="text-default-400">/</span>
                                <span className="text-sm truncate">
                                  {b.siteBoundAccount.name}
                                </span>
                                <Chip
                                  size="sm"
                                  variant="flat"
                                  classNames={{
                                    base: "h-5",
                                    content: "text-[11px] px-1.5",
                                  }}
                                >
                                  ×{b.siteBoundAccount.rateMultiplier}
                                </Chip>
                                {b.maxConcurrency != null && (
                                  <Chip
                                    size="sm"
                                    variant="flat"
                                    color="primary"
                                    classNames={{
                                      base: "h-5",
                                      content: "text-[11px] px-1.5",
                                    }}
                                  >
                                    max {b.maxConcurrency}
                                  </Chip>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="light"
                                  className="h-7 min-w-0 px-2"
                                  onPress={() => {
                                    setEditing(b);
                                    setEditMax(
                                      b.maxConcurrency != null
                                        ? String(b.maxConcurrency)
                                        : "",
                                    );
                                    editDlg.onOpen();
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="sm"
                                  color="danger"
                                  variant="light"
                                  className="h-7 min-w-0 px-2"
                                  onPress={() => remove(b.id)}
                                >
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </CardBody>
              </Card>
            ))}
          </div>
        );
      })()}

      <Modal isOpen={dlg.isOpen} onClose={dlg.onClose} size="2xl">
        <ModalContent>
          <ModalHeader>新增绑定</ModalHeader>
          <ModalBody className="gap-3">
            {!opts ||
            opts.siteBoundAccounts.length === 0 ||
            opts.upstreamKeys.length === 0 ? (
              <p className="text-default-500">
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
                  <div className="flex flex-col gap-2 p-3 rounded-lg bg-content2/50">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-xs text-default-500 mt-1 w-16 shrink-0">
                        本站站点
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Chip
                          size="sm"
                          variant={parentSiteIds.size === 0 ? "solid" : "flat"}
                          color={
                            parentSiteIds.size === 0 ? "primary" : "default"
                          }
                          className="cursor-pointer"
                          onClick={() => setParentSiteIds(new Set())}
                        >
                          全部
                        </Chip>
                        {[...siteParents.entries()].map(([id, name]) => {
                          const sel = parentSiteIds.has(String(id));
                          return (
                            <Chip
                              key={id}
                              size="sm"
                              variant={sel ? "solid" : "flat"}
                              color={sel ? "primary" : "default"}
                              className="cursor-pointer"
                              onClick={() => {
                                const next = new Set(parentSiteIds);
                                if (sel) next.delete(String(id));
                                else next.add(String(id));
                                setParentSiteIds(next);
                              }}
                            >
                              {name}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-xs text-default-500 mt-1 w-16 shrink-0">
                        上游账号
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Chip
                          size="sm"
                          variant={
                            parentUpstreamIds.size === 0 ? "solid" : "flat"
                          }
                          color={
                            parentUpstreamIds.size === 0 ? "primary" : "default"
                          }
                          className="cursor-pointer"
                          onClick={() => setParentUpstreamIds(new Set())}
                        >
                          全部
                        </Chip>
                        {[...upParents.entries()].map(([id, name]) => {
                          const sel = parentUpstreamIds.has(String(id));
                          return (
                            <Chip
                              key={id}
                              size="sm"
                              variant={sel ? "solid" : "flat"}
                              color={sel ? "primary" : "default"}
                              className="cursor-pointer"
                              onClick={() => {
                                const next = new Set(parentUpstreamIds);
                                if (sel) next.delete(String(id));
                                else next.add(String(id));
                                setParentUpstreamIds(next);
                              }}
                            >
                              {name}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-4 flex-wrap">
                      <Checkbox
                        size="sm"
                        isSelected={showBoundSite}
                        onValueChange={setShowBoundSite}
                      >
                        显示已绑定的本站账号
                      </Checkbox>
                      <Checkbox
                        size="sm"
                        isSelected={showZero}
                        onValueChange={setShowZero}
                      >
                        显示今日 0 消费的账号 / Key
                      </Checkbox>
                      <Checkbox
                        size="sm"
                        isSelected={showAzAccounts}
                        onValueChange={setShowAzAccounts}
                      >
                        显示 az 账号
                      </Checkbox>
                    </div>
                    <span className="text-xs text-default-500">
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
                  <Select
                    label="本站账号"
                    placeholder="可多选"
                    selectionMode="multiple"
                    isMultiline
                    selectedKeys={siteIds}
                    onSelectionChange={(k) =>
                      setSiteIds(
                        new Set(Array.from(k as Set<React.Key>).map(String)),
                      )
                    }
                    description={`已选 ${siteIds.size} 个 · 候选 ${siteList.length}`}
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
                    {siteList.map((o) => {
                      // When user has filtered to a single 本站站点, the parent
                      // name in the label is redundant — strip the prefix.
                      const showShort =
                        parentSiteIds.size === 1 && !!o.siteAccountName;
                      const prefix = `${o.siteAccountName} / `;
                      const display =
                        showShort && o.label.startsWith(prefix)
                          ? o.label.slice(prefix.length)
                          : o.label;
                      return (
                        <SelectItem key={String(o.id)} textValue={display}>
                          {display}
                        </SelectItem>
                      );
                    })}
                  </Select>
                  <Select
                    label="上游 Key"
                    placeholder="可多选"
                    selectionMode="multiple"
                    isMultiline
                    selectedKeys={keyIds}
                    onSelectionChange={(k) =>
                      setKeyIds(
                        new Set(Array.from(k as Set<React.Key>).map(String)),
                      )
                    }
                    description={`已选 ${keyIds.size} 个 · 候选 ${keyList.length} · 将创建 ${siteIds.size * keyIds.size} 条绑定`}
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
                    {keyList.map((o) => {
                      const showShort =
                        parentUpstreamIds.size === 1 && !!o.upstreamAccountName;
                      const prefix = `${o.upstreamAccountName} / `;
                      const display =
                        showShort && o.label.startsWith(prefix)
                          ? o.label.slice(prefix.length)
                          : o.label;
                      return (
                        <SelectItem key={String(o.id)} textValue={display}>
                          {display}
                        </SelectItem>
                      );
                    })}
                  </Select>
                </>
              );
            })()}
            <Input
              type="number"
              size="sm"
              label="上游 key 最大并发（可选）"
              description="每条新建的绑定都会写入这个值，用于资源调度页的容量提示。留空表示不设上限。"
              placeholder="例如 600"
              value={newMaxConcurrency}
              onValueChange={setNewMaxConcurrency}
              min={0}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={dlg.onClose}>
              取消
            </Button>
            <Button color="primary" onPress={add}>
              添加
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={editDlg.isOpen} onClose={editDlg.onClose}>
        <ModalContent>
          <ModalHeader>编辑绑定</ModalHeader>
          <ModalBody className="gap-3">
            {editing && (
              <>
                <div className="text-sm text-default-500 leading-relaxed">
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
                <Input
                  type="number"
                  label="最大并发"
                  description="留空清除上限"
                  value={editMax}
                  onValueChange={setEditMax}
                  min={0}
                />
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={editDlg.onClose}>
              取消
            </Button>
            <Button
              color="primary"
              onPress={async () => {
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
                  addToast({ title: "保存失败", color: "danger" });
                  return;
                }
                addToast({ title: "已保存", color: "success" });
                editDlg.onClose();
                await load();
              }}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Shell>
  );
}
