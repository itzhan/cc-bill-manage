"use client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const order = ["system", "light", "dark"] as const;
type Mode = (typeof order)[number];

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <Button
        variant="secondary"
        size="icon-sm"
        className="rounded-full"
        aria-label="theme"
      >
        <Monitor size={14} />
      </Button>
    );
  }
  const current = (theme as Mode) ?? "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  const Icon =
    current === "system" ? Monitor : current === "dark" ? Moon : Sun;
  const label =
    current === "system"
      ? `跟随系统（当前：${resolvedTheme === "dark" ? "深色" : "浅色"}）`
      : current === "dark"
        ? "深色"
        : "浅色";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            className="rounded-full"
            aria-label={`switch theme (current: ${current})`}
            onClick={() => setTheme(next)}
          >
            <Icon size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
