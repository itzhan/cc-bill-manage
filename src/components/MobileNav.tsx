"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Activity, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sidebarEntries, navItems, type NavItem, type NavGroup } from "./Sidebar";
import ThemeToggle from "./ThemeToggle";
import { cn } from "@/lib/utils";

function isGroup(e: (typeof sidebarEntries)[number]): e is NavGroup {
  return "group" in e;
}

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const current = navItems.find((it) => it.href === pathname);

  function renderItem(it: NavItem) {
    const active = pathname === it.href;
    return (
      <Link
        key={it.href}
        href={it.href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all border",
          active
            ? "bg-primary/10 text-primary border-primary/20 dark:bg-primary/15 dark:border-primary/25"
            : "text-muted-foreground hover:text-foreground hover:bg-accent border-transparent",
        )}
      >
        <span className={cn(active ? "text-primary" : "text-muted-foreground/60")}>
          {it.icon}
        </span>
        <span className="flex-1">{it.label}</span>
      </Link>
    );
  }

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-12 bg-card/95 backdrop-blur border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="menu"
          onClick={() => setOpen(true)}
        >
          <Menu size={18} />
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={20} className="text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">
            {current?.label ?? "Bill Manage"}
          </span>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="flex-row items-center gap-3 p-4 pb-3 space-y-0">
            <Activity size={24} className="text-primary shrink-0" />
            <div className="flex flex-col leading-tight">
              <SheetTitle className="text-sm font-bold">Bill Manage</SheetTitle>
              <span className="text-[11px] text-muted-foreground/60">中转利润管理</span>
            </div>
          </SheetHeader>
          <Separator className="mx-4 w-auto" />
          <div className="px-2.5 py-3 flex-1 overflow-y-auto">
            <nav className="flex flex-col gap-0.5">
              {sidebarEntries.map((entry) =>
                isGroup(entry) ? (
                  <div key={entry.group} className="mt-4 first:mt-0">
                    <div className="px-3 mb-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                        {entry.group}
                      </span>
                    </div>
                    {entry.items.map(renderItem)}
                  </div>
                ) : (
                  renderItem(entry)
                ),
              )}
            </nav>
          </div>
          <Separator />
          <div className="p-2.5 flex items-center justify-between">
            <ThemeToggle />
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut size={14} />
              <span>退出</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
