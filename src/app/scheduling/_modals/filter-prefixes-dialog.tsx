"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

export function FilterPrefixesDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>排除前缀（全局）</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            名字以下面任一前缀开头的账号将不显示在这里。每行一个；
            空行和以 # 开头的注释行会被忽略。大小写不敏感。
            <br />
            <span className="text-amber-600 dark:text-amber-400">
              ⚠ 服务器端保存，对所有访问者都生效。
            </span>
          </p>
          <div className="space-y-1">
            <Label>前缀列表</Label>
            <Textarea
              placeholder={"# 注释\nxxx\nxxx1\ntest-"}
              rows={6}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
