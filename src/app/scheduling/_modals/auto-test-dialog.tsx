"use client";

import { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";

const MODEL_PRESETS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

interface AutoTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  /** Current persisted values to initialize draft */
  initialEnabled: boolean;
  initialIntervalMin: number;
  initialModel: string;
  minMinutes: number;
  defaultModel: string;
  onSave: (enabled: boolean, intervalMin: number, model: string) => void;
}

export function AutoTestDialog({
  open,
  onOpenChange,
  groupName,
  initialEnabled,
  initialIntervalMin,
  initialModel,
  minMinutes,
  defaultModel,
  onSave,
}: AutoTestDialogProps) {
  const [draftEnabled, setDraftEnabled] = useState(initialEnabled);
  const [draftIntervalMin, setDraftIntervalMin] = useState(initialIntervalMin);
  const [draftModel, setDraftModel] = useState(initialModel);

  // Sync draft when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setDraftEnabled(initialEnabled);
      setDraftIntervalMin(initialIntervalMin);
      setDraftModel(initialModel);
    }
  }, [open, initialEnabled, initialIntervalMin, initialModel]);

  function handleSave() {
    const m = draftModel.trim() || defaultModel;
    onSave(draftEnabled, draftIntervalMin, m);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>分组可用性自动检测</DialogTitle>
          <DialogDescription>分组「{groupName}」</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-3">
            <Switch
              checked={draftEnabled}
              onCheckedChange={setDraftEnabled}
              id="auto-test-switch"
            />
            <Label htmlFor="auto-test-switch">启用自动检测</Label>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">检测间隔（分钟）</Label>
            <Input
              type="number"
              className="h-8"
              min={minMinutes}
              value={String(draftIntervalMin)}
              onChange={(e) => {
                const n = Math.max(
                  minMinutes,
                  Math.floor(Number(e.target.value) || minMinutes),
                );
                setDraftIntervalMin(n);
              }}
            />
            <p className="text-xs text-muted-foreground">
              每隔 N 分钟对本分组所有账号发起一次测试，单测 30 秒超时。最小 {minMinutes} 分钟。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">测试模型</Label>
            <Input
              className="h-8"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              list="model-presets"
              placeholder="输入 model id 或从下拉选择"
            />
            <datalist id="model-presets">
              {MODEL_PRESETS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              自动检测 + 手动「一键测试」都会用这个模型。可输入自定义 model id。
            </p>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            当本分组所有账号在一次检测中全部失败时，将按「设置」页配置的
            发件邮箱与收件人发送邮件提醒；同一分组在冷却窗口（设置页
            「冷却分钟数」）内不会重复发送。
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
