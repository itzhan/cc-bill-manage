"use client";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ThemeToggle from "./ThemeToggle";
import {
  LayoutDashboard,
  Server,
  Building2,
  Link2,
  Settings,
  LogOut,
  Activity,
  Gauge,
  Share2,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export type SidebarEntry = NavItem | NavGroup;

function isGroup(e: SidebarEntry): e is NavGroup {
  return "group" in e;
}

export const sidebarEntries: SidebarEntry[] = [
  { href: "/", label: "仪表盘", icon: <LayoutDashboard size={18} /> },
  { href: "/ledger", label: "账本", icon: <BookOpen size={18} /> },
  { href: "/scheduling", label: "资源调度", icon: <Activity size={18} /> },
  {
    group: "运营管理",
    items: [
      { href: "/upstream", label: "渠道管理", icon: <Server size={18} /> },
      { href: "/site", label: "本站账号", icon: <Building2 size={18} /> },
      { href: "/bindings", label: "绑定", icon: <Link2 size={18} /> },
    ],
  },
  {
    group: "工具 & 设置",
    items: [
      { href: "/bench", label: "基准测试", icon: <Gauge size={18} /> },
      { href: "/site-shares", label: "对外展示", icon: <Share2 size={18} /> },
      { href: "/settings", label: "设置", icon: <Settings size={18} /> },
    ],
  },
];

export const navItems: NavItem[] = sidebarEntries.flatMap((e) =>
  isGroup(e) ? e.items : [e],
);

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
        active
          ? "bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/25"
          : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent",
      )}
    >
      <span
        className={cn(
          "transition-colors",
          active
            ? "text-primary"
            : "text-muted-foreground/60 group-hover:text-foreground",
        )}
      >
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <Badge variant="success">
          {item.badge}
        </Badge>
      )}
    </Link>
  );
}

function NavGroupSection({
  entry,
  pathname,
}: {
  entry: NavGroup;
  pathname: string;
}) {
  return (
    <div className="mt-4 first:mt-2">
      <div className="px-3 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {entry.group}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {entry.items.map((it) => (
          <NavLink key={it.href} item={it} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="hidden md:flex shrink-0 w-56 h-screen sticky top-0 bg-card border-r border-border flex-col">
      {/* Logo */}
      <div className="p-4 pb-3 flex items-center gap-3">
        <Activity size={24} className="text-primary shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight">Bill Manage</span>
          <span className="text-[11px] text-muted-foreground/60">中转利润管理</span>
        </div>
      </div>

      <Separator className="mx-3 w-auto" />

      {/* Navigation */}
      <nav className="px-2.5 mt-3 flex flex-col gap-0.5 overflow-y-auto flex-1">
        {sidebarEntries.map((entry) =>
          isGroup(entry) ? (
            <NavGroupSection
              key={entry.group}
              entry={entry}
              pathname={pathname}
            />
          ) : (
            <NavLink key={entry.href} item={entry} pathname={pathname} />
          ),
        )}
      </nav>

      {/* Footer */}
      <div className="mt-auto p-2.5 space-y-1">
        <Separator className="mb-2" />
        <div className="flex items-center justify-between px-2">
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut size={14} />
            <span>退出</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
