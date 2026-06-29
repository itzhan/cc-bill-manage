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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, TestTube2, X } from "lucide-react";
import { toast } from "sonner";
import { type GroupRow, type AccountRow } from "../_types";

/** Credentials block — displays base_url + api_key with copy/reveal */
function ChannelCredsBlock({
  creds,
  loading,
  reveal,
  setReveal,
}: {
  creds: { baseUrl: string; apiKey: string } | null;
  loading: boolean;
  reveal: boolean;
  setReveal: (v: boolean) => void;
}) {
  async function copy(text: string, label: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 已复制`);
    } catch {
      toast.error(`${label} 复制失败`);
    }
  }

  const masked = creds?.apiKey
    ? creds.apiKey.length > 8
      ? `${creds.apiKey.slice(0, 4)}…${creds.apiKey.slice(-4)}`
      : "*".repeat(creds.apiKey.length)
    : "";

  return (
    <div className="rounded-lg border border-border/50 p-2.5 bg-muted/30 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground shrink-0 w-10">
          URL
        </span>
        <code
          className="font-mono text-xs flex-1 truncate"
          title={creds?.baseUrl ?? ""}
        >
          {loading ? "加载中…" : creds?.baseUrl || "—"}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6"
          disabled={!creds?.baseUrl}
          onClick={() => creds && copy(creds.baseUrl, "URL")}
          title="复制 URL"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground shrink-0 w-10">
          Key
        </span>
        <code className="font-mono text-xs flex-1 truncate">
          {loading
            ? "加载中…"
            : !creds?.apiKey
              ? "—"
              : reveal
                ? creds.apiKey
                : masked}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6"
          disabled={!creds?.apiKey}
          onClick={() => setReveal(!reveal)}
          title={reveal ? "隐藏" : "显示完整 key"}
        >
          {reveal ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
              <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
              <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
              <path d="m2 2 20 20" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6"
          disabled={!creds?.apiKey}
          onClick={() => creds && copy(creds.apiKey, "API Key")}
          title="复制完整 key"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

/** Multi-select group popover using checkboxes */
function GroupMultiSelect({
  groups,
  selectedIds,
  onChange,
}: {
  groups: GroupRow[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <Label>分组</Label>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start font-normal h-auto min-h-9 py-2"
          >
            {selectedIds.size === 0 ? (
              <span className="text-muted-foreground">选择分组…</span>
            ) : (
              <span>
                已选 {selectedIds.size} 个 / 候选 {groups.length}
              </span>
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
                  checked={selectedIds.has(id)}
                  onCheckedChange={() => toggle(id)}
                />
                <span>{g.name} (&times;{g.rate_multiplier})</span>
              </label>
            );
          })}
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">暂无分组</p>
          )}
        </PopoverContent>
      </Popover>
      {/* Show selected chips */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {groups
            .filter((g) => selectedIds.has(String(g.id)))
            .map((g) => (
              <Badge key={g.id} variant="secondary" className="text-xs">
                {g.name} (&times;{g.rate_multiplier})
              </Badge>
            ))}
        </div>
      )}
    </div>
  );
}

export function EditChannelDialog({
  open,
  onOpenChange,
  editAcc,
  editCreds,
  editCredsLoading,
  editKeyRevealed,
  setEditKeyRevealed,
  editActive,
  setEditActive,
  editSchedulable,
  setEditSchedulable,
  editConcurrency,
  setEditConcurrency,
  editPriority,
  setEditPriority,
  editGroupIds,
  setEditGroupIds,
  editNotes,
  setEditNotes,
  editModels,
  setEditModels,
  editModelsLoading,
  editModelsInitial,
  editModelInput,
  setEditModelInput,
  editTestModel,
  setEditTestModel,
  groups,
  concurrency,
  siteId,
  busyAcc,
  patchAccount,
  testAccount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editAcc: AccountRow | null;
  editCreds: { baseUrl: string; apiKey: string } | null;
  editCredsLoading: boolean;
  editKeyRevealed: boolean;
  setEditKeyRevealed: (v: boolean) => void;
  editActive: boolean;
  setEditActive: (v: boolean) => void;
  editSchedulable: boolean;
  setEditSchedulable: (v: boolean) => void;
  editConcurrency: string;
  setEditConcurrency: (v: string) => void;
  editPriority: string;
  setEditPriority: (v: string) => void;
  editGroupIds: Set<string>;
  setEditGroupIds: (v: Set<string>) => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  editModels: string[];
  setEditModels: (v: string[]) => void;
  editModelsLoading: boolean;
  editModelsInitial: string[];
  editModelInput: string;
  setEditModelInput: (v: string) => void;
  editTestModel: string;
  setEditTestModel: (v: string) => void;
  groups: GroupRow[];
  concurrency: { account?: Record<string, { current_in_use: number }> };
  siteId: number | null;
  busyAcc: number | null;
  patchAccount: (
    id: number,
    data: Record<string, unknown>,
  ) => Promise<void>;
  testAccount: (id: number, model?: string) => void;
}) {
  const saving = busyAcc === editAcc?.id;

  async function handleSave() {
    if (!editAcc || siteId == null) return;
    const c = Number(editConcurrency);
    const p = Number(editPriority);

    // schedulable lives on a dedicated sub2api endpoint
    if ((editAcc.schedulable !== false) !== editSchedulable) {
      await fetch(
        `/api/scheduling/${siteId}/channels/${editAcc.id}/schedulable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedulable: editSchedulable }),
        },
      );
    }

    await patchAccount(editAcc.id, {
      status: editActive ? "active" : "inactive",
      concurrency:
        Number.isFinite(c) && c >= 0
          ? Math.floor(c)
          : (editAcc.concurrency ?? 0),
      priority:
        Number.isFinite(p) && p >= 0
          ? Math.floor(p)
          : (editAcc.priority ?? 0),
      group_ids: Array.from(editGroupIds).map(Number),
      notes: editNotes || null,
    });

    // Models stored under credentials.model_mapping
    const modelsChanged =
      editModels.length !== editModelsInitial.length ||
      editModels.some((m, i) => m !== editModelsInitial[i]);
    if (modelsChanged) {
      const r = await fetch(
        `/api/scheduling/${siteId}/channels/${editAcc.id}/models`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ models: editModels }),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("模型保存失败", { description: j.error });
        return;
      }
    }

    onOpenChange(false);
  }

  function addModel() {
    const v = editModelInput.trim();
    if (v && !editModels.includes(v)) {
      setEditModels([...editModels, v]);
    }
    setEditModelInput("");
  }

  // Built-in suggestions + the channel's whitelisted models, deduped.
  const modelSuggestions = (() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const m of [
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      ...editModels,
    ]) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      list.push(m);
    }
    return list;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            编辑渠道{editAcc ? ` · ${editAcc.name}` : ""}
          </DialogTitle>
        </DialogHeader>

        {editAcc && (
          <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
            <ChannelCredsBlock
              creds={editCreds}
              loading={editCredsLoading}
              reveal={editKeyRevealed}
              setReveal={setEditKeyRevealed}
            />

            {/* Status switch */}
            <div className="flex items-center justify-between">
              <span className="text-sm">启用 (status)</span>
              <Switch
                checked={editActive}
                onCheckedChange={setEditActive}
              />
            </div>

            {/* Schedulable switch */}
            <div className="flex items-center justify-between">
              <span className="text-sm">参与调度</span>
              <Switch
                checked={editSchedulable}
                onCheckedChange={setEditSchedulable}
              />
            </div>

            {/* Concurrency */}
            <div className="space-y-1">
              <Label>并发上限</Label>
              <Input
                type="number"
                min={0}
                value={editConcurrency}
                onChange={(e) => setEditConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                实时使用：
                {concurrency.account?.[String(editAcc.id)]?.current_in_use ?? 0}
              </p>
            </div>

            {/* Priority */}
            <div className="space-y-1">
              <Label>优先级</Label>
              <Input
                type="number"
                min={0}
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                数字越小越靠前；同优先级随机调度
              </p>
            </div>

            {/* Group multi-select */}
            <GroupMultiSelect
              groups={groups}
              selectedIds={editGroupIds}
              onChange={setEditGroupIds}
            />

            {/* Notes */}
            <div className="space-y-1">
              <Label>备注</Label>
              <Textarea
                placeholder="渠道说明 / 续费日期 / 联系人 等"
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>

            {/* Model whitelist */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">
                  可用模型
                  {editModelsLoading && (
                    <span className="ml-1 text-muted-foreground/70">
                      · 加载中…
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {editModels.length === 0
                    ? "空 = 未限制（不传 model_mapping）"
                    : `${editModels.length} 个`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
                {editModels.length === 0 ? (
                  <span className="text-xs text-muted-foreground/70 italic">
                    {editModelsLoading
                      ? "—"
                      : "暂无（保存后该渠道允许全部模型）"}
                  </span>
                ) : (
                  editModels.map((m) => (
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
                          setEditModels(editModels.filter((x) => x !== m))
                        }
                      >
                        <X size={12} />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="claude-opus-4-7"
                  value={editModelInput}
                  onChange={(e) => setEditModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addModel();
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addModel}
                  disabled={!editModelInput.trim()}
                >
                  添加
                </Button>
              </div>
            </div>

            {/* Test model */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <Label>测试用模型</Label>
                <Input
                  placeholder="claude-opus-4-6"
                  value={editTestModel}
                  onChange={(e) => setEditTestModel(e.target.value)}
                  list="edit-test-model-suggestions"
                />
                <datalist id="edit-test-model-suggestions">
                  {modelSuggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="text-[11px] text-muted-foreground/70">
                  默认 claude-opus-4-6；下拉里是常用模型 + 该渠道可用模型
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mb-0.5"
                onClick={() =>
                  testAccount(
                    editAcc.id,
                    editTestModel.trim() || undefined,
                  )
                }
              >
                <TestTube2 size={14} />
                测试此渠道
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
