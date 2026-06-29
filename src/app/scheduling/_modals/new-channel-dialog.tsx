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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { type GroupRow, type TemplateRow } from "../_types";

export function NewChannelDialog({
  open,
  onOpenChange,
  siteId,
  groups,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  siteId: number | null;
  groups: GroupRow[];
  onCreated: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [tplId, setTplId] = useState<string>("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrencyV] = useState("20");
  const [priority, setPriority] = useState("1");
  const [rateMul, setRateMul] = useState("1");
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/scheduling/templates")
      .then((r) => r.json())
      .then((j) => setTemplates(j.items || []));
  }, [open]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => String(x.id) === id);
    setTplId(id);
    if (!t) return;
    try {
      setGroupSel(
        new Set(((JSON.parse(t.groupIds) as number[]) || []).map(String)),
      );
    } catch {
      setGroupSel(new Set());
    }
    try {
      setModels((JSON.parse(t.modelList) as string[]) || []);
    } catch {
      setModels([]);
    }
    setRateMul(String(t.rateMultiplier));
  }

  function toggleGroup(id: string) {
    const next = new Set(groupSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroupSel(next);
  }

  async function submit() {
    if (siteId == null) return;
    if (!name || !baseUrl || !apiKey) {
      toast.warning("名称 / Base URL / Key 必填");
      return;
    }
    const tpl = templates.find((x) => String(x.id) === tplId);
    const body = {
      name,
      platform: tpl?.platform ?? "anthropic",
      type: tpl?.type ?? "apikey",
      credentials: {
        base_url: baseUrl,
        api_key: apiKey,
        ...(models.length
          ? {
              model_mapping: Object.fromEntries(models.map((m) => [m, m])),
            }
          : {}),
      },
      concurrency: Math.max(0, Number(concurrency) || 0),
      priority: Math.max(0, Number(priority) || 0),
      rate_multiplier: Number(rateMul) || 1,
      group_ids: Array.from(groupSel).map(Number),
      confirm_mixed_channel_risk: tpl?.confirmMixedChannelRisk ?? true,
    };
    setSubmitting(true);
    try {
      const r = await fetch(`/api/scheduling/${siteId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error("创建失败", { description: j.error });
        return;
      }
      toast.success("已创建");
      setName("");
      setBaseUrl("");
      setApiKey("");
      onOpenChange(false);
      await onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增渠道</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {/* Template select */}
          <div className="space-y-1">
            <Label>模板（可选）</Label>
            <Select
              value={tplId}
              onValueChange={(v) => {
                if (v) applyTemplate(v);
                else setTplId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="不使用模板" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={String(t.id)} value={String(t.id)}>
                    {t.name} · {t.platform}/{t.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label>
              名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <Label>
              Base URL <span className="text-destructive">*</span>
            </Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <Label>
              API Key <span className="text-destructive">*</span>
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          {/* Numeric fields row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>并发</Label>
              <Input
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrencyV(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>优先级</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>rate &times; 倍率</Label>
              <Input
                type="number"
                value={rateMul}
                onChange={(e) => setRateMul(e.target.value)}
              />
            </div>
          </div>

          {/* Group multi-select */}
          <div className="space-y-1">
            <Label>分组</Label>
            <Popover open={groupPopoverOpen} onOpenChange={setGroupPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start font-normal h-auto min-h-9 py-2"
                >
                  {groupSel.size === 0 ? (
                    <span className="text-muted-foreground">选择分组…</span>
                  ) : (
                    <span>已选 {groupSel.size} 个</span>
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
                        checked={groupSel.has(id)}
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

          {/* Model whitelist */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              模型白名单
            </div>
            <div className="flex gap-1 flex-wrap mb-2">
              {models.map((m) => (
                <Badge
                  key={m}
                  variant="secondary"
                  className="text-xs gap-1"
                >
                  {m}
                  <button
                    type="button"
                    className="ml-0.5 hover:text-destructive"
                    onClick={() =>
                      setModels(models.filter((x) => x !== m))
                    }
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))}
              {models.length === 0 && (
                <span className="text-xs text-muted-foreground/70 italic">
                  未设置（不传 model_mapping）
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="claude-sonnet-4-6"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = modelInput.trim();
                    if (v && !models.includes(v)) setModels([...models, v]);
                    setModelInput("");
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const v = modelInput.trim();
                  if (v && !models.includes(v)) setModels([...models, v]);
                  setModelInput("");
                }}
              >
                添加
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={submitting} onClick={submit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
