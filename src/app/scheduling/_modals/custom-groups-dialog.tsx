"use client";

import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type GroupRow, type CustomGroupRow } from "../_types";

export function CustomGroupsDialog({
  open,
  onOpenChange,
  siteId,
  groups,
  items,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  siteId: number | null;
  groups: GroupRow[];
  items: CustomGroupRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CustomGroupRow | null>(null);
  const [name, setName] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);

  function startNew() {
    setEditing(null);
    setName("");
    setPickedIds(new Set());
  }

  function startEdit(cg: CustomGroupRow) {
    setEditing(cg);
    setName(cg.name);
    setPickedIds(new Set(cg.groupIds.map(String)));
  }

  function toggleGroup(id: string) {
    const next = new Set(pickedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPickedIds(next);
  }

  async function submit() {
    if (siteId == null) return;
    const ids = [...pickedIds]
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    if (!name.trim() || ids.length === 0) {
      toast.warning("请填写名称并至少选 1 个分组");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const r = await fetch(
          `/api/scheduling/custom-groups/${editing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim(), groupIds: ids }),
          },
        );
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast.error("保存失败", { description: j.error });
          return;
        }
        toast.success("已保存");
      } else {
        const r = await fetch(`/api/scheduling/custom-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteAccountId: siteId,
            name: name.trim(),
            groupIds: ids,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast.error("创建失败", { description: j.error });
          return;
        }
        toast.success("已创建");
      }
      startNew();
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(cg: CustomGroupRow) {
    if (!confirm(`删除自定义分组「${cg.name}」？（不影响原始分组）`)) return;
    const r = await fetch(`/api/scheduling/custom-groups/${cg.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      toast.error("删除失败");
      return;
    }
    toast.success("已删除");
    if (editing?.id === cg.id) startNew();
    await onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={16} /> 自定义分组
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Existing list */}
          <div>
            <div className="text-xs text-muted-foreground mb-2">
              已有自定义分组（{items.length}）
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 italic">
                还没有自定义分组。下方填写名称 + 选原始分组创建。
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((cg) => {
                  const memberNames = groups
                    .filter((g) => cg.groupIds.includes(g.id))
                    .map((g) => g.name)
                    .join("、");
                  return (
                    <div
                      key={cg.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{cg.name}</div>
                        <div className="text-[11px] text-muted-foreground/70 truncate">
                          {memberNames || "(无成员)"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEdit(cg)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => remove(cg)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form */}
          <div className="border-t border-border/40 pt-3">
            <div className="text-xs text-muted-foreground mb-2">
              {editing ? `编辑「${editing.name}」` : "新建自定义分组"}
            </div>
            <div className="flex flex-col gap-3">
              <div className="space-y-1">
                <Label>名称</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Group multi-select */}
              <div className="space-y-1">
                <Label>包含的原始分组（多选）</Label>
                <Popover
                  open={groupPopoverOpen}
                  onOpenChange={setGroupPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start font-normal h-auto min-h-9 py-2"
                    >
                      {pickedIds.size === 0 ? (
                        <span className="text-muted-foreground">
                          选择分组…
                        </span>
                      ) : (
                        <span>已选 {pickedIds.size} 个</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 max-h-60 overflow-y-auto p-2">
                    {groups.map((g) => {
                      const id = String(g.id);
                      return (
                        <label
                          key={id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                        >
                          <Checkbox
                            checked={pickedIds.has(id)}
                            onCheckedChange={() => toggleGroup(id)}
                          />
                          <span>
                            {g.name} (&times;{g.rate_multiplier})
                          </span>
                        </label>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={submitting}
                  onClick={submit}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editing ? (
                    <Pencil size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {editing ? "保存修改" : "创建"}
                </Button>
                {editing && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={startNew}
                  >
                    取消编辑
                  </Button>
                )}
              </div>
            </div>
          </div>
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
