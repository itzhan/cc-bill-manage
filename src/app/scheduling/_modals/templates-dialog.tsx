"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { type TemplateRow } from "../_types";

export function TemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [editing, setEditing] = useState<Partial<TemplateRow> | null>(null);

  async function load() {
    const r = await fetch("/api/scheduling/templates", { cache: "no-store" });
    const j = await r.json();
    setItems(j.items || []);
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  function startNew() {
    setEditing({
      name: "",
      platform: "anthropic",
      type: "apikey",
      rateMultiplier: 1,
      groupIds: "[]",
      modelList: "[]",
    });
  }

  async function save() {
    if (!editing || !editing.name) {
      toast.warning("name 必填");
      return;
    }
    let groupIds: number[] = [];
    let modelList: string[] = [];
    try {
      groupIds = JSON.parse(editing.groupIds || "[]");
      modelList = JSON.parse(editing.modelList || "[]");
    } catch {
      toast.error("groupIds/modelList 必须是合法 JSON 数组");
      return;
    }
    const payload = {
      ...editing,
      groupIds,
      modelList,
    };
    const r =
      editing.id != null
        ? await fetch(`/api/scheduling/templates/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/scheduling/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    if (!r.ok) {
      toast.error("保存失败");
      return;
    }
    setEditing(null);
    await load();
  }

  async function del(id: number) {
    if (!confirm("删除此模板？")) return;
    await fetch(`/api/scheduling/templates/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>模板管理</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">列表 ({items.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="list">
              <div className="pt-2 space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={startNew}
                >
                  + 新建模板
                </Button>
                {items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">暂无模板</p>
                ) : (
                  items.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/40 text-sm"
                    >
                      <div>
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground/70 ml-2">
                          {t.platform} / {t.type} · &times;{t.rateMultiplier}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditing(t)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => del(t.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>

          {editing && (
            <div className="mt-4 p-3 rounded-lg border border-border/40 space-y-2">
              <div className="space-y-1">
                <Label>名称</Label>
                <Input
                  value={editing.name ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>platform</Label>
                  <Input
                    value={editing.platform ?? "anthropic"}
                    onChange={(e) =>
                      setEditing({ ...editing, platform: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>type</Label>
                  <Input
                    value={editing.type ?? "apikey"}
                    onChange={(e) =>
                      setEditing({ ...editing, type: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>rate_multiplier</Label>
                <Input
                  type="number"
                  value={String(editing.rateMultiplier ?? 1)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      rateMultiplier: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>groupIds (JSON 数字数组)</Label>
                <Textarea
                  placeholder="[1, 2, 3]"
                  value={editing.groupIds ?? "[]"}
                  onChange={(e) =>
                    setEditing({ ...editing, groupIds: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>modelList (JSON 字符串数组)</Label>
                <Textarea
                  placeholder='["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]'
                  value={editing.modelList ?? "[]"}
                  onChange={(e) =>
                    setEditing({ ...editing, modelList: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>备注</Label>
                <Textarea
                  value={editing.notes ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      notes: e.target.value || null,
                    })
                  }
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button size="sm" onClick={save}>
                  保存
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
