"use client";

import { Loader2, Layers, Plus, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SiteRow } from "../_types";

export interface SchedulingHeaderProps {
  sites: SiteRow[];
  siteId: number | null;
  setSiteId: (id: number) => void;
  defaultSiteId: number | null;
  onSetDefault: () => void;
  refreshing: boolean;
  structureLoading: boolean;
  onRefresh: () => void;
  onOpenTemplates: () => void;
  onOpenCustomGroups: () => void;
  onOpenNewChannel: () => void;
  cacheStamp: string | null;
  // Filter state
  statusFilter: "all" | "active" | "inactive";
  onStatusFilterChange: (v: "all" | "active" | "inactive") => void;
  showUnscheduled: boolean;
  onShowUnscheduledChange: (v: boolean) => void;
  unscheduledHiddenCount: number;
  excludeListCount: number;
  onOpenFilterPrefixes: () => void;
  hiddenCount: number;
}

export function SchedulingHeader({
  sites,
  siteId,
  setSiteId,
  defaultSiteId,
  onSetDefault,
  refreshing,
  structureLoading,
  onRefresh,
  onOpenTemplates,
  onOpenCustomGroups,
  onOpenNewChannel,
  cacheStamp,
  statusFilter,
  onStatusFilterChange,
  showUnscheduled,
  onShowUnscheduledChange,
  unscheduledHiddenCount,
  excludeListCount,
  onOpenFilterPrefixes,
  hiddenCount,
}: SchedulingHeaderProps) {
  const isLoading = refreshing || structureLoading;

  return (
    <>
      {/* Title row */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">资源调度</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            按分组聚合 · in-flight 每 2 秒刷新 · 结构数据本地缓存，点刷新更新
            {cacheStamp && (
              <span className="ml-2 text-muted-foreground/70">
                上次刷新 {new Date(cacheStamp).toLocaleString("zh-CN")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <Select
            value={siteId != null ? String(siteId) : undefined}
            onValueChange={(v) => setSiteId(Number(v))}
          >
            <SelectTrigger className="w-full sm:w-[200px] h-8 text-sm">
              <SelectValue placeholder="站点" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {siteId != null && siteId !== defaultSiteId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onSetDefault}
            >
              设为默认
            </Button>
          )}
          {siteId != null && siteId === defaultSiteId && (
            <Badge variant="default">默认</Badge>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw size={14} className="mr-1" />
            )}
            刷新
          </Button>

          <Button variant="secondary" size="sm" onClick={onOpenTemplates}>
            <SettingsIcon size={14} className="mr-1" />
            模板
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenCustomGroups}
            disabled={siteId == null}
          >
            <Layers size={14} className="mr-1" />
            自定义分组
          </Button>

          <Button size="sm" onClick={onOpenNewChannel}>
            <Plus size={14} className="mr-1" />
            新增渠道
          </Button>
        </div>
      </div>

      {/* Filters: status + name-prefix exclusion */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-muted-foreground">状态</span>
        {(
          [
            { v: "all" as const, label: "全部", activeClass: "bg-primary text-primary-foreground" },
            { v: "active" as const, label: "仅启用", activeClass: "bg-emerald-500 text-white dark:bg-emerald-600" },
            { v: "inactive" as const, label: "仅禁用", activeClass: "bg-orange-500 text-white dark:bg-orange-600" },
          ]
        ).map((opt) => (
          <button
            key={opt.v}
            type="button"
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer",
              statusFilter === opt.v
                ? opt.activeClass
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onClick={() => onStatusFilterChange(opt.v)}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer",
            showUnscheduled
              ? "bg-violet-500 text-white dark:bg-violet-600"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onClick={() => onShowUnscheduledChange(!showUnscheduled)}
        >
          {showUnscheduled ? "含未调度" : "仅调度中"}
          {unscheduledHiddenCount > 0 && !showUnscheduled && (
            <span className="ml-1 opacity-70">
              ({unscheduledHiddenCount})
            </span>
          )}
        </button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenFilterPrefixes}
        >
          排除前缀{excludeListCount > 0 && ` (${excludeListCount})`}
        </Button>

        {hiddenCount > 0 && (
          <span className="text-xs text-muted-foreground/70">
            已隐藏 {hiddenCount} 个账号
          </span>
        )}
      </div>
    </>
  );
}
