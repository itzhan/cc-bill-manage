"use client";
import { Chip } from "@heroui/react";
import ThemeToggle from "./ThemeToggle";
import {
  LayoutDashboard,
  Server,
  Building2,
  Link2,
  Settings,
  LogOut,
  HelpCircle,
  Wallet,
  Activity,
  Gauge,
  Share2,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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
      className={[
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
        active
          ? "bg-content2 text-foreground font-medium shadow-sm"
          : "text-default-500 hover:text-foreground hover:bg-default-100",
      ].join(" ")}
    >
      <span
        className={
          active
            ? "text-foreground"
            : "text-default-400 group-hover:text-foreground"
        }
      >
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <Chip size="sm" color="success" variant="flat">
          {item.badge}
        </Chip>
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
  const isActive = entry.items.some((it) => pathname === it.href);

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-default-400">
          {entry.group}
        </span>
        <div className="flex-1 h-px bg-divider/40" />
        <ChevronDown
          size={12}
          className={[
            "text-default-400 transition-transform",
            isActive ? "" : "",
          ].join(" ")}
        />
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
    <aside className="hidden md:flex shrink-0 w-52 h-screen sticky top-0 bg-content1 flex-col">
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-purple-600 flex items-center justify-center shadow-md shadow-purple-500/20">
          <Wallet size={18} className="text-white" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Bill Manage</span>
          <span className="text-xs text-default-500">中转利润管理</span>
        </div>
      </div>

      <nav className="px-3 mt-2 flex flex-col gap-0.5 overflow-y-auto flex-1">
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

      <div className="mt-auto p-3 flex flex-col gap-1">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-default-500 hover:text-foreground hover:bg-default-100 transition-colors">
          <HelpCircle size={18} />
          <span>帮助 & 信息</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5">
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex flex-1 items-center gap-3 px-2 py-2 rounded-xl text-sm text-default-500 hover:text-foreground hover:bg-default-100 transition-colors"
          >
            <LogOut size={16} />
            <span>退出</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
