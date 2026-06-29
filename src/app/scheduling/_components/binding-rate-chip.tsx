"use client";

import { cn } from "@/lib/utils";
import type { BindingInfo } from "../_types";

export default function BindingRateChip({ bind }: { bind: BindingInfo[] }) {
  if (bind.length === 0) {
    return (
      <span
        className="text-[10px] text-muted-foreground/70 italic"
        title="该渠道未在「绑定」页配置上游 key"
      >
        未绑定
      </span>
    );
  }
  const sorted = [...bind].sort(
    (a, b) =>
      a.upstreamEffectiveRateMultiplier - b.upstreamEffectiveRateMultiplier,
  );
  const first = sorted[0];
  const tooltip = sorted
    .map(
      (b) =>
        `${b.upstreamGroupName} ×${b.upstreamEffectiveRateMultiplier}${b.upstreamHasExclusiveRate ? "（专属）" : ""} → ${b.upstreamKeyName}`,
    )
    .join("\n");

  const r = first.upstreamEffectiveRateMultiplier;
  const colorClass =
    r < 1
      ? "text-emerald-600 dark:text-emerald-400"
      : r > 1
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <span
      className={cn("text-[10px] font-medium", colorClass)}
      title={tooltip}
    >
      上游 {first.upstreamGroupName} ×{r}
      {first.upstreamHasExclusiveRate ? " 专属" : ""}
      {sorted.length > 1 && (
        <span className="text-muted-foreground/70 font-normal">
          {" "}
          +{sorted.length - 1}
        </span>
      )}
    </span>
  );
}
