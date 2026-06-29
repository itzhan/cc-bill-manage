"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import SmartDispatchPanel from "@/components/SmartDispatchPanel";

export function SmartDispatchDialog({
  open,
  onOpenChange,
  siteId,
  scope,
  excludeList,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  siteId: number | null;
  scope: { groupIds: number[]; label: string } | null;
  excludeList: string[];
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <span>智能调度</span>
            {scope && (
              <Badge variant="secondary">{scope.label}</Badge>
            )}
            {scope && scope.groupIds.length > 1 && (
              <Badge variant="outline">{scope.groupIds.length} 个分组</Badge>
            )}
            {excludeList.length > 0 && (
              <Badge variant="outline">
                已套用 {excludeList.length} 条排除前缀
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pt-0">
          {scope && siteId != null ? (
            <SmartDispatchPanel
              siteId={siteId}
              groupIds={scope.groupIds}
              excludeList={excludeList}
              onChanged={onChanged}
            />
          ) : (
            <p className="text-muted-foreground text-sm py-4">未选择分组</p>
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
