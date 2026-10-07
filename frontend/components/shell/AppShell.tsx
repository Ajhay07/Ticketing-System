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
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-600" aria-hidden />}
            <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600")} />
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
      <div className="flex h-16 items-center px-5">
        <Link href={nav.items[0]?.href ?? "/"} className="rounded-md">
          <ClickfieldLogo sub={nav.label === "Admin" ? "Admin console" : "Team workspace"} />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-2 pt-3">
        <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-wider text-slate-400">Menu</p>
        <SidebarNav items={nav.items} pathname={pathname} onNavigate={() => setOpen(false)} />
      </div>
      <SidebarUser />
    </>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        {sidebarBody}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
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
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-lg">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonClasses("ghost", "md", "absolute right-3 top-3.5 w-9 px-0")}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">{children}</div>
    </div>
  );
}

/** Lighter top-bar shell for clients (spec: simple for clients). */
export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const items = NAV.client.items;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6 lg:px-8">
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
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
            <LogoutButton className="w-9 px-0 md:w-auto md:px-3.5" />
          </div>
        </div>
        {/* Mobile tab row */}
        <nav aria-label="Main mobile" className="flex gap-1 border-t border-slate-100 px-4 py-1.5 sm:hidden">
          {items.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/client/tickets" ? pathname.startsWith("/client/tickets") : isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium",
                  active ? "bg-brand-50 text-brand-700" : "text-slate-600"
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
