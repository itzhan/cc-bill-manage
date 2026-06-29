"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { BookOpen, Plus, Server, Building2, ArrowRight, Trash2, Loader2 } from "lucide-react";
import Link from "next/link";
import { fmtMoneyShort } from "@/lib/format";

interface Ledger {
  id: number;
  name: string;
  createdAt: string;
  upstreamLinks: { upstreamAccount: { id: number; name: string } }[];
  siteLinks: { siteAccount: { id: number; name: string } }[];
  _count: { fixedCosts: number };
}

export default function LedgerListPage() {
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Record<number, {
    today: { cost: number; revenue: number; fixedCost: number; profit: number };
  }>>({});

  const [open, setOpen] = useState(false);
  const onOpen = () => setOpen(true);
  const onClose = () => setOpen(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/ledger");
      const data = await r.json();
      setLedgers(data);
      for (const l of data) {
        fetch(`/api/ledger/${l.id}/summary?days=1`)
          .then((r) => r.json())
          .then((s) => setSummaries((prev) => ({ ...prev, [l.id]: s })));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!r.ok) throw new Error("创建失败");
      toast.success("已创建");
      setNewName("");
      onClose();
      load();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除此账本项目？")) return;
    await fetch(`/api/ledger/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">账本</h1>
          <p className="text-sm text-muted-foreground mt-1">
            创建项目，跟踪成本、收入与利润
          </p>
        </div>
        <Button onClick={onOpen}>
          <Plus size={16} />
          新建项目
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : ledgers.length === 0 ? (
        <Card className="rounded-xl">
          <CardContent className="py-16 text-center text-muted-foreground/70">
            <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
            <p>还没有账本项目</p>
            <p className="text-sm mt-1">点击右上角「新建项目」开始记账</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ledgers.map((l) => {
            const s = summaries[l.id];
            return (
              <Card key={l.id} className="group rounded-xl hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <Link href={`/ledger/${l.id}`} className="block p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-base">{l.name}</h3>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/70">
                          {l.upstreamLinks.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Server size={12} />
                              {l.upstreamLinks.length} 个渠道
                            </span>
                          )}
                          {l.siteLinks.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Building2 size={12} />
                              {l.siteLinks.length} 个站点
                            </span>
                          )}
                          {l._count.fixedCosts > 0 && (
                            <span>{l._count.fixedCosts} 项固定成本</span>
                          )}
                        </div>
                      </div>
                      <ArrowRight
                        size={16}
                        className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors mt-1"
                      />
                    </div>

                    {s && (
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-border">
                        <div>
                          <p className="text-[11px] text-muted-foreground/70">今日成本</p>
                          <p className="text-sm font-medium text-destructive">
                            {fmtMoneyShort(s.today.cost + s.today.fixedCost)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground/70">今日收入</p>
                          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                            {fmtMoneyShort(s.today.revenue)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground/70">今日利润</p>
                          <p
                            className={`text-sm font-medium ${
                              s.today.profit >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive"
                            }`}
                          >
                            {fmtMoneyShort(s.today.profit)}
                          </p>
                        </div>
                      </div>
                    )}
                  </Link>
                  <div className="px-4 pb-3 flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-8 w-8"
                      onClick={() => remove(l.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建账本项目</DialogTitle>
            <DialogDescription className="sr-only">创建一个新的账本项目</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>项目名称</Label>
            <Input
              placeholder="如：主站运营、Claude 中转"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={create}
              disabled={!newName.trim() || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
