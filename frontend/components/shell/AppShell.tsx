"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { buttonClasses } from "@/components/ui/Button";
import { LogoutButton, SidebarUser } from "@/components/shell/UserMenu";
import { ClickfieldLogo } from "@/components/ClickfieldLogo";
import { TopBar } from "@/components/shell/TopBar";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

/**
 * Navigation only. Every endpoint behind these pages is enforced server-side
 * (API permissions + RLS); hiding or showing a link is never a security boundary.
 */
const NAV: Record<"admin" | "team" | "client", { label: string; items: NavItem[] }> = {
  admin: {
    label: "Admin",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/tickets", label: "Tickets", icon: Ticket },
      { href: "/admin/unassigned", label: "Unassigned", icon: Inbox },
      { href: "/admin/team", label: "Team", icon: Users },
      { href: "/admin/clients", label: "Clients", icon: Building2 },
      { href: "/admin/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  team: {
    label: "Team",
    items: [
      { href: "/team/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/team/tickets", label: "My Tickets", icon: Ticket },
    ],
  },
  client: {
    label: "Support",
    items: [
      { href: "/client/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/client/tickets", label: "My Tickets", icon: Ticket },
    ],
  },
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold tracking-[-0.01em] transition-colors duration-150",
              active ? "bg-cf-black text-white" : "text-cf-slate hover:bg-cf-soft hover:text-cf-ink"
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-white" : "text-cf-slate group-hover:text-cf-ink")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sidebar shell for staff areas (admin / team). Collapses to an off-canvas drawer below lg. */
export function SidebarShell({ area, children }: { area: "admin" | "team"; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = NAV[area];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebarBody = (
    <>
      <div className="flex h-24 items-center border-b border-cf-border px-6">
        <Link href={nav.items[0]?.href ?? "/"} className="rounded-sm">
          <ClickfieldLogo sub={nav.label === "Admin" ? "Admin console" : "Team workspace"} />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-2 pt-6">
        <p className="cf-label px-3 pb-3 !text-[10px] !text-cf-muted">Menu</p>
        <SidebarNav items={nav.items} pathname={pathname} onNavigate={() => setOpen(false)} />
      </div>
      <SidebarUser />
    </>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-cf-border bg-white lg:flex">
        {sidebarBody}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-cf-border bg-white px-4 lg:hidden">
        <ClickfieldLogo size="sm" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonClasses("ghost", "md", "w-9 px-0")}
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-cf-black/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85%] flex-col border-r border-cf-ink bg-white">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonClasses("ghost", "md", "absolute right-3 top-7 w-10 px-0")}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <TopBar ticketsPath={`/${area}/tickets`} dashboardPath={`/${area}/dashboard`} />
        {children}
      </div>
    </div>
  );
}

/** Lighter top-bar shell for clients (spec: simple for clients). */
export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const items = NAV.client.items;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cf-border bg-white">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:h-20 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/client/dashboard" className="rounded-md">
              <ClickfieldLogo sub="Support portal" />
            </Link>
            <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
              {items.map(({ href, label }) => {
                const active =
                  href === "/client/tickets"
                    ? pathname.startsWith("/client/tickets")
                    : isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center rounded-md px-3 text-sm font-semibold transition-colors duration-150",
                      active ? "bg-cf-black text-white" : "text-cf-slate hover:bg-cf-soft hover:text-cf-ink"
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/client/tickets/new" className={buttonClasses("primary", "md")}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create ticket</span>
              <span className="sm:hidden">New</span>
            </Link>
            <LogoutButton className="w-10 px-0 md:w-auto md:px-4" />
          </div>
        </div>
        {/* Mobile tab row */}
        <nav aria-label="Main mobile" className="flex gap-1 border-t border-cf-border px-4 py-2 sm:hidden">
          {items.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/client/tickets" ? pathname.startsWith("/client/tickets") : isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-semibold",
                  active ? "bg-cf-black text-white" : "text-cf-slate"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
