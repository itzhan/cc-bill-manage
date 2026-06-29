"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function TestResultChip({
  result,
}: {
  result?:
    | { kind: "pending" }
    | { kind: "ok"; latencyMs: number }
    | { kind: "fail"; latencyMs: number; output: string };
}) {
  if (!result) return null;

  if (result.kind === "pending") {
    return (
      <span className="text-[10px] text-primary inline-flex items-center gap-0.5">
        <Loader2 className="h-3 w-3 animate-spin" /> 测试中
      </span>
    );
  }

  const sec = (result.latencyMs / 1000).toFixed(2) + "s";

  if (result.kind === "ok") {
    const colorClass =
      result.latencyMs < 5000
        ? "text-emerald-600 dark:text-emerald-400"
        : result.latencyMs < 15000
          ? "text-foreground"
          : "text-amber-600 dark:text-amber-400";
    return (
      <span className={cn("text-[10px] font-medium", colorClass)}>
        ✓ {sec}
      </span>
    );
  }

  return (
    <span
      className="text-[10px] text-destructive font-medium"
      title={result.output}
    >
      ✗ {sec}
    </span>
  );
}
