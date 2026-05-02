"use client";
import { Button } from "@heroui/react";
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
          <p className="text-sm text-default-500 mt-1">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button
          isIconOnly
          variant="flat"
          size="md"
          radius="full"
          aria-label="search"
        >
          <Search size={16} />
        </Button>
        <Button
          isIconOnly
          variant="flat"
          size="md"
          radius="full"
          aria-label="notifications"
        >
          <Bell size={16} />
        </Button>
      </div>
    </header>
  );
}
