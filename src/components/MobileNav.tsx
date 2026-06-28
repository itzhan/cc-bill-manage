"use client";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  useDisclosure,
} from "@heroui/react";
import { LogOut, Menu, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sidebarEntries, navItems, type NavItem, type NavGroup } from "./Sidebar";
import ThemeToggle from "./ThemeToggle";

function isGroup(e: (typeof sidebarEntries)[number]): e is NavGroup {
  return "group" in e;
}

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { isOpen, onOpen, onClose } = useDisclosure();

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
        onClick={onClose}
        className={[
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
          active
            ? "bg-content2 text-foreground font-medium"
            : "text-default-500 hover:text-foreground hover:bg-default-100",
        ].join(" ")}
      >
        <span className={active ? "text-foreground" : "text-default-400"}>
          {it.icon}
        </span>
        <span className="flex-1">{it.label}</span>
      </Link>
    );
  }

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-12 bg-content1/95 backdrop-blur border-b border-divider/50">
        <Button
          isIconOnly
          variant="light"
          size="sm"
          aria-label="menu"
          onPress={onOpen}
        >
          <Menu size={18} />
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-purple-600 flex items-center justify-center shrink-0">
            <Wallet size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold truncate">
            {current?.label ?? "Bill Manage"}
          </span>
        </div>
      </header>

      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        placement="left"
        size="xs"
        hideCloseButton
      >
        <DrawerContent>
          <DrawerHeader className="flex items-center gap-3 pb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-purple-600 flex items-center justify-center">
              <Wallet size={16} className="text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Bill Manage</span>
              <span className="text-xs text-default-500">中转利润管理</span>
            </div>
          </DrawerHeader>
          <DrawerBody className="px-3 pb-4">
            <nav className="flex flex-col gap-0.5">
              {sidebarEntries.map((entry) =>
                isGroup(entry) ? (
                  <div key={entry.group} className="mt-1">
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-default-400">
                        {entry.group}
                      </span>
                      <div className="flex-1 h-px bg-divider/40" />
                    </div>
                    {entry.items.map(renderItem)}
                  </div>
                ) : (
                  renderItem(entry)
                ),
              )}
            </nav>
            <div className="mt-auto pt-3 flex items-center gap-2 border-t border-divider/50">
              <ThemeToggle />
              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="flex flex-1 items-center gap-3 px-3 py-2 rounded-xl text-sm text-default-500 hover:text-foreground hover:bg-default-100"
              >
                <LogOut size={16} />
                <span>退出</span>
              </button>
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}
