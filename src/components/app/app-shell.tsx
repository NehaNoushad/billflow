"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  BarChart3, Bell, ChevronsLeft, ChevronsRight, FileText, Layers, LayoutDashboard, LogOut, Menu, Package, Percent,
  PlayCircle, Receipt, Repeat, Settings, ShieldCheck, Tag, UserCircle, UserCog, Users, Wallet, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/actions/auth";
import type { NavItem } from "./nav";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BarChart3, FileText, Layers, LayoutDashboard, Package, Percent, PlayCircle, Receipt, Repeat, Settings, ShieldCheck, Tag, UserCircle, UserCog, Users, Wallet,
};

export type Notification = { id: string; title: string; description: string; href?: string; tone: "info" | "warning" | "critical"; at?: string };

type Props = {
  nav: NavItem[];
  user: { name: string; email: string; role: string };
  notifications: Notification[];
  children: React.ReactNode;
};

/** Sidebar collapse preference persisted in localStorage (server render = expanded). */
function useSidebarCollapsed() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("bf-sidebar", onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener("bf-sidebar", onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => localStorage.getItem("bf-sidebar") === "collapsed",
    () => false
  );
}

function NavLinks({ nav, collapsed, onNavigate }: { nav: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(nav.map((n) => n.group))];
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group}>
          {!collapsed && <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">{group}</p>}
          <ul className="space-y-0.5">
            {nav
              .filter((n) => n.group === group)
              .map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = item.href === "/portal" ? pathname === "/portal" : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        collapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-14 items-center gap-2 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
      <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-white">
        <Zap className="size-4" />
      </div>
      {!collapsed && <span className="text-[15px] font-bold tracking-wide text-white">BILLFLOW</span>}
    </div>
  );
}

export function AppShell({ nav, user, notifications, children }: Props) {
  const collapsed = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () => {
    localStorage.setItem("bf-sidebar", collapsed ? "expanded" : "collapsed");
    window.dispatchEvent(new Event("bf-sidebar"));
  };

  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const urgent = notifications.filter((n) => n.tone !== "info").length;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={cn("no-print fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-200 lg:flex", collapsed ? "w-16" : "w-60")}>
        <Brand collapsed={collapsed} />
        <NavLinks nav={nav} collapsed={collapsed} />
        <div className="border-t border-sidebar-border p-3">
          <button onClick={toggle} className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white">
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 border-none bg-sidebar p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            <Brand collapsed={false} />
            <NavLinks nav={nav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-60")}>
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
          <div className="flex-1" />

          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label="Notifications" />}>
              <Bell className="size-4.5" />
              {urgent > 0 && <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">{urgent > 9 ? "9+" : urgent}</span>}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b px-4 py-3 text-sm font-semibold">Notifications</div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
                ) : (
                  notifications.map((n) => (
                    <Link key={n.id} href={n.href ?? "#"} className="flex gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/60">
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.tone === "critical" ? "bg-red-500" : n.tone === "warning" ? "bg-amber-500" : "bg-indigo-500")} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{n.title}</span>
                        <span className="block text-xs text-muted-foreground">{n.description}</span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted" />}>
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials}</span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight font-medium">{user.name}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground capitalize">{user.role.toLowerCase()}</span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block text-sm font-medium text-foreground">{user.name}</span>
                  <span className="block text-xs font-normal">{user.email}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              {user.role === "CUSTOMER" && (
                <DropdownMenuItem render={<Link href="/portal/profile" />}>
                  <UserCircle className="size-4" /> Profile
                </DropdownMenuItem>
              )}
              {user.role === "ADMIN" && (
                <DropdownMenuItem render={<Link href="/settings" />}>
                  <Settings className="size-4" /> Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => logoutAction()}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
