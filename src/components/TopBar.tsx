"use client";
import { Button } from "@/components/ui/button";
import { Bell, Search } from "lucide-react";

export default function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button
          size="icon"
          variant="secondary"
          className="rounded-full"
          aria-label="search"
        >
          <Search size={16} />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="rounded-full"
          aria-label="notifications"
        >
          <Bell size={16} />
        </Button>
      </div>
    </header>
  );
}
