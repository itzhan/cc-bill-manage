"use client";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  useDisclosure,
  addToast,
} from "@heroui/react";
import Shell from "@/components/Shell";
import { BookOpen, Plus, Server, Building2, ArrowRight, Trash2 } from "lucide-react";
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

  const { isOpen, onOpen, onClose } = useDisclosure();
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
      addToast({ title: "已创建", color: "success" });
      setNewName("");
      onClose();
      load();
    } catch (e: unknown) {
      addToast({ title: (e as Error).message, color: "danger" });
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
          <p className="text-sm text-default-500 mt-1">
            创建项目，跟踪成本、收入与利润
          </p>
        </div>
        <Button color="primary" startContent={<Plus size={16} />} onPress={onOpen}>
          新建项目
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : ledgers.length === 0 ? (
        <Card>
          <CardBody className="py-16 text-center text-default-400">
            <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
            <p>还没有账本项目</p>
            <p className="text-sm mt-1">点击右上角「新建项目」开始记账</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ledgers.map((l) => {
            const s = summaries[l.id];
            return (
              <Card key={l.id} className="group" isPressable>
                <CardBody className="p-0">
                  <Link href={`/ledger/${l.id}`} className="block p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-base">{l.name}</h3>
                        <div className="flex items-center gap-3 mt-2 text-xs text-default-400">
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
                        className="text-default-300 group-hover:text-default-500 transition-colors mt-1"
                      />
                    </div>

                    {s && (
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-divider/50">
                        <div>
                          <p className="text-[11px] text-default-400">今日成本</p>
                          <p className="text-sm font-medium text-danger">
                            {fmtMoneyShort(s.today.cost + s.today.fixedCost)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-default-400">今日收入</p>
                          <p className="text-sm font-medium text-success">
                            {fmtMoneyShort(s.today.revenue)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-default-400">今日利润</p>
                          <p
                            className={`text-sm font-medium ${
                              s.today.profit >= 0
                                ? "text-success"
                                : "text-danger"
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
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => remove(l.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>新建账本项目</ModalHeader>
          <ModalBody>
            <Input
              label="项目名称"
              placeholder="如：主站运营、Claude 中转"
              value={newName}
              onValueChange={setNewName}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={creating}
              onPress={create}
              isDisabled={!newName.trim()}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Shell>
  );
}
