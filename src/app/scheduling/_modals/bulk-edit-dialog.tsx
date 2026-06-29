"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BulkDraft {
  status: "" | "active" | "inactive";
  schedulable: "" | "true" | "false";
  concurrency: string;
  priority: string;
  rateMultiplier: string;
}

const EMPTY_DRAFT: BulkDraft = {
  status: "",
  schedulable: "",
  concurrency: "",
  priority: "",
  rateMultiplier: "",
};

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onApply: (patch: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}

export function BulkEditDialog({
  open,
  onOpenChange,
  selectedCount,
  onApply,
  busy,
}: BulkEditDialogProps) {
  const [draft, setDraft] = useState<BulkDraft>(EMPTY_DRAFT);

  function handleOpenChange(v: boolean) {
    if (!v) setDraft(EMPTY_DRAFT);
    onOpenChange(v);
  }

  function handleApply() {
    const patch: Record<string, unknown> = {};
    if (draft.status) patch.status = draft.status;
    if (draft.schedulable) {
      patch.schedulable = draft.schedulable === "true";
    }
    if (draft.concurrency.trim() !== "") {
      const n = Math.floor(Number(draft.concurrency));
      if (!Number.isFinite(n) || n < 0) {
        toast.warning("并发数非法");
        return;
      }
      patch.concurrency = n;
    }
    if (draft.priority.trim() !== "") {
      const n = Math.floor(Number(draft.priority));
      if (!Number.isFinite(n)) {
        toast.warning("优先级非法");
        return;
      }
      patch.priority = n;
    }
    if (draft.rateMultiplier.trim() !== "") {
      const n = Number(draft.rateMultiplier);
      if (!Number.isFinite(n) || n < 0) {
        toast.warning("倍率非法");
        return;
      }
      patch.rateMultiplier = n;
    }
    if (Object.keys(patch).length === 0) {
      toast.warning("没有要修改的字段");
      return;
    }
    onApply(patch);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量编辑账号</DialogTitle>
          <DialogDescription>
            将对选中的 {selectedCount} 个账号生效 · 留空字段表示不修改
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">状态</Label>
            <Select
              value={draft.status || "__noop"}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  status:
                    v === "active" || v === "inactive" ? v : "",
                }))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__noop">不修改</SelectItem>
                <SelectItem value="active">启用 (active)</SelectItem>
                <SelectItem value="inactive">禁用 (inactive)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">调度</Label>
            <Select
              value={draft.schedulable || "__noop"}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  schedulable:
                    v === "true" || v === "false" ? v : "",
                }))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__noop">不修改</SelectItem>
                <SelectItem value="true">纳入调度</SelectItem>
                <SelectItem value="false">移出调度</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">并发数 (concurrency)</Label>
            <Input
              type="number"
              className="h-8"
              placeholder="留空 = 不修改; 0 = 不限并发"
              min={0}
              value={draft.concurrency}
              onChange={(e) =>
                setDraft((d) => ({ ...d, concurrency: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">优先级 (priority)</Label>
            <Input
              type="number"
              className="h-8"
              placeholder="留空 = 不修改"
              value={draft.priority}
              onChange={(e) =>
                setDraft((d) => ({ ...d, priority: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">倍率 (rate_multiplier)</Label>
            <Input
              type="number"
              className="h-8"
              step="0.01"
              placeholder="留空 = 不修改; 例如 1, 1.5"
              value={draft.rateMultiplier}
              onChange={(e) =>
                setDraft((d) => ({ ...d, rateMultiplier: e.target.value }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            应用到 {selectedCount} 个账号
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
